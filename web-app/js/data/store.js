// The single source of truth for the UI.
//
// - Holds the library in memory (bookmarks, categories, subcategories, tags)
// - Every change goes through an action here, which updates memory first
//   (so the interface responds immediately), persists through the active
//   driver, and rolls back if persistence fails
// - Views never talk to a driver or to Supabase directly
//
// Rules of the model:
//   Inbox      = a bookmark with no category (categoryId === null)
//   Media      = movie / tv / music rows; they live in Library, not in the
//                bookmark views
//   Duplicates = same normalizedUrl

import { domainOf, normalizeUrl, detectContentType, detectSource, parseUrl } from '../lib/url.js';
import { STARTER_CATEGORIES } from './sample.js';

export const MEDIA_TYPES = ['movie', 'tv', 'music'];

export const state = {
  ready: false,
  mode: 'local', // 'local' (preview) | 'cloud' (signed in)
  user: null,
  schemaOutdated: false,
  error: null,
  bookmarks: [],
  categories: [],
  subcategories: [],
  tags: [], // [{ id, name }]
};

let driver = null;
let client = null;
let version = 0;

// --- change notification -----------------------------------------------------

const listeners = new Set();
let scheduled = false;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  version += 1;
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    listeners.forEach((listener) => listener(state));
  });
}

// --- row <-> model -----------------------------------------------------------

function posterUrl(path) {
  return path ? `https://image.tmdb.org/t/p/w342${path}` : '';
}

function toBookmark(row, tags = []) {
  const meta = row.metadata || {};
  const contentType = row.content_type || 'link';
  // A row left "pending" (its metadata fetch never reported back) must not
  // shimmer forever: after two minutes it is shown with the fallback tile.
  let status = row.fetch_status || 'ready';
  if (status === 'pending' && Date.now() - new Date(row.created_at).getTime() > 120000) status = 'ready';
  return {
    id: row.id,
    url: row.url,
    normalizedUrl: row.normalized_url || normalizeUrl(row.url),
    domain: row.domain || domainOf(row.url),
    title: row.title || meta.title || '',
    description: row.description || meta.description || meta.overview || '',
    thumbnail: row.thumbnail_url || meta.image || posterUrl(meta.posterPath),
    favicon: row.favicon_url || '',
    categoryId: row.category_id || null,
    subcategoryId: row.subcategory_id || null,
    tags,
    notes: row.notes || '',
    selectedText: row.selected_text || '',
    isFavorite: Boolean(row.is_favorite),
    contentType,
    isMedia: MEDIA_TYPES.includes(contentType),
    status, // pending | ready | failed | manual
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    lastAccessedAt: row.last_accessed_at || null,
    meta,
  };
}

const FIELD_TO_COLUMN = {
  title: 'title',
  description: 'description',
  thumbnail: 'thumbnail_url',
  favicon: 'favicon_url',
  categoryId: 'category_id',
  subcategoryId: 'subcategory_id',
  notes: 'notes',
  isFavorite: 'is_favorite',
  status: 'fetch_status',
  lastAccessedAt: 'last_accessed_at',
};

// Columns that only exist after the bookmark-manager migration.
const NEW_COLUMNS = new Set([
  'category_id', 'subcategory_id', 'normalized_url', 'domain', 'thumbnail_url', 'is_favorite', 'last_accessed_at', 'selected_text',
]);

function toRowPatch(patch) {
  const row = {};
  for (const [field, value] of Object.entries(patch)) {
    const column = FIELD_TO_COLUMN[field];
    if (!column) continue;
    row[column] = value === '' ? null : value;
  }
  return row;
}

function requireSchema(row) {
  if (!state.schemaOutdated) return row;
  if (Object.keys(row).some((column) => NEW_COLUMNS.has(column))) {
    throw new Error('Database update needed: run the new section of supabase/schema.sql to organize bookmarks.');
  }
  return row;
}

// --- loading -----------------------------------------------------------------

export async function start({ driver: nextDriver, user = null, supabase = null }) {
  driver = nextDriver;
  client = supabase;
  state.mode = nextDriver.kind;
  state.user = user;
  state.ready = false;
  emit();
  await reload();
  await seedStarterCategoriesOnce();
}

export async function reload() {
  try {
    const data = await driver.load();
    const tagName = new Map(data.tags.map((t) => [t.id, t.name]));
    const tagsByLink = new Map();
    for (const { link_id, tag_id } of data.linkTags) {
      const name = tagName.get(tag_id);
      if (!name) continue;
      if (!tagsByLink.has(link_id)) tagsByLink.set(link_id, []);
      tagsByLink.get(link_id).push(name);
    }
    state.bookmarks = data.links.map((row) => toBookmark(row, tagsByLink.get(row.id) || []));
    state.categories = data.categories.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon || 'folder',
      description: c.description || '',
      position: c.position ?? 0,
    }));
    state.subcategories = data.subcategories.map((s) => ({
      id: s.id,
      categoryId: s.category_id,
      name: s.name,
      color: s.color || null,
      position: s.position ?? 0,
    }));
    state.tags = data.tags;
    state.schemaOutdated = Boolean(data.schemaOutdated);
    state.error = null;
  } catch (error) {
    console.error(error);
    state.error = error.message || 'Could not load your library';
  }
  state.ready = true;
  emit();
}

async function seedStarterCategoriesOnce() {
  if (state.mode !== 'cloud' || state.schemaOutdated || state.error || state.categories.length) return;
  if (state.user?.user_metadata?.starter_categories) return;
  try {
    await addStarterCategories();
    await client?.auth.updateUser({ data: { starter_categories: true } });
  } catch (error) {
    console.warn('Could not create starter categories', error);
  }
}

// --- selectors ---------------------------------------------------------------

let countsCache = { version: -1, value: null };

export const select = {
  byId: (id) => state.bookmarks.find((b) => b.id === id) || null,
  bookmarks: () => state.bookmarks.filter((b) => !b.isMedia),
  media: () => state.bookmarks.filter((b) => b.isMedia),
  inbox: () => state.bookmarks.filter((b) => !b.isMedia && !b.categoryId),
  favorites: () => state.bookmarks.filter((b) => !b.isMedia && b.isFavorite),
  inCategory: (id) => state.bookmarks.filter((b) => !b.isMedia && b.categoryId === id),
  inSubcategory: (id) => state.bookmarks.filter((b) => !b.isMedia && b.subcategoryId === id),
  category: (id) => state.categories.find((c) => c.id === id) || null,
  subcategory: (id) => state.subcategories.find((s) => s.id === id) || null,
  subsOf: (categoryId) => state.subcategories.filter((s) => s.categoryId === categoryId),

  counts() {
    if (countsCache.version === version) return countsCache.value;
    const value = { all: 0, inbox: 0, favorites: 0, media: 0, category: new Map(), subcategory: new Map() };
    for (const b of state.bookmarks) {
      if (b.isMedia) {
        value.media += 1;
        continue;
      }
      value.all += 1;
      if (b.isFavorite) value.favorites += 1;
      if (!b.categoryId) value.inbox += 1;
      else value.category.set(b.categoryId, (value.category.get(b.categoryId) || 0) + 1);
      if (b.subcategoryId) value.subcategory.set(b.subcategoryId, (value.subcategory.get(b.subcategoryId) || 0) + 1);
    }
    countsCache = { version, value };
    return value;
  },

  findDuplicate(url, exceptId = null) {
    const key = normalizeUrl(url);
    return state.bookmarks.find((b) => b.normalizedUrl === key && b.id !== exceptId) || null;
  },

  tagNames: () => state.tags.map((t) => t.name).sort((a, b) => a.localeCompare(b)),

  /** "Design / Typography", "Design" or "Inbox" */
  locationLabel(bookmark) {
    const category = select.category(bookmark.categoryId);
    if (!category) return 'Inbox';
    const sub = select.subcategory(bookmark.subcategoryId);
    return sub ? `${category.name} / ${sub.name}` : category.name;
  },
};

export const SORTS = {
  saved: { label: 'Newest first', compare: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') },
  oldest: { label: 'Oldest first', compare: (a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') },
  updated: { label: 'Recently updated', compare: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') },
  alpha: {
    label: 'Alphabetical',
    compare: (a, b) => (a.title || a.domain).localeCompare(b.title || b.domain, undefined, { sensitivity: 'base' }),
  },
  accessed: {
    label: 'Recently opened',
    compare: (a, b) => (b.lastAccessedAt || '').localeCompare(a.lastAccessedAt || '') || (b.createdAt || '').localeCompare(a.createdAt || ''),
  },
};

export function sortBookmarks(list, mode = 'saved') {
  return [...list].sort((SORTS[mode] || SORTS.saved).compare);
}

export function displayName() {
  const meta = state.user?.user_metadata || {};
  const raw = meta.name || meta.full_name || (state.user?.email || '').split('@')[0].split(/[._-]/)[0];
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
}

// --- bookmark actions --------------------------------------------------------

function replaceBookmark(next) {
  state.bookmarks = state.bookmarks.map((b) => (b.id === next.id ? next : b));
}

/** Applies a patch in memory, persists it, and rolls back on failure. */
async function mutate(ids, patch) {
  const wanted = new Set(ids);
  const previous = state.bookmarks;
  const stamp = new Date().toISOString();
  const touchesContent = Object.keys(patch).some((key) => key !== 'lastAccessedAt');
  state.bookmarks = previous.map((b) => (wanted.has(b.id) ? { ...b, ...patch, updatedAt: touchesContent ? stamp : b.updatedAt } : b));
  emit();
  try {
    await driver.updateLinks(ids, requireSchema(toRowPatch(patch)));
  } catch (error) {
    state.bookmarks = previous;
    emit();
    throw error;
  }
}

/**
 * Saves a new bookmark. Without a category it lands in the Inbox.
 * Throws an Error with `.duplicate` set when the URL is already saved.
 */
export async function addBookmark(input) {
  const parsed = parseUrl(input.url);
  if (!parsed) throw new Error('That does not look like a valid link.');
  const url = parsed.toString();

  const duplicate = select.findDuplicate(url);
  if (duplicate) {
    const error = new Error('This link is already in your library.');
    error.duplicate = duplicate;
    throw error;
  }

  const contentType = detectContentType(url);
  const row = {
    url,
    title: input.title || null,
    description: input.description || null,
    favicon_url: input.favicon || null,
    notes: input.notes || null,
    source: detectSource(url),
    content_type: contentType,
    fetch_status: input.status || 'ready',
    metadata: {
      ...(input.thumbnail ? { image: input.thumbnail } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
      captured_via: input.capturedVia || 'web',
    },
  };
  if (!state.schemaOutdated) {
    Object.assign(row, {
      normalized_url: normalizeUrl(url),
      domain: domainOf(url),
      thumbnail_url: input.thumbnail || null,
      category_id: input.categoryId || null,
      subcategory_id: input.categoryId ? input.subcategoryId || null : null,
      is_favorite: Boolean(input.isFavorite),
    });
  }

  const saved = await driver.insertLink(row);
  let bookmark = toBookmark(saved, []);
  state.bookmarks = [bookmark, ...state.bookmarks];
  emit();

  if (input.tags?.length) {
    await setTags(bookmark.id, input.tags);
    bookmark = select.byId(bookmark.id);
  }
  return bookmark;
}

export function updateBookmark(id, patch) {
  const next = { ...patch };
  // A bookmark can't sit in a subcategory of a different category.
  if ('categoryId' in next && !('subcategoryId' in next)) next.subcategoryId = null;
  return mutate([id], next);
}

export function moveBookmarks(ids, categoryId, subcategoryId = null) {
  return mutate(ids, { categoryId: categoryId || null, subcategoryId: categoryId ? subcategoryId || null : null });
}

export function setFavorite(ids, isFavorite) {
  return mutate(ids, { isFavorite });
}

export function markOpened(id) {
  return mutate([id], { lastAccessedAt: new Date().toISOString() }).catch(() => {});
}

export async function deleteBookmarks(ids) {
  const wanted = new Set(ids);
  const previous = state.bookmarks;
  state.bookmarks = previous.filter((b) => !wanted.has(b.id));
  emit();
  try {
    await driver.deleteLinks(ids);
  } catch (error) {
    state.bookmarks = previous;
    emit();
    throw error;
  }
}

export function cleanTagNames(names) {
  const seen = new Set();
  const out = [];
  for (const raw of names) {
    const name = String(raw).trim().replace(/^#/, '').replace(/\s+/g, ' ').slice(0, 40);
    if (!name) continue;
    // Reuse the spelling of an existing tag so "CSS" and "css" stay one tag.
    const existing = state.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    const final = existing ? existing.name : name;
    if (seen.has(final.toLowerCase())) continue;
    seen.add(final.toLowerCase());
    out.push(final);
  }
  return out;
}

export async function setTags(id, names) {
  const clean = cleanTagNames(names);
  const bookmark = select.byId(id);
  if (!bookmark) return;
  const previous = bookmark.tags;
  replaceBookmark({ ...bookmark, tags: clean });
  emit();
  try {
    const rows = await driver.ensureTags(clean);
    await driver.replaceLinkTags(id, rows.map((t) => t.id));
    const known = new Set(state.tags.map((t) => t.id));
    state.tags = [...state.tags, ...rows.filter((t) => !known.has(t.id))];
    emit();
  } catch (error) {
    const current = select.byId(id);
    if (current) replaceBookmark({ ...current, tags: previous });
    emit();
    throw error;
  }
}

export async function addTagToBookmarks(ids, name) {
  for (const id of ids) {
    const bookmark = select.byId(id);
    if (bookmark) await setTags(id, [...bookmark.tags, name]);
  }
}

// --- media (Library) ---------------------------------------------------------

/** Saves a TMDB / Spotify search result. Mirrors the pre-redesign behaviour. */
export async function addMedia(result) {
  let row;
  if (result.mediaType === 'music') {
    if (!result.url) throw new Error('No Spotify link for this result.');
    row = {
      url: result.url,
      title: result.title,
      source: 'spotify',
      content_type: 'music',
      external_id: `spotify:track:${result.id}`,
      fetch_status: 'ready',
      metadata: { title: result.title, artist: result.artist, year: result.year, image: result.image },
    };
  } else {
    const mediaType = result.mediaType === 'tv' ? 'tv' : 'movie';
    row = {
      url: `https://www.themoviedb.org/${mediaType}/${result.id}`,
      title: result.title,
      source: 'tmdb',
      content_type: mediaType,
      external_id: `tmdb:${mediaType}:${result.id}`,
      fetch_status: 'ready',
      metadata: { title: result.title, year: result.year, posterPath: result.posterPath, overview: result.overview },
    };
  }
  if (select.findDuplicate(row.url)) throw new Error('Already in your library.');
  const saved = await driver.insertLink(row);
  state.bookmarks = [toBookmark(saved, []), ...state.bookmarks];
  emit();
}

// --- category actions --------------------------------------------------------

function nextPosition(list) {
  return list.reduce((max, item) => Math.max(max, item.position), -1) + 1;
}

export async function createCategory({ name, icon = 'folder', description = '' }) {
  const clean = name.trim();
  if (!clean) throw new Error('Give the category a name.');
  if (state.categories.some((c) => c.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error('A category with that name already exists.');
  }
  requireSchema({ category_id: true });
  const row = await driver.insertCategory({
    name: clean,
    icon,
    description: description.trim() || null,
    position: nextPosition(state.categories),
  });
  const category = { id: row.id, name: row.name, icon: row.icon, description: row.description || '', position: row.position };
  state.categories = [...state.categories, category];
  emit();
  return category;
}

export async function updateCategory(id, patch) {
  const previous = state.categories;
  const clean = { ...patch };
  if ('name' in clean) {
    clean.name = clean.name.trim();
    if (!clean.name) throw new Error('Give the category a name.');
    if (previous.some((c) => c.id !== id && c.name.toLowerCase() === clean.name.toLowerCase())) {
      throw new Error('A category with that name already exists.');
    }
  }
  state.categories = previous.map((c) => (c.id === id ? { ...c, ...clean } : c));
  emit();
  try {
    await driver.updateCategory(id, { ...clean, ...('description' in clean ? { description: clean.description || null } : {}) });
  } catch (error) {
    state.categories = previous;
    emit();
    throw error;
  }
}

export async function deleteCategory(id) {
  await driver.deleteCategory(id);
  const subIds = new Set(select.subsOf(id).map((s) => s.id));
  state.categories = state.categories.filter((c) => c.id !== id);
  state.subcategories = state.subcategories.filter((s) => s.categoryId !== id);
  state.bookmarks = state.bookmarks.map((b) =>
    b.categoryId === id || subIds.has(b.subcategoryId) ? { ...b, categoryId: null, subcategoryId: null } : b
  );
  emit();
}

/** direction: -1 moves up, +1 moves down */
export async function moveCategory(id, direction) {
  const ordered = [...state.categories].sort((a, b) => a.position - b.position);
  const index = ordered.findIndex((c) => c.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ordered.length) return;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  const previous = state.categories;
  const changed = [];
  state.categories = ordered.map((c, position) => {
    if (c.position !== position) changed.push({ id: c.id, position });
    return { ...c, position };
  });
  emit();
  try {
    await Promise.all(changed.map((c) => driver.updateCategory(c.id, { position: c.position })));
  } catch (error) {
    state.categories = previous;
    emit();
    throw error;
  }
}

/** True when a database error is about the folder colour column not existing yet. */
const isMissingColorColumn = (error) => /color/i.test(error?.message || '') && /column|schema/i.test(error?.message || '');

export async function createSubcategory(categoryId, name, color = null) {
  const clean = name.trim();
  if (!clean) throw new Error('Give the folder a name.');
  const siblings = select.subsOf(categoryId);
  if (siblings.some((s) => s.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error('That folder already exists in this category.');
  }
  const base = { category_id: categoryId, name: clean, position: nextPosition(siblings) };
  let row;
  try {
    row = await driver.insertSubcategory(color ? { ...base, color } : base);
  } catch (error) {
    // A database that hasn't had the colour column added yet: create the folder anyway.
    if (!color || !isMissingColorColumn(error)) throw error;
    row = await driver.insertSubcategory(base);
  }
  const sub = { id: row.id, categoryId: row.category_id, name: row.name, color: row.color || null, position: row.position };
  state.subcategories = [...state.subcategories, sub];
  emit();
  return sub;
}

/** patch: { name, color } — either or both. */
export async function updateSubcategory(id, { name, color } = {}) {
  const current = select.subcategory(id);
  if (!current) throw new Error('That folder no longer exists.');
  const clean = (name ?? current.name).trim();
  if (!clean) throw new Error('Give the folder a name.');
  if (select.subsOf(current.categoryId).some((s) => s.id !== id && s.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error('That folder already exists in this category.');
  }
  const patch = {};
  if (clean !== current.name) patch.name = clean;
  if (color !== undefined && color !== current.color) patch.color = color;
  if (!Object.keys(patch).length) return;
  try {
    await driver.updateSubcategory(id, patch);
  } catch (error) {
    if ('color' in patch && isMissingColorColumn(error)) {
      throw new Error('Folder colors need the latest database update: run supabase/schema.sql.');
    }
    throw error;
  }
  state.subcategories = state.subcategories.map((s) => (s.id === id ? { ...s, ...patch } : s));
  emit();
}

export async function deleteSubcategory(id) {
  await driver.deleteSubcategory(id);
  state.subcategories = state.subcategories.filter((s) => s.id !== id);
  // Bookmarks stay in the parent category.
  state.bookmarks = state.bookmarks.map((b) => (b.subcategoryId === id ? { ...b, subcategoryId: null } : b));
  emit();
}

export async function addStarterCategories() {
  for (const starter of STARTER_CATEGORIES) {
    let category = state.categories.find((c) => c.name.toLowerCase() === starter.name.toLowerCase());
    if (!category) category = await createCategory(starter);
    for (const name of starter.subs) {
      const exists = select.subsOf(category.id).some((s) => s.name.toLowerCase() === name.toLowerCase());
      if (!exists) await createSubcategory(category.id, name);
    }
  }
}
