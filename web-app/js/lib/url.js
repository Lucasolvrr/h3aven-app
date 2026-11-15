// URL handling shared by capture, duplicate detection and search.

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|gclsrc|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src|ref_url|_hsenc|_hsmi|si|spm)$/i;

/** Accepts "example.com/page" as well as full URLs. Returns a URL or null. */
export function parseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw || /\s/.test(raw)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // "foo" parses as https://foo — require something that looks like a host.
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return url;
  } catch {
    return null;
  }
}

export function domainOf(input) {
  const url = input instanceof URL ? input : parseUrl(input);
  return url ? url.hostname.replace(/^www\./, '').toLowerCase() : '';
}

/**
 * Canonical form used to detect duplicates: protocol, "www.", trailing
 * slashes, fragments and tracking parameters do not make a different page.
 */
export function normalizeUrl(input) {
  const url = input instanceof URL ? new URL(input.toString()) : parseUrl(input);
  if (!url) return String(input || '').trim().toLowerCase();
  const params = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAMS.test(key));
  params.sort(([a], [b]) => a.localeCompare(b));
  const query = params.map(([k, v]) => (v ? `${k}=${v}` : k)).join('&');
  const path = url.pathname.replace(/\/+$/, '');
  return `${domainOf(url)}${path}${query ? `?${query}` : ''}`;
}

/** Finds every http(s) URL in a blob of text (used for paste and imports). */
export function extractUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  return [...new Set(matches.map((m) => m.replace(/[.,;:!?]+$/, '')))];
}

// Same classification the Chrome extension uses, so rows look identical no
// matter where they were captured.
export function detectContentType(input) {
  const host = domainOf(input);
  const href = String(input);
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
  if (host.includes('open.spotify.com')) return 'music';
  if ((host.includes('twitter.com') || host === 'x.com') && /\/status\//.test(href)) return 'tweet';
  if (host.includes('instagram.com')) return 'instagram';
  if (host.includes('reddit.com')) return 'social';
  return 'link';
}

export function detectSource(input) {
  const host = domainOf(input);
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
  if (host.includes('twitter.com') || host === 'x.com') return 'twitter';
  if (host.includes('reddit.com')) return 'reddit';
  return 'site';
}

export function faviconFor(domain, size = 64) {
  if (!domain) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}
