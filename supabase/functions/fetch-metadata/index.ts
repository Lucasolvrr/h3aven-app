// Supabase Edge Function: fetch-metadata
// Single place that talks to external APIs (YouTube/Spotify oEmbed, Open Graph
// scraping, TMDB) so keys like TMDB_API_KEY never ship in client code, and so
// arbitrary third-party HTML (blocked by CORS in the browser) can be fetched
// and parsed server-side.
//
// Actions:
//   { action: 'search', query, category } -> external search results, no DB
//     write. category is 'filmes'/'series' (TMDB) or 'musicas' (Spotify) —
//     the unified search overlay locks to one category per search.
//   { action: 'enrich', linkId, url, contentType } -> fetches metadata for an
//     existing link row and updates it (youtube/music/tweet/social/link)
//
// Auth: the caller's own JWT is forwarded to supabase-js, so RLS (not this
// function) is what actually restricts updates to the caller's own rows.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TMDB_API_KEY = (Deno.env.get('TMDB_API_KEY') || '').trim();
const TMDB_BASE = 'https://api.themoviedb.org/3';
const SPOTIFY_CLIENT_ID = (Deno.env.get('SPOTIFY_CLIENT_ID') || '').trim();
const SPOTIFY_CLIENT_SECRET = (Deno.env.get('SPOTIFY_CLIENT_SECRET') || '').trim();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function withTimeout(fn, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function extractMetaByProperty(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

function extractOgTag(html, prop) {
  return extractMetaByProperty(html, `og:${prop}`);
}

// Páginas de produto (Shopify, WooCommerce, etc.) costumam expor preço via
// Open Graph Product (product:price:*) — algumas usam og:price:* também.
function extractPrice(html) {
  const amount =
    extractMetaByProperty(html, 'product:price:amount') || extractMetaByProperty(html, 'og:price:amount');
  if (!amount) return null;
  const currency =
    extractMetaByProperty(html, 'product:price:currency') || extractMetaByProperty(html, 'og:price:currency');
  return { amount, currency: currency || null };
}

async function fetchOEmbed(endpoint) {
  const res = await withTimeout((signal) => fetch(endpoint, { signal }));
  if (!res.ok) throw new Error(`oEmbed failed: ${res.status}`);
  return res.json();
}

const MICROLINK_TIMEOUT = 15000;

// microlink.io: free, no API key, renders the page in a real (headless) browser.
// Used as a fallback — both for pages that block a plain fetch() (bot
// protection) and for pages that respond fine but have no og:image tag.
async function microlinkFetch(url, { screenshot = false, meta = true } = {}) {
  const params = new URLSearchParams({ url, meta: String(meta) });
  if (screenshot) params.set('screenshot', 'true');
  const res = await withTimeout(
    (signal) => fetch(`https://api.microlink.io/?${params.toString()}`, { signal }),
    MICROLINK_TIMEOUT
  );
  if (!res.ok) throw new Error(`microlink failed: ${res.status}`);
  const body = await res.json();
  if (body.status !== 'success') throw new Error('microlink: unsuccessful response');
  return body.data;
}

async function microlinkScreenshot(url) {
  const data = await microlinkFetch(url, { screenshot: true, meta: false });
  if (!data.screenshot || !data.screenshot.url) throw new Error('microlink: no screenshot url');
  return data.screenshot.url;
}

async function microlinkFull(url) {
  const data = await microlinkFetch(url, { screenshot: true, meta: true });
  return {
    title: data.title || null,
    description: data.description || null,
    image: (data.screenshot && data.screenshot.url) || (data.image && data.image.url) || null,
  };
}

async function scrapeOg(url) {
  let html;
  try {
    const res = await withTimeout((signal) =>
      fetch(url, {
        signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; h3avenBot/1.0; +https://h3aven.netlify.app)',
        },
      })
    );
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    html = await res.text();
  } catch {
    // Fetch direto falhou (bot protection, etc.) — microlink usa um navegador
    // de verdade e às vezes consegue passar onde um fetch simples não passa.
    return microlinkFull(url);
  }

  const meta = {
    title: extractOgTag(html, 'title'),
    image: extractOgTag(html, 'image'),
    description: extractOgTag(html, 'description'),
    price: extractPrice(html),
  };
  if (!meta.image) {
    meta.image = await microlinkScreenshot(url).catch(() => null);
  }
  return meta;
}

function extractYoutubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1) || null;
    const v = u.searchParams.get('v');
    if (v) return v;
    const match = u.pathname.match(/\/(embed|shorts)\/([^/?]+)/);
    return match ? match[2] : null;
  } catch {
    return null;
  }
}

async function enrichYoutube(url) {
  const data = await fetchOEmbed(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
  // oEmbed's thumbnail_url is the old 480x360 (4:3) hqdefault.jpg, which has
  // black letterbox bars baked in for widescreen videos. hq720.jpg is a real
  // 1280x720 crop with no bars — use it when available, falling back to
  // oEmbed's thumbnail for the rare video that doesn't have it.
  let image = data.thumbnail_url;
  const videoId = extractYoutubeId(url);
  if (videoId) {
    const hq720 = `https://i.ytimg.com/vi/${videoId}/hq720.jpg`;
    try {
      const check = await withTimeout((signal) => fetch(hq720, { method: 'HEAD', signal }), 5000);
      if (check.ok) image = hq720;
    } catch {
      // keep oEmbed's thumbnail_url
    }
  }
  return { title: data.title, image, author: data.author_name };
}

async function enrichSpotify(url) {
  const data = await fetchOEmbed(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
  return { title: data.title, image: data.thumbnail_url };
}

async function enrichTweet(url) {
  try {
    const data = await fetchOEmbed(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=1`
    );
    const textMatch = data.html ? data.html.match(/<p[^>]*>([\s\S]*?)<\/p>/) : null;
    return {
      title: data.author_name ? `@${data.author_name}` : 'Tweet',
      description: textMatch ? textMatch[1].replace(/<[^>]+>/g, '').trim() : null,
      author: data.author_name,
    };
  } catch {
    // X increasingly rate-limits/breaks oEmbed — fall back to OG scraping.
    return scrapeOg(url);
  }
}

function enrich(contentType, url) {
  if (contentType === 'youtube') return enrichYoutube(url);
  if (contentType === 'music') return enrichSpotify(url);
  if (contentType === 'tweet') return enrichTweet(url);
  return scrapeOg(url);
}

async function tmdbSearch(query, mediaType) {
  if (!TMDB_API_KEY) throw new Error('TMDB_API_KEY not configured');
  const path = mediaType === 'movie' ? 'search/movie' : mediaType === 'tv' ? 'search/tv' : 'search/multi';
  const res = await withTimeout((signal) =>
    fetch(
      `${TMDB_BASE}/${path}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&include_adult=false`,
      { signal }
    )
  );
  if (!res.ok) throw new Error(`TMDB search failed: ${res.status}`);
  const data = await res.json();
  return (data.results || [])
    .filter((r) => r.media_type !== 'person')
    .slice(0, 12)
    .map((r) => ({
      id: r.id,
      mediaType: r.media_type || mediaType,
      title: r.title || r.name,
      year: (r.release_date || r.first_air_date || '').slice(0, 4),
      posterPath: r.poster_path,
      overview: r.overview,
    }));
}

// Client Credentials flow — só permite busca, sem acesso a dados de usuário,
// então o par client_id/secret pode ficar só como secret da function (mesmo
// padrão do TMDB_API_KEY, nunca no client).
let spotifyTokenCache = null;

async function getSpotifyToken() {
  if (spotifyTokenCache && spotifyTokenCache.expiresAt > Date.now()) return spotifyTokenCache.token;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) throw new Error('SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET not configured');
  const basic = btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`);
  const res = await withTimeout((signal) =>
    fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal,
    })
  );
  if (!res.ok) throw new Error(`Spotify auth failed: ${res.status}`);
  const data = await res.json();
  spotifyTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return spotifyTokenCache.token;
}

async function spotifySearch(query) {
  const token = await getSpotifyToken();
  const res = await withTimeout((signal) =>
    fetch(`https://api.spotify.com/v1/search?type=track&limit=12&q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    })
  );
  if (!res.ok) throw new Error(`Spotify search failed: ${res.status}`);
  const data = await res.json();
  return (data.tracks?.items || []).map((t) => ({
    id: t.id,
    mediaType: 'music',
    title: t.name,
    year: (t.album?.release_date || '').slice(0, 4),
    artist: (t.artists || []).map((a) => a.name).join(', '),
    image: t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || null,
    url: t.external_urls?.spotify || null,
  }));
}

// Ponto único de despacho da busca unificada — cada categoria trava numa
// única fonte externa (economiza requisições e mantém os resultados
// coerentes por tipo).
async function performSearch(category, query) {
  if (category === 'filmes') return tmdbSearch(query, 'movie');
  if (category === 'series') return tmdbSearch(query, 'tv');
  if (category === 'musicas') return spotifySearch(query);
  throw new Error(`Categoria de busca desconhecida: ${category}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authHeader } },
    });

    const body = await req.json();

    if (body.action === 'search') {
      const results = await performSearch(body.category, body.query);
      return json({ results });
    }

    if (body.action === 'enrich') {
      const { linkId, url, contentType } = body;
      if (!linkId || !url) return json({ error: 'linkId and url are required' }, 400);

      let metadata = {};
      let fetchStatus = 'ready';
      try {
        metadata = await enrich(contentType, url);
      } catch (err) {
        fetchStatus = 'failed';
        metadata = { error: String(err && err.message ? err.message : err) };
      }

      const { data, error } = await supabase
        .from('links')
        .update({ metadata, fetch_status: fetchStatus })
        .eq('id', linkId)
        .select()
        .single();

      if (error) return json({ error: error.message }, 500);
      return json({ link: data });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: String(err && err.message ? err.message : err) }, 500);
  }
});
