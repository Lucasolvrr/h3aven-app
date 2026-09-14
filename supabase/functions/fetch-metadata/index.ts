// Supabase Edge Function: fetch-metadata
// Single place that talks to external APIs (YouTube/Spotify oEmbed, Open Graph
// scraping, TMDB) so keys like TMDB_API_KEY never ship in client code, and so
// arbitrary third-party HTML (blocked by CORS in the browser) can be fetched
// and parsed server-side.
//
// Actions:
//   { action: 'search', query, mediaType } -> TMDB search results (no DB write)
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

function extractOgTag(html, prop) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:${prop}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return null;
}

async function fetchOEmbed(endpoint) {
  const res = await withTimeout((signal) => fetch(endpoint, { signal }));
  if (!res.ok) throw new Error(`oEmbed failed: ${res.status}`);
  return res.json();
}

async function scrapeOg(url) {
  const res = await withTimeout((signal) =>
    fetch(url, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; h3avenBot/1.0; +https://h3aven.netlify.app)',
      },
    })
  );
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const html = await res.text();
  return {
    title: extractOgTag(html, 'title'),
    image: extractOgTag(html, 'image'),
    description: extractOgTag(html, 'description'),
  };
}

async function enrichYoutube(url) {
  const data = await fetchOEmbed(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
  return { title: data.title, image: data.thumbnail_url, author: data.author_name };
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
      const results = await tmdbSearch(body.query, body.mediaType);
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
