// Import from a browser's bookmarks file (Chrome, Edge, Brave, Firefox all
// export the same "Netscape bookmark" HTML).
//
//   parseBookmarksFile(text)  -> every link with its folder path and date
//   planImport(parsed)        -> what will happen: new / already saved, how
//                                folders map onto categories and folders
//   runImport(plan)           -> writes it (store.importBookmarks)
//   previews                  -> afterwards, fills in descriptions and preview
//                                images a few at a time in the background
//
// Folder mapping: the browser's own root folders (Bookmarks bar, Other
// bookmarks, Mobile bookmarks…) are skipped. The next level becomes a
// category and every folder inside it becomes a folder, so the browser's
// structure comes across as it was; deeper levels keep their path in the
// folder name ("Tools / Build"). Links outside any folder go to the Inbox.

import { state, select, importBookmarks, updateBookmark } from '../data/store.js';
import { parseUrl, normalizeUrl } from '../lib/url.js';
import { fetchPreview } from './metadata.js';

// Names browsers give their built-in root folders, in a few languages.
const ROOT_NAMES = new Set(
  [
    'bookmarks bar', 'bookmarks toolbar', 'favorites bar', 'other bookmarks', 'other favorites', 'mobile bookmarks', 'bookmarks menu', 'bookmarks',
    'barra de favoritos', 'outros favoritos', 'favoritos móveis', 'favoritos do celular', 'favoritos', 'menu de favoritos',
    'barra de marcadores', 'otros marcadores', 'marcadores',
  ].map((name) => name.toLowerCase())
);

/** Reads the HTML file into [{ url, title, addedAt, path: [folder, …] }]. */
export function parseBookmarksFile(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const links = [];
  let folders = 0;

  // Netscape format: <DT><H3>Folder</H3><DL> …children… </DL> and <DT><A HREF>.
  const walk = (list, path) => {
    for (const dt of list.children) {
      if (dt.tagName !== 'DT') continue;
      const heading = dt.querySelector(':scope > h3');
      const anchor = dt.querySelector(':scope > a');
      if (heading) {
        folders += 1;
        const name = heading.textContent.trim();
        const isRoot =
          path.length === 0 &&
          (heading.hasAttribute('personal_toolbar_folder') || heading.hasAttribute('unfiled_bookmarks_folder') || ROOT_NAMES.has(name.toLowerCase()));
        // The folder's own <DL> follows the <H3>; some exporters nest it in the <DT>, others put it right after.
        const inner = dt.querySelector(':scope > dl') || (dt.nextElementSibling?.tagName === 'DL' ? dt.nextElementSibling : null);
        if (inner) walk(inner, isRoot ? path : [...path, name || 'Untitled']);
      } else if (anchor) {
        const url = anchor.getAttribute('href') || '';
        const added = Number(anchor.getAttribute('add_date'));
        links.push({
          url,
          title: anchor.textContent.trim(),
          addedAt: added > 0 ? new Date(added * 1000).toISOString() : null,
          path,
        });
      }
    }
  };
  const top = doc.querySelector('dl');
  if (top) walk(top, []);
  return { links, folders };
}

/** Works out what an import of `parsed` would do, without writing anything. */
export function planImport(parsed) {
  const seen = new Set(state.bookmarks.map((b) => b.normalizedUrl));
  const items = [];
  let duplicates = 0;
  let skipped = 0;
  // category name (lower case) -> { name, folders: Map(lower -> { name, count }), count }
  const tree = new Map();

  for (const link of parsed.links) {
    const url = parseUrl(link.url);
    // Only web links: no javascript:, chrome://, place:, file: …
    if (!url || !/^https?:$/.test(url.protocol)) {
      skipped += 1;
      continue;
    }
    const key = normalizeUrl(url.toString());
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    // Every browser folder becomes a folder here. h3aven nests one level, so a
    // folder deeper down keeps its whole path as its name: "Tools / Build".
    const [category = null, ...rest] = link.path;
    const folder = category && rest.length ? rest.join(' / ') : null;
    if (category) {
      const node = tree.get(category.toLowerCase()) || { name: category, folders: new Map(), count: 0 };
      node.count += 1;
      if (folder) {
        const leaf = node.folders.get(folder.toLowerCase()) || { name: folder, count: 0 };
        leaf.count += 1;
        node.folders.set(folder.toLowerCase(), leaf);
      }
      tree.set(category.toLowerCase(), node);
    }
    items.push({ url: url.toString(), title: link.title, addedAt: link.addedAt, category, folder, tags: [] });
  }

  // What will be created and what already exists, for the preview.
  const categories = [...tree.values()].map((node) => {
    const existing = state.categories.find((c) => c.name.toLowerCase() === node.name.toLowerCase());
    const existingFolders = existing ? select.subsOf(existing.id).map((s) => s.name.toLowerCase()) : [];
    return {
      name: node.name,
      count: node.count,
      isNew: !existing,
      folders: [...node.folders.values()].map((leaf) => ({ ...leaf, isNew: !existingFolders.includes(leaf.name.toLowerCase()) })),
    };
  });
  return {
    items,
    total: parsed.links.length,
    duplicates,
    skipped,
    tree: categories,
    newCategories: categories.filter((c) => c.isNew).length,
    newFolders: categories.reduce((sum, c) => sum + c.folders.filter((f) => f.isNew).length, 0),
    inbox: items.filter((item) => !item.category).length,
  };
}

/** Writes the plan. onProgress(done, total) while links are saved. Returns the new bookmark ids. */
export function runImport(plan, onProgress) {
  return importBookmarks(plan.items, onProgress);
}

// --- background previews ----------------------------------------------------------

const listeners = new Set();
const job = { queue: [], done: 0, total: 0, running: false, stopped: false, failedInARow: 0, note: '' };

export const previews = {
  get state() {
    return { done: job.done, total: job.total, running: job.running, note: job.note };
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Queues bookmarks that have no preview image yet. */
  start(ids) {
    const fresh = ids.filter((id) => !select.byId(id)?.thumbnail);
    job.queue.push(...fresh);
    job.total += fresh.length;
    job.note = '';
    job.stopped = false;
    if (!job.running) run();
    notify();
  },
  stop() {
    job.stopped = true;
    job.note = 'Paused. The remaining links keep their site icon.';
    notify();
  },
  resume() {
    if (!job.queue.length) return;
    job.stopped = false;
    job.note = '';
    if (!job.running) run();
    notify();
  },
};

function notify() {
  for (const listener of listeners) listener(previews.state);
}

const WORKERS = 2;
const GIVE_UP_AFTER = 8; // previews in a row that came back empty: the service is likely rate-limiting

async function run() {
  job.running = true;
  notify();
  const worker = async () => {
    while (job.queue.length && !job.stopped) {
      const id = job.queue.shift();
      const bookmark = select.byId(id);
      if (bookmark && !bookmark.thumbnail) {
        const preview = await fetchPreview(bookmark.url);
        if (preview.reachable && (preview.image || preview.description)) {
          job.failedInARow = 0;
          const patch = {};
          if (preview.image) patch.thumbnail = preview.image;
          if (preview.description && !bookmark.description) patch.description = preview.description;
          if (!bookmark.title && preview.title) patch.title = preview.title;
          try {
            await updateBookmark(id, patch);
          } catch {
            /* the bookmark stays with its site icon */
          }
        } else if (++job.failedInARow >= GIVE_UP_AFTER) {
          job.stopped = true;
          job.note = 'The preview service stopped answering (it has a daily limit). Resume later to fill in the rest.';
        }
      }
      job.done += 1;
      notify();
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  job.running = false;
  if (!job.queue.length) {
    job.note = job.total ? 'Previews done.' : '';
  }
  notify();
}
