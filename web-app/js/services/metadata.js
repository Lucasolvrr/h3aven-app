// Page metadata for a URL (title, description, preview image, favicon).
//
// Signed in  -> the `fetch-metadata` edge function does the work server-side
//               (many sites block cross-origin requests from a browser).
// Preview    -> there is no authenticated backend, so the public microlink
//               API is called directly. Same data, lower rate limits.
//
// A failed lookup is never fatal: the bookmark is still saved and shown with
// the fallback thumbnail.

import { getSupabase } from '../data/supabase.js';
import { state } from '../data/store.js';
import { domainOf, faviconFor } from '../lib/url.js';

const cache = new Map();

async function viaEdgeFunction(url) {
  const supabase = await getSupabase();
  if (!supabase) throw new Error('offline');
  const { data, error } = await supabase.functions.invoke('fetch-metadata', { body: { action: 'preview', url } });
  if (error || !data?.preview) throw new Error(error?.message || 'preview unavailable');
  return data.preview;
}

async function viaMicrolink(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`, { signal: controller.signal });
    const body = await res.json();
    if (body.status !== 'success') throw new Error('preview unavailable');
    const d = body.data || {};
    return {
      title: d.title || null,
      description: d.description || null,
      image: d.image?.url || null,
      favicon: d.logo?.url || null,
      siteName: d.publisher || null,
      reachable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Always resolves. `reachable: false` means nothing could be read from the
 * page (blocked, offline or gone).
 */
export async function fetchPreview(url) {
  if (cache.has(url)) return cache.get(url);
  const domain = domainOf(url);
  let preview;
  try {
    preview = state.mode === 'cloud' ? await viaEdgeFunction(url).catch(() => viaMicrolink(url)) : await viaMicrolink(url);
  } catch {
    preview = { title: null, description: null, image: null, favicon: null, reachable: false };
  }
  const result = {
    title: preview.title || '',
    description: preview.description || '',
    image: preview.image || '',
    favicon: preview.favicon || faviconFor(domain),
    siteName: preview.siteName || '',
    reachable: preview.reachable !== false,
    domain,
  };
  cache.set(url, result);
  return result;
}

/** TMDB / Spotify search for the Library. Needs the signed-in backend. */
export async function searchMedia(category, query) {
  const supabase = await getSupabase();
  if (!supabase || state.mode !== 'cloud') throw new Error('Sign in to search movies, series and music.');
  const { data, error } = await supabase.functions.invoke('fetch-metadata', { body: { action: 'search', category, query } });
  if (error) throw new Error(error.message || 'Search failed');
  return data?.results || [];
}
