// Groups links by the site they come from, for the Home filters. Known sites
// get their own name and fold their aliases together (youtu.be is YouTube).

const FAMILIES = [
  { key: 'youtube', label: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  { key: 'twitch', label: 'Twitch', hosts: ['twitch.tv'] },
  { key: 'x', label: 'X', hosts: ['x.com', 'twitter.com'] },
  { key: 'github', label: 'GitHub', hosts: ['github.com', 'github.io'] },
  { key: 'instagram', label: 'Instagram', hosts: ['instagram.com'] },
  { key: 'tiktok', label: 'TikTok', hosts: ['tiktok.com'] },
  { key: 'reddit', label: 'Reddit', hosts: ['reddit.com', 'redd.it'] },
  { key: 'medium', label: 'Medium', hosts: ['medium.com'] },
  { key: 'figma', label: 'Figma', hosts: ['figma.com'] },
  { key: 'dribbble', label: 'Dribbble', hosts: ['dribbble.com'] },
  { key: 'behance', label: 'Behance', hosts: ['behance.net'] },
  { key: 'pinterest', label: 'Pinterest', hosts: ['pinterest.com', 'pin.it'] },
  { key: 'linkedin', label: 'LinkedIn', hosts: ['linkedin.com'] },
  { key: 'spotify', label: 'Spotify', hosts: ['spotify.com'] },
  { key: 'vimeo', label: 'Vimeo', hosts: ['vimeo.com'] },
  { key: 'notion', label: 'Notion', hosts: ['notion.so', 'notion.site'] },
  { key: 'substack', label: 'Substack', hosts: ['substack.com'] },
  { key: 'wikipedia', label: 'Wikipedia', hosts: ['wikipedia.org'] },
  { key: 'mdn', label: 'MDN', hosts: ['developer.mozilla.org'] },
];

const TWO_PART_SUFFIXES = /\.(co|com|org|net|gov|edu|ac)\.[a-z]{2}$/;

/** "www.blog.example.co.uk" -> "example.co.uk" */
function baseDomain(domain) {
  const host = String(domain || '').toLowerCase().replace(/^(www|m|mobile)\./, '');
  const parts = host.split('.');
  const keep = TWO_PART_SUFFIXES.test(host) ? 3 : 2;
  return parts.length > keep ? parts.slice(-keep).join('.') : host;
}

/** { key, label } of the site a domain belongs to. */
export function siteOf(domain) {
  const host = String(domain || '').toLowerCase().replace(/^www\./, '');
  const family = FAMILIES.find((f) => f.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
  if (family) return { key: family.key, label: family.label };
  const base = baseDomain(host);
  return { key: base || 'other', label: base || 'Other' };
}

/** Sites in a list of bookmarks, most links first: [{ key, label, count, domain }]. */
export function siteGroups(bookmarks) {
  const groups = new Map();
  for (const bookmark of bookmarks) {
    const site = siteOf(bookmark.domain);
    const group = groups.get(site.key) || { ...site, count: 0, domain: bookmark.domain, favicon: bookmark.favicon };
    group.count += 1;
    groups.set(site.key, group);
  }
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  // Once some sites repeat, the one-off ones fold into a single "Other" pill
  // so the row stays about the sites you actually collect from.
  const repeated = sorted.filter((g) => g.count > 1);
  if (!repeated.length || repeated.length === sorted.length) return sorted;
  const rest = sorted.filter((g) => g.count === 1);
  if (rest.length < 2) return sorted;
  return [...repeated, { key: OTHER, label: 'Other', count: rest.length, members: new Set(rest.map((g) => g.key)) }];
}

export const OTHER = 'other-sites';

/** Does a bookmark belong to the chosen group (as returned by siteGroups)? */
export function inSiteGroup(bookmark, group) {
  if (!group) return true;
  const key = siteOf(bookmark.domain).key;
  return group.key === OTHER ? group.members.has(key) : key === group.key;
}
