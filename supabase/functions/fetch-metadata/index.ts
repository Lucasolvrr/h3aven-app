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
//   { action: 'preview', url } -> page metadata for a URL (title, description,
//     image, favicon, domain), no DB write. Used by quick-add so the bookmark
//     can be previewed and categorised before it is saved.
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

// --- Bookmark preview (used by quick-add, the extension and future share
// targets): returns page metadata WITHOUT writing to the database, so the
// client can show it, suggest a category and let the user confirm first.

function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .trim();
}

function extractMetaByName(html, name) {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${name}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

function extractFavicon(html) {
  const links = html.match(/<link[^>]+>/gi) || [];
  let best = null;
  for (const tag of links) {
    const rel = (tag.match(/rel=["']([^"']+)["']/i) || [])[1] || '';
    if (!/icon/i.test(rel)) continue;
    const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    // Prefer apple-touch-icon (bigger, square) over a 16px favicon.
    if (/apple-touch-icon/i.test(rel)) return href;
    if (!best) best = href;
  }
  return best;
}

function absoluteUrl(value, base) {
  if (!value) return null;
  try {
    return new URL(decodeEntities(value), base).toString();
  } catch {
    return null;
  }
}

function isPublicHttpUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname;
    // Never let this function be used to probe private networks.
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (host === '[::1]' || host.startsWith('[fc') || host.startsWith('[fd') || host.startsWith('[fe80')) return false;
    return true;
  } catch {
    return false;
  }
}

async function previewUrl(url) {
  const domain = new URL(url).hostname.replace(/^www\./, '');
  const result = { url, domain, title: null, description: null, image: null, favicon: null, siteName: null };

  let html = null;
  let finalUrl = url;
  try {
    const res = await withTimeout((signal) =>
      fetch(url, {
        signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; h3avenBot/1.0; +https://h3aven.netlify.app)',
          Accept: 'text/html,application/xhtml+xml',
        },
      })
    );
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    finalUrl = res.url || url;
    // Only the head matters, and some pages are enormous.
    html = (await res.text()).slice(0, 600000);
  } catch {
    html = null;
  }

  if (html) {
    const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    result.title = decodeEntities(extractOgTag(html, 'title') || extractMetaByName(html, 'twitter:title') || titleTag);
    result.description = decodeEntities(
      extractOgTag(html, 'description') || extractMetaByName(html, 'description') || extractMetaByName(html, 'twitter:description')
    );
    result.image = absoluteUrl(extractOgTag(html, 'image') || extractMetaByName(html, 'twitter:image'), finalUrl);
    result.favicon = absoluteUrl(extractFavicon(html), finalUrl);
    result.siteName = decodeEntities(extractOgTag(html, 'site_name'));
  }

  // Blocked fetch, or a page that exposes no preview image: let a real
  // (headless) browser have a go. Best-effort — a bookmark is still valid
  // without any of this.
  if (!html || !result.image) {
    try {
      const data = await microlinkFetch(url, { screenshot: !result.image, meta: true });
      result.title = result.title || data.title || null;
      result.description = result.description || data.description || null;
      result.image = result.image || (data.image && data.image.url) || (data.screenshot && data.screenshot.url) || null;
      result.favicon = result.favicon || (data.logo && data.logo.url) || null;
      result.siteName = result.siteName || data.publisher || null;
    } catch {
      // keep whatever we have
    }
  }

  result.reachable = Boolean(html || result.title || result.image);
  return result;
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
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Spotify auth failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error(`Spotify auth returned no access_token: ${JSON.stringify(data)}`);
  spotifyTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return spotifyTokenCache.token;
}

async function spotifySearch(query) {
  const token = await getSpotifyToken();
  // Spotify capped /v1/search's `limit` at 10 in a Feb 2026 API change (it
  // used to allow up to 50) — anything higher now fails with a 400 "Invalid
  // limit", found while live-testing this after the first deploy.
  const res = await withTimeout((signal) =>
    fetch(`https://api.spotify.com/v1/search?type=track&limit=10&q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    })
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Spotify search failed: ${res.status} ${body}`);
  }
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

    if (body.action === 'preview') {
      if (!body.url || !isPublicHttpUrl(body.url)) return json({ error: 'A public http(s) url is required' }, 400);
      return json({ preview: await previewUrl(body.url) });
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
