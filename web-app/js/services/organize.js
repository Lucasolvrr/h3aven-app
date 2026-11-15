// Search and category suggestion. Pure functions over the store — no DOM.

import { state, select } from '../data/store.js';
import { domainOf } from '../lib/url.js';

// --- search ------------------------------------------------------------------

function haystack(bookmark) {
  const category = select.category(bookmark.categoryId);
  const sub = select.subcategory(bookmark.subcategoryId);
  return [
    bookmark.title,
    bookmark.url,
    bookmark.domain,
    bookmark.description,
    bookmark.tags.join(' '),
    category?.name,
    sub?.name,
    bookmark.notes,
    bookmark.meta?.author,
    bookmark.meta?.artist,
  ]
    .filter(Boolean)
    .join(' \n ')
    .toLowerCase();
}

/**
 * Every word must match somewhere (title, URL, domain, description, tags,
 * category, subcategory, notes). Title and domain hits rank first, then
 * newest.
 */
export function searchBookmarks(query, list = state.bookmarks) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const bookmark of list) {
    const text = haystack(bookmark);
    if (!words.every((word) => text.includes(word))) continue;
    const title = bookmark.title.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (title.startsWith(word)) score += 4;
      else if (title.includes(word)) score += 3;
      if (bookmark.domain.includes(word)) score += 2;
      if (bookmark.tags.some((tag) => tag.toLowerCase() === word)) score += 2;
    }
    scored.push({ bookmark, score });
  }
  scored.sort((a, b) => b.score - a.score || (b.bookmark.createdAt || '').localeCompare(a.bookmark.createdAt || ''));
  return scored.map((entry) => entry.bookmark);
}

// --- category suggestion -----------------------------------------------------
// No AI involved: (1) where the user already files links from this site,
// (2) names of the user's own categories/folders appearing in the page text,
// (3) a small table of well-known sites.

const KNOWN_SITES = {
  design: ['dribbble', 'behance', 'figma', 'mobbin', 'awwwards', 'pentagram', 'typewolf', 'fonts.google', 'refactoringui', 'nngroup', 'layers.to', 'godly', 'land-book', 'designsystems'],
  development: ['github', 'gitlab', 'stackoverflow', 'npmjs', 'developer.mozilla', 'web.dev', 'vercel', 'supabase', 'tailwindcss', 'codepen', 'docs.', 'dev.to', 'css-tricks', 'react.dev'],
  reading: ['medium', 'substack', 'nytimes', 'newyorker', 'theatlantic', 'paulgraham', 'wikipedia', 'arxiv', 'hbr.org'],
  inspiration: ['pinterest', 'are.na', 'savee', 'cosmos.so', 'unsplash', 'read.cv'],
  productivity: ['notion', 'linear.app', 'todoist', 'basecamp', 'trello', 'obsidian', 'raycast', 'calendar'],
};

export function suggestLocation({ url, title = '', description = '' }) {
  const domain = domainOf(url);
  if (!domain || !state.categories.length) return null;

  // 1. Follow the user's own habits for this site.
  const votes = new Map();
  for (const b of state.bookmarks) {
    if (b.domain !== domain || !b.categoryId) continue;
    const key = `${b.categoryId}|${b.subcategoryId || ''}`;
    votes.set(key, (votes.get(key) || 0) + 1);
  }
  if (votes.size) {
    const [key] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    const [categoryId, subcategoryId] = key.split('|');
    if (select.category(categoryId)) {
      return { categoryId, subcategoryId: subcategoryId || null, reason: `You file ${domain} here` };
    }
  }

  const text = `${title} ${description} ${url}`.toLowerCase();
  const mentions = (name) => name.length > 2 && new RegExp(`\\b${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text);

  // 2. A folder or category named in the page itself ("Typography", "Frontend"...).
  for (const sub of state.subcategories) {
    if (mentions(sub.name)) return { categoryId: sub.categoryId, subcategoryId: sub.id, reason: `Mentions “${sub.name}”` };
  }
  for (const category of state.categories) {
    if (mentions(category.name)) return { categoryId: category.id, subcategoryId: null, reason: `Mentions “${category.name}”` };
  }

  // 3. Well-known sites, matched against the user's category names.
  for (const [categoryName, hints] of Object.entries(KNOWN_SITES)) {
    if (!hints.some((hint) => domain.includes(hint) || url.toLowerCase().includes(`//${hint}`))) continue;
    const category = state.categories.find((c) => c.name.toLowerCase() === categoryName);
    if (category) return { categoryId: category.id, subcategoryId: null, reason: 'Based on the site' };
  }
  return null;
}
