// Persistence against Supabase. Every query runs with the signed-in user's
// JWT, so row level security scopes all reads and writes to that user.
//
// Both drivers (this one and local-driver.js) expose the same methods and
// speak in database rows (snake_case). store.js is the only caller.

const PAGE = 1000; // PostgREST caps a single response at 1000 rows.

function check(result) {
  if (result.error) throw new Error(result.error.message || 'Database request failed');
  return result.data;
}

async function fetchAll(buildQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const data = check(await buildQuery().range(from, from + PAGE - 1));
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

export function createCloudDriver(supabase) {
  return {
    kind: 'cloud',

    async load() {
      const links = await fetchAll(() => supabase.from('links').select('*').order('created_at', { ascending: false }));

      // The category tables only exist after the bookmark-manager migration
      // has been run. Without them the library is still readable; the app
      // shows a notice instead of failing.
      let schemaOutdated = false;
      let categories = [];
      let subcategories = [];
      try {
        [categories, subcategories] = await Promise.all([
          fetchAll(() => supabase.from('categories').select('*').order('position')),
          fetchAll(() => supabase.from('subcategories').select('*').order('position')),
        ]);
      } catch (error) {
        console.warn('Category tables unavailable — run the migration in supabase/schema.sql.', error);
        schemaOutdated = true;
      }

      const [tags, linkTags] = await Promise.all([
        fetchAll(() => supabase.from('tags').select('id, name').order('name')),
        fetchAll(() => supabase.from('link_tags').select('link_id, tag_id').order('link_id')),
      ]);

      return { links, categories, subcategories, tags, linkTags, schemaOutdated };
    },

    async insertLink(row) {
      return check(await supabase.from('links').insert(row).select().single());
    },

    /** Many links in one request (imports). */
    async insertLinks(rows) {
      if (!rows.length) return [];
      return check(await supabase.from('links').insert(rows).select());
    },

    async insertLinkTags(pairs) {
      if (!pairs.length) return;
      check(await supabase.from('link_tags').insert(pairs));
    },

    async updateLinks(ids, patch) {
      if (!ids.length) return [];
      return check(await supabase.from('links').update(patch).in('id', ids).select());
    },

    async deleteLinks(ids) {
      if (!ids.length) return;
      check(await supabase.from('links').delete().in('id', ids));
    },

    async insertCategory(row) {
      return check(await supabase.from('categories').insert(row).select().single());
    },

    async updateCategory(id, patch) {
      return check(await supabase.from('categories').update(patch).eq('id', id).select().single());
    },

    async deleteCategory(id) {
      // Foreign keys do the rest: subcategories cascade, bookmarks fall back
      // to the Inbox (category_id / subcategory_id set to null).
      check(await supabase.from('categories').delete().eq('id', id));
    },

    async insertSubcategory(row) {
      return check(await supabase.from('subcategories').insert(row).select().single());
    },

    async updateSubcategory(id, patch) {
      return check(await supabase.from('subcategories').update(patch).eq('id', id).select().single());
    },

    async deleteSubcategory(id) {
      check(await supabase.from('subcategories').delete().eq('id', id));
    },

    /** Returns tag rows for the given names, creating the ones that don't exist. */
    async ensureTags(names) {
      if (!names.length) return [];
      const existing = check(await supabase.from('tags').select('id, name').in('name', names));
      const known = new Set(existing.map((t) => t.name));
      const missing = names.filter((name) => !known.has(name));
      if (!missing.length) return existing;
      const created = check(await supabase.from('tags').insert(missing.map((name) => ({ name }))).select('id, name'));
      return [...existing, ...created];
    },

    async replaceLinkTags(linkId, tagIds) {
      check(await supabase.from('link_tags').delete().eq('link_id', linkId));
      if (tagIds.length) {
        check(await supabase.from('link_tags').insert(tagIds.map((tag_id) => ({ link_id: linkId, tag_id }))));
      }
    },
  };
}
