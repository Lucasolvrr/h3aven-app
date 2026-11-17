// Persistence for preview mode (nobody signed in): the same rows the cloud
// driver would store, kept in this browser's localStorage. It survives
// refreshes, but it is device-local and is NOT the production data path —
// sign in to use the real database.

import { STORAGE } from '../config.js';
import { readJson, writeJson } from '../lib/dom.js';
import { buildSampleLibrary } from './sample.js';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const now = () => new Date().toISOString();

const emptyLibrary = () => ({ links: [], categories: [], subcategories: [], tags: [], linkTags: [], seeded: true });

/**
 * Preview mode starts empty. Browsers that were given the old sample library
 * lose it here: untouched, the whole library goes; otherwise only the sample
 * links do, and what the person added stays.
 */
function withoutSamples(db) {
  const isSample = (link) => link.source === 'sample';
  if (!db.links.some(isSample)) return db;
  if (db.links.every(isSample)) return emptyLibrary();
  const gone = new Set(db.links.filter(isSample).map((link) => link.id));
  return { ...db, links: db.links.filter((link) => !gone.has(link.id)), linkTags: db.linkTags.filter((pair) => !gone.has(pair.link_id)) };
}

export function createLocalDriver() {
  const stored = readJson(STORAGE.localLibrary, null);
  let db = stored && !stored.samplesRequested ? withoutSamples(stored) : stored || emptyLibrary();
  if (db !== stored) writeJson(STORAGE.localLibrary, db);
  const save = () => writeJson(STORAGE.localLibrary, db);

  return {
    kind: 'local',

    async load() {
      return {
        links: [...db.links].sort((a, b) => b.created_at.localeCompare(a.created_at)),
        categories: [...db.categories].sort((a, b) => a.position - b.position),
        subcategories: [...db.subcategories].sort((a, b) => a.position - b.position),
        tags: db.tags,
        linkTags: db.linkTags,
        schemaOutdated: false,
      };
    },

    async insertLink(row) {
      const record = {
        id: uid(),
        title: null,
        description: null,
        favicon_url: null,
        thumbnail_url: null,
        category_id: null,
        subcategory_id: null,
        notes: null,
        selected_text: null,
        is_favorite: false,
        content_type: 'link',
        fetch_status: 'ready',
        metadata: {},
        last_accessed_at: null,
        ...row,
        created_at: now(),
        updated_at: now(),
      };
      db.links.push(record);
      save();
      return record;
    },

    async updateLinks(ids, patch) {
      const wanted = new Set(ids);
      const updated = [];
      db.links = db.links.map((link) => {
        if (!wanted.has(link.id)) return link;
        const next = { ...link, ...patch, updated_at: now() };
        updated.push(next);
        return next;
      });
      save();
      return updated;
    },

    async deleteLinks(ids) {
      const wanted = new Set(ids);
      db.links = db.links.filter((link) => !wanted.has(link.id));
      db.linkTags = db.linkTags.filter((lt) => !wanted.has(lt.link_id));
      save();
    },

    async insertCategory(row) {
      if (db.categories.some((c) => c.name.toLowerCase() === row.name.toLowerCase())) {
        throw new Error('A collection with that name already exists');
      }
      const record = { id: uid(), icon: 'folder', description: null, position: 0, ...row, created_at: now() };
      db.categories.push(record);
      save();
      return record;
    },

    async updateCategory(id, patch) {
      let updated;
      db.categories = db.categories.map((c) => (c.id === id ? (updated = { ...c, ...patch }) : c));
      save();
      return updated;
    },

    async deleteCategory(id) {
      // Mirrors the database foreign keys: subcategories cascade, bookmarks
      // return to the Inbox.
      const subIds = new Set(db.subcategories.filter((s) => s.category_id === id).map((s) => s.id));
      db.categories = db.categories.filter((c) => c.id !== id);
      db.subcategories = db.subcategories.filter((s) => s.category_id !== id);
      db.links = db.links.map((link) =>
        link.category_id === id || subIds.has(link.subcategory_id) ? { ...link, category_id: null, subcategory_id: null } : link
      );
      save();
    },

    async insertSubcategory(row) {
      const clash = db.subcategories.some(
        (s) => s.category_id === row.category_id && s.name.toLowerCase() === row.name.toLowerCase()
      );
      if (clash) throw new Error('That folder already exists in this collection');
      const record = { id: uid(), position: 0, ...row, created_at: now() };
      db.subcategories.push(record);
      save();
      return record;
    },

    async updateSubcategory(id, patch) {
      let updated;
      db.subcategories = db.subcategories.map((s) => (s.id === id ? (updated = { ...s, ...patch }) : s));
      save();
      return updated;
    },

    async deleteSubcategory(id) {
      db.subcategories = db.subcategories.filter((s) => s.id !== id);
      db.links = db.links.map((link) => (link.subcategory_id === id ? { ...link, subcategory_id: null } : link));
      save();
    },

    /** Many links at once (imports); a row may bring its own created_at. */
    async insertLinks(rows) {
      const records = rows.map((row) => ({
        id: uid(), title: null, description: null, favicon_url: null, thumbnail_url: null, category_id: null, subcategory_id: null,
        notes: null, selected_text: null, is_favorite: false, content_type: 'link', fetch_status: 'ready', metadata: {}, last_accessed_at: null,
        ...row,
        created_at: row.created_at || now(),
        updated_at: row.created_at || now(),
      }));
      db.links.push(...records);
      save();
      return records;
    },

    async insertLinkTags(pairs) {
      db.linkTags.push(...pairs);
      save();
    },

    async ensureTags(names) {
      const rows = names.map((name) => {
        let tag = db.tags.find((t) => t.name === name);
        if (!tag) {
          tag = { id: uid(), name };
          db.tags.push(tag);
        }
        return tag;
      });
      save();
      return rows;
    },

    async replaceLinkTags(linkId, tagIds) {
      db.linkTags = db.linkTags.filter((lt) => lt.link_id !== linkId);
      db.linkTags.push(...tagIds.map((tag_id) => ({ link_id: linkId, tag_id })));
      save();
    },
  };
}

/** keepSamples: load the sample library on purpose (it stays until cleared). */
export function clearLocalLibrary({ keepSamples }) {
  writeJson(STORAGE.localLibrary, keepSamples ? { ...buildSampleLibrary(), samplesRequested: true } : emptyLibrary());
}
