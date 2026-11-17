// Dialogs: quick-add, bookmark detail, category editor, move menu, media search.
// They read from the store and call store actions; they never touch a driver.

import { h, debounce, formatDate, timeAgo, copyText, plural } from '../lib/dom.js';
import { iconEl, CATEGORY_ICONS } from '../lib/icons.js';
import { FOLDER_COLORS, folderColor, randomFolderColor, colorVars } from '../lib/colors.js';
import { parseUrl, extractUrls, domainOf, faviconFor } from '../lib/url.js';
import {
  state, select, subscribe, addBookmark, updateBookmark, moveBookmarks, setFavorite, deleteBookmarks, setTags, markOpened,
  createCategory, updateCategory, deleteCategory, createSubcategory, updateSubcategory, deleteSubcategory, addMedia, cleanTagNames,
} from '../data/store.js';
import { fetchPreview, searchMedia } from '../services/metadata.js';
import { suggestLocation } from '../services/organize.js';
import { openModal, openMenu, toast, attempt, confirmDialog } from './overlay.js';
import { fallbackTile, knownRatio } from './masonry.js';
import { segmentedControl } from './segmented.js';

// --- shared pieces ---------------------------------------------------------------

/** Category + subcategory selects that stay in sync. */
function locationSelects({ categoryId = null, subcategoryId = null, onChange } = {}) {
  const category = h('select', { class: 'select', 'aria-label': 'Collection' });
  const sub = h('select', { class: 'select', 'aria-label': 'Folder' });

  const fillCategories = () => {
    category.replaceChildren(
      h('option', { value: '' }, 'Inbox'),
      ...state.categories.map((c) => h('option', { value: c.id }, c.name))
    );
  };
  const fillSubs = (selected) => {
    const subs = category.value ? select.subsOf(category.value) : [];
    sub.replaceChildren(
      h('option', { value: '' }, subs.length ? 'No folder' : '—'),
      ...subs.map((s) => h('option', { value: s.id }, s.name))
    );
    sub.disabled = !subs.length;
    sub.value = subs.some((s) => s.id === selected) ? selected : '';
  };
  const set = (nextCategory, nextSub) => {
    category.value = select.category(nextCategory) ? nextCategory : '';
    fillSubs(nextSub || '');
  };

  fillCategories();
  set(categoryId, subcategoryId);
  category.addEventListener('change', () => {
    fillSubs('');
    onChange?.(get(), 'user');
  });
  sub.addEventListener('change', () => onChange?.(get(), 'user'));

  function get() {
    return { categoryId: category.value || null, subcategoryId: sub.value || null };
  }
  return { el: h('div', { class: 'dialog-row' }, category, sub), get, set };
}

/** Chips + free text. Enter or comma adds, Backspace removes the last one. */
function tagEditor({ tags = [], onChange } = {}) {
  let current = [...tags];
  const listId = `tags-${Math.random().toString(36).slice(2, 8)}`;
  const input = h('input', { type: 'text', placeholder: 'Add tag…', 'aria-label': 'Add tag', list: listId, autocomplete: 'off' });
  const datalist = h('datalist', { id: listId }, select.tagNames().map((name) => h('option', { value: name })));
  const root = h('div', { class: 'tag-editor', onClick: (event) => event.target === root && input.focus() });

  const render = () => {
    root.replaceChildren(
      ...current.map((name) =>
        h(
          'span',
          { class: 'chip' },
          name,
          h(
            'button',
            { type: 'button', class: 'chip-x', 'aria-label': `Remove tag ${name}`, onClick: () => commit(current.filter((t) => t !== name)) },
            iconEl('x', 11)
          )
        )
      ),
      input,
      datalist
    );
  };
  const commit = (next) => {
    current = cleanTagNames(next);
    render();
    onChange?.(current);
  };
  const flush = () => {
    const parts = input.value.split(',').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return;
    input.value = '';
    commit([...current, ...parts]);
    input.focus();
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && input.value.trim()) {
      event.preventDefault();
      flush();
    } else if (event.key === ',') {
      event.preventDefault();
      flush();
    } else if (event.key === 'Backspace' && !input.value && current.length) {
      commit(current.slice(0, -1));
      input.focus();
    }
  });
  input.addEventListener('blur', flush);
  // Picking a datalist suggestion fires `input` with the full tag name.
  input.addEventListener('input', () => {
    if (select.tagNames().includes(input.value)) flush();
  });

  render();
  return { el: root, get: () => (flush(), current) };
}

export function openLink(bookmark) {
  window.open(bookmark.url, '_blank', 'noopener');
  markOpened(bookmark.id);
}

export function toggleFavorite(id) {
  const bookmark = select.byId(id);
  if (!bookmark) return;
  attempt(() => setFavorite([id], !bookmark.isFavorite), bookmark.isFavorite ? 'Removed from favorites' : 'Added to favorites');
}

/** Menu of destinations (Inbox, categories, folders) for one or many bookmarks. */
export function openMoveMenu(anchor, ids, { align = 'start', onDone } = {}) {
  const move = (categoryId, subcategoryId, label) => async () => {
    const ok = await attempt(
      () => moveBookmarks(ids, categoryId, subcategoryId),
      ids.length === 1 ? `Moved to ${label}` : `${plural(ids.length, 'bookmark')} moved to ${label}`
    );
    if (ok) onDone?.();
  };
  const items = [{ heading: 'Move to' }, { label: 'Inbox', icon: 'inbox', onSelect: move(null, null, 'Inbox') }];
  if (state.categories.length) items.push({ separator: true });
  for (const category of state.categories) {
    items.push({ label: category.name, icon: category.icon, onSelect: move(category.id, null, category.name) });
    for (const sub of select.subsOf(category.id)) {
      items.push({ label: sub.name, indent: true, onSelect: move(category.id, sub.id, `${category.name} / ${sub.name}`) });
    }
  }
  openMenu(anchor, items, { align });
}

// --- quick add ----------------------------------------------------------------------

/** Saves several links at once, fills in their metadata in the background. */
async function saveMany(urls, location, tags) {
  let saved = 0;
  let skipped = 0;
  const pending = [];
  for (const url of urls) {
    try {
      const bookmark = await addBookmark({ url, ...location, tags, status: 'pending' });
      pending.push(bookmark);
      saved += 1;
    } catch (error) {
      if (error.duplicate) skipped += 1;
      else console.error(error);
    }
  }
  toast(`${plural(saved, 'bookmark')} saved${skipped ? ` · ${skipped} already in your library` : ''}`);
  // Three at a time: polite to the metadata service, still quick.
  const queue = [...pending];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await enrich(next);
  };
  await Promise.all([worker(), worker(), worker()]);
}

async function enrich(bookmark) {
  const preview = await fetchPreview(bookmark.url);
  if (!select.byId(bookmark.id)) return;
  await updateBookmark(bookmark.id, {
    title: select.byId(bookmark.id).title || preview.title,
    description: preview.description,
    thumbnail: preview.image,
    favicon: preview.favicon,
    status: preview.reachable ? 'ready' : 'failed',
  }).catch((error) => console.error(error));
}

export function openQuickAdd({ url = '', categoryId = null, subcategoryId = null } = {}) {
  let preview = null; // resolved metadata for `previewUrl`
  let previewUrl = '';
  let token = 0;
  let titleEdited = false;
  let locationTouched = Boolean(categoryId);

  const urlInput = h('input', {
    class: 'input qa-url', type: 'text', inputmode: 'url', placeholder: 'Paste a link…', autofocus: true,
    autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Link', value: url,
  });
  const error = h('p', { class: 'field-error', hidden: true });
  const previewBox = h('div', { class: 'qa-preview', hidden: true });
  const note = h('div', { class: 'qa-note', hidden: true });
  const hint = h('span', { class: 'hint' }, 'No collection? It goes to your Inbox.');
  const location = locationSelects({
    categoryId, subcategoryId,
    onChange: () => {
      locationTouched = true;
      hint.textContent = 'No collection? It goes to your Inbox.';
    },
  });
  const tags = tagEditor();
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save');
  const titleInput = h('input', { class: 'qa-title', type: 'text', placeholder: 'Title…', 'aria-label': 'Title', autocomplete: 'off' });
  titleInput.addEventListener('input', () => (titleEdited = true));

  const form = h(
    'form',
    { class: 'dialog', novalidate: true },
    h(
      'div',
      { class: 'dialog-head' },
      h('h2', { class: 'dialog-title' }, 'New bookmark'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onClick: () => modal.close() }, iconEl('x', 16))
    ),
    h('div', { class: 'field' }, urlInput, error),
    previewBox,
    note,
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Save to'), location.el),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Tags'), tags.el),
    h('div', { class: 'dialog-foot' }, hint, h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => modal.close() }, 'Cancel'), save)
  );
  const modal = openModal({ className: 'quickadd', label: 'New bookmark', content: form, align: 'dock' });

  const showNote = (text, action) => {
    note.replaceChildren(iconEl('info', 15), h('span', null, text), action || '');
    note.hidden = false;
  };

  const renderPreview = (parsed) => {
    const domain = domainOf(parsed);
    const thumb = h('div', { class: 'qa-thumb' });
    if (!preview) {
      thumb.classList.add('shimmer');
    } else if (preview.image) {
      const img = h('img', { src: preview.image, alt: '', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => thumb.replaceChildren(fallbackTile({ domain, favicon: preview.favicon })));
      thumb.append(img);
    } else {
      thumb.append(fallbackTile({ domain, favicon: preview.favicon }));
    }
    const favicon = h('img', { src: (preview && preview.favicon) || faviconFor(domain), alt: '', referrerpolicy: 'no-referrer' });
    favicon.addEventListener('error', () => favicon.remove());
    previewBox.replaceChildren(
      thumb,
      h(
        'div',
        { class: 'qa-info' },
        preview ? titleInput : h('div', { class: 'qa-line shimmer', style: 'width:70%' }),
        h('div', { class: 'qa-domain' }, favicon, domain, preview && !preview.reachable ? ' · preview unavailable' : '')
      )
    );
    previewBox.hidden = false;
  };

  const inspect = async () => {
    error.hidden = true;
    note.hidden = true;
    save.disabled = false;
    save.textContent = 'Save';
    const raw = urlInput.value.trim();

    const many = extractUrls(raw);
    if (many.length > 1) {
      previewBox.hidden = true;
      preview = null;
      previewUrl = '';
      showNote(`${many.length} links found — each one is saved as its own bookmark.`);
      save.textContent = `Save ${many.length}`;
      return;
    }

    const parsed = parseUrl(raw);
    if (!parsed) {
      previewBox.hidden = true;
      return;
    }
    const href = parsed.toString();
    const duplicate = select.findDuplicate(href);
    if (duplicate) {
      previewBox.hidden = true;
      save.disabled = true;
      showNote(
        `Already saved in ${select.locationLabel(duplicate)}.`,
        h('button', { type: 'button', class: 'btn btn-subtle', onClick: () => (modal.close(), openBookmark(duplicate.id)) }, 'Open')
      );
      return;
    }
    if (href === previewUrl) return;

    previewUrl = href;
    preview = null;
    titleEdited = false;
    titleInput.value = '';
    renderPreview(parsed);
    const mine = (token += 1);
    const result = await fetchPreview(href);
    if (mine !== token) return; // a newer URL was typed meanwhile
    preview = result;
    if (!titleEdited) titleInput.value = result.title;
    renderPreview(parsed);

    if (!locationTouched) {
      const suggestion = suggestLocation({ url: href, title: result.title, description: result.description });
      if (suggestion) {
        location.set(suggestion.categoryId, suggestion.subcategoryId);
        hint.textContent = `Suggested · ${suggestion.reason}`;
      }
    }
  };

  const inspectSoon = debounce(inspect, 350);
  urlInput.addEventListener('input', inspectSoon);
  urlInput.addEventListener('paste', () => setTimeout(() => (inspectSoon.cancel(), inspect()), 0));
  if (url) inspect();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    inspectSoon.cancel();
    const raw = urlInput.value.trim();
    const where = location.get();
    const tagNames = tags.get();

    const many = extractUrls(raw);
    if (many.length > 1) {
      modal.close();
      saveMany(many, where, tagNames);
      return;
    }

    const parsed = parseUrl(raw);
    if (!parsed) {
      error.textContent = raw ? 'That does not look like a valid link.' : 'Paste a link to save it.';
      error.hidden = false;
      urlInput.focus();
      return;
    }

    save.disabled = true;
    const ready = preview && previewUrl === parsed.toString();
    try {
      const bookmark = await addBookmark({
        url: parsed.toString(),
        title: titleInput.value.trim() || (ready ? preview.title : ''),
        description: ready ? preview.description : '',
        thumbnail: ready ? preview.image : '',
        favicon: ready ? preview.favicon : '',
        status: ready ? (preview.reachable ? 'ready' : 'failed') : 'pending',
        tags: tagNames,
        ...where,
      });
      modal.close();
      toast(`Saved to ${select.locationLabel(bookmark)}`, { action: { label: 'View', onClick: () => openBookmark(bookmark.id) } });
      // Saved before the preview arrived: finish the metadata in the background.
      if (!ready) enrich(bookmark);
    } catch (err) {
      save.disabled = false;
      if (err.duplicate) {
        inspect();
      } else {
        error.textContent = err.message || 'Could not save this bookmark.';
        error.hidden = false;
      }
    }
  });
}

// --- bookmark detail ----------------------------------------------------------------

const MEDIA_LABEL = { movie: 'Movie', tv: 'Series', music: 'Music' };

/** Up to 8 other bookmarks to suggest next to `bookmark`: same folder first, then
 *  same category; an Inbox link gets ones from the same site or with a shared tag. */
function relatedTo(bookmark) {
  let pool;
  if (bookmark.isMedia) pool = select.media().filter((b) => b.contentType === bookmark.contentType);
  else if (bookmark.categoryId) {
    pool = [...(bookmark.subcategoryId ? select.inSubcategory(bookmark.subcategoryId) : []), ...select.inCategory(bookmark.categoryId)];
  } else {
    pool = select.bookmarks().filter((b) => (b.domain && b.domain === bookmark.domain) || b.tags.some((tag) => bookmark.tags.includes(tag)));
  }
  const seen = new Set([bookmark.id]);
  const unique = pool.filter((b) => !seen.has(b.id) && seen.add(b.id));
  // Keep folder-first order, but within it prefer ones with a preview image.
  return unique
    .map((b, index) => ({ b, rank: index + (b.thumbnail ? 0 : 1000) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 8)
    .map((entry) => entry.b);
}

/**
 * The bookmark viewer: one centred column over a near-black backdrop —
 * the title and actions on top, the page's preview large in the middle and
 * everything else (where it lives, site, notes, tags, more like this) below.
 * sequence(): ids of the list it was opened from, for the previous / next arrows.
 */
// --- viewer <-> URL ----------------------------------------------------------------

const VIEWER_MARK = '!b=';
let activeViewer = null; // { close(fromUrl) } while a bookmark is open

const pageHash = () => location.hash.split('!')[0] || '#/';
export function viewerIdInUrl() {
  const at = location.hash.indexOf(VIEWER_MARK);
  return at < 0 ? null : decodeURIComponent(location.hash.slice(at + VIEWER_MARK.length));
}
export const isViewerOpen = () => Boolean(activeViewer);
/** The URL lost its bookmark (Back): close without touching history again. */
export function closeViewerFromUrl() {
  activeViewer?.close(true);
}

/** origin: the element that was clicked (a cover); the preview grows out of it. */
export function openBookmark(id, { sequence = null, origin = null } = {}) {
  if (!select.byId(id)) return;
  let currentId = id;
  let editing = false;

  const header = h('header', { class: 'viewer-header' });
  const stage = h('div', { class: 'viewer-stage' });
  const info = h('div', { class: 'viewer-info' });
  const column = h('div', { class: 'viewer-col' }, header, stage, info);

  const ids = () => (sequence ? sequence().filter((value) => select.byId(value)) : []);
  const step = (delta) => {
    const list = ids();
    const index = list.indexOf(currentId);
    if (index < 0 || !list[index + delta]) return;
    currentId = list[index + delta];
    render({ direction: delta });
  };

  // Opening adds a history entry, so Back closes the viewer; a link that
  // already names the bookmark (shared, or reloaded) is used as it is.
  let pushed = false;
  if (viewerIdInUrl() !== id) {
    history.pushState(null, '', `${pageHash()}${VIEWER_MARK}${encodeURIComponent(id)}`);
    pushed = true;
  }
  let closedFromUrl = false;

  const modal = openModal({
    className: 'viewer',
    label: 'Bookmark',
    content: column,
    onClose: () => {
      unsubscribe();
      activeViewer = null;
      modal.panel.dispatchEvent(new Event('viewer-closed'));
      if (closedFromUrl) return;
      if (pushed) history.back();
      else history.replaceState(null, '', pageHash());
    },
  });
  activeViewer = {
    close(fromUrl) {
      closedFromUrl = fromUrl;
      modal.close();
    },
  };

  // A click on the dark area around the column closes, as with any lightbox.
  modal.panel.addEventListener('click', (event) => {
    if (event.target === modal.panel || event.target === column) modal.close();
  });
  modal.panel.addEventListener('keydown', (event) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'ArrowRight') step(1);
  });

  // Edits made elsewhere (or here) repaint in place.
  const unsubscribe = subscribe(() => {
    if (!select.byId(currentId)) return modal.close();
    const active = document.activeElement;
    // Don't repaint under someone typing (tags, notes, the edit form).
    if (editing || (column.contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName))) return;
    const focusKey = column.contains(active) ? active.dataset.key : null;
    render({ keepStage: true });
    if (focusKey) column.querySelector(`[data-key="${focusKey}"]`)?.focus({ preventScroll: true });
  });

  function render({ direction = 0, keepStage = false } = {}) {
    const bookmark = select.byId(currentId);
    if (!bookmark) return;
    if (viewerIdInUrl() !== currentId) history.replaceState(null, '', `${pageHash()}${VIEWER_MARK}${encodeURIComponent(currentId)}`);
    const label = bookmark.title || bookmark.domain || bookmark.url;
    modal.panel.setAttribute('aria-label', label);
    const list = ids();
    const index = list.indexOf(currentId);

    // --- header: title, then the actions -----------------------------------------------
    const iconButton = (name, text, onClick, extra = {}) =>
      h('button', { type: 'button', class: `viewer-icon${extra.class ? ` ${extra.class}` : ''}`, 'aria-label': text, title: text, onClick, ...extra.attrs }, iconEl(name, 16));

    const more = iconButton('more', 'More actions', () =>
      openMenu(
        more,
        [
          { label: 'Edit title & description', icon: 'pencil', onSelect: () => editText(bookmark) },
          { label: 'Copy link', icon: 'copy', onSelect: copy },
          { separator: true },
          { label: 'Delete', icon: 'trash', danger: true, onSelect: remove },
        ],
        { align: 'end' }
      ),
      { attrs: { 'aria-haspopup': 'menu', dataset: { key: 'more' } } }
    );
    const copy = async () => toast((await copyText(bookmark.url)) ? 'Link copied' : 'Could not copy the link', { type: 'info' });
    const remove = async () => {
      const yes = await confirmDialog({ title: 'Delete this bookmark?', message: `“${label}” will be removed from your library. This can’t be undone.` });
      if (yes) await attempt(() => deleteBookmarks([currentId]), 'Bookmark deleted');
    };

    header.replaceChildren(
      h('h2', { class: 'viewer-title' }, label),
      h(
        'div',
        { class: 'viewer-actions' },
        list.length > 1 && iconButton('arrow-left', 'Previous', () => step(-1), { attrs: { disabled: index <= 0, dataset: { key: 'prev' } } }),
        list.length > 1 && iconButton('arrow-right', 'Next', () => step(1), { attrs: { disabled: index < 0 || index >= list.length - 1, dataset: { key: 'next' } } }),
        iconButton('heart', bookmark.isFavorite ? 'Remove from favorites' : 'Add to favorites', () => attempt(() => setFavorite([currentId], !bookmark.isFavorite)), {
          class: bookmark.isFavorite ? 'is-on' : '',
          attrs: { 'aria-pressed': String(bookmark.isFavorite), dataset: { key: 'favorite' } },
        }),
        more,
        iconButton('arrow-up-right', 'Open Link', () => openLink(bookmark), { class: 'is-primary', attrs: { dataset: { key: 'open' } } }),
        iconButton('x', 'Close', () => modal.close(), { class: 'is-close' })
      )
    );

    // --- stage: the preview, large ----------------------------------------------------
    if (!keepStage) {
      let shot;
      if (bookmark.thumbnail) {
        // Width and height reserve the preview's space before it loads (no jump):
        // the ratio the grid remembered for this image, or the usual shape.
        const ratio = knownRatio(bookmark.thumbnail) || (bookmark.isMedia ? (bookmark.contentType === 'music' ? 1 : 2 / 3) : 1.6);
        shot = h('img', { class: 'viewer-shot', src: bookmark.thumbnail, alt: `Preview of ${label}`, referrerpolicy: 'no-referrer', width: '1200', height: String(Math.round(1200 / ratio)) });
        shot.addEventListener('error', () => shot.replaceWith(h('div', { class: 'viewer-shot is-fallback' }, fallbackTile(bookmark))));
        // Posters, covers and portrait images are shown whole; wide page previews fill the column.
        shot.addEventListener('load', () => {
          shot.width = shot.naturalWidth;
          shot.height = shot.naturalHeight;
          stage.classList.toggle('is-fit', bookmark.isMedia || shot.naturalHeight > shot.naturalWidth * 1.05);
        });
      } else {
        shot = h('div', { class: 'viewer-shot is-fallback' }, fallbackTile(bookmark));
      }
      const link = h('a', { class: 'viewer-shot-link', href: bookmark.url, target: '_blank', rel: 'noopener noreferrer', title: 'Open Link', onClick: () => markOpened(currentId) }, shot);
      stage.classList.toggle('is-fit', Boolean(bookmark.isMedia));
      stage.replaceChildren(link);
      if (direction && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        link.animate([{ opacity: 0, transform: `translateX(${direction * 24}px) scale(0.99)` }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
      }
      modal.panel.scrollTo({ top: 0 });
      if (origin) {
        zoomFrom(origin, shot);
        origin = null; // only the first opening grows out of the cover
      }
    }

    // --- info: pills, description, tags + notes, more like this --------------------------
    const pill = (content, extra = {}) => h(extra.href ? 'a' : 'button', { class: 'viewer-pill', ...(extra.href ? {} : { type: 'button' }), ...extra }, content);
    const favicon = h('img', { class: 'viewer-pill-favicon', src: bookmark.favicon || faviconFor(bookmark.domain), alt: '', referrerpolicy: 'no-referrer' });
    favicon.addEventListener('error', () => favicon.remove());

    const place = bookmark.isMedia
      ? h('span', { class: 'viewer-pill is-static' }, MEDIA_LABEL[bookmark.contentType])
      : pill(
          [
            iconEl(bookmark.categoryId ? select.category(bookmark.categoryId)?.icon || 'folder' : 'inbox', 14),
            h('span', null, select.locationLabel(bookmark)),
            bookmark.tags.length > 0 && h('span', { class: 'viewer-pill-muted' }, `· ${plural(bookmark.tags.length, 'tag')}`),
            iconEl('chevron-down', 13),
          ],
          { 'aria-haspopup': 'menu', title: 'Folder and tags', dataset: { key: 'place' }, onClick: (event) => openPlaceMenu(event.currentTarget, bookmark) }
        );
    const live = pill([h('span', { class: 'viewer-pill-muted' }, 'Live at'), favicon, h('span', null, bookmark.domain || 'link')], {
      href: bookmark.url, target: '_blank', rel: 'noopener noreferrer', onClick: () => markOpened(currentId),
    });
    const when = [`Saved ${timeAgo(bookmark.createdAt) || formatDate(bookmark.createdAt)}`, bookmark.lastAccessedAt ? `opened ${timeAgo(bookmark.lastAccessedAt)}` : 'never opened'];
    if (bookmark.isMedia && bookmark.meta.year) when.unshift(String(bookmark.meta.year));
    if (bookmark.isMedia && bookmark.meta.artist) when.unshift(bookmark.meta.artist);

    const meta = h('div', { class: 'viewer-meta' }, h('div', { class: 'viewer-pills' }, place, live), h('p', { class: 'viewer-when' }, when.join(' · ')));
    const intro = (bookmark.description || bookmark.selectedText) && h(
      'div',
      { class: 'viewer-intro' },
      bookmark.description && h('p', { class: 'viewer-desc' }, bookmark.description),
      bookmark.selectedText && h('blockquote', { class: 'viewer-quote' }, bookmark.selectedText)
    );

    const related = relatedTo(bookmark);
    const relatedSection =
      related.length > 0 &&
      h(
        'section',
        // Covers keep their own shape: square albums, tall posters.
        { class: `viewer-related${bookmark.isMedia ? (bookmark.contentType === 'music' ? ' is-square' : ' is-poster') : ''}` },
        h('h3', { class: 'viewer-related-title' }, 'More Like This'),
        h(
          'div',
          { class: 'viewer-related-grid' },
          related.map((item) => {
            const name = item.title || item.domain || item.url;
            const tile = h('button', {
              type: 'button', class: 'viewer-related-item', title: name, 'aria-label': `Open ${name}`,
              onClick: () => {
                currentId = item.id;
                render({ direction: 1 });
              },
            });
            if (item.thumbnail) {
              const img = h('img', { src: item.thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
              img.addEventListener('error', () => img.replaceWith(fallbackTile(item)));
              tile.append(img);
            } else tile.append(fallbackTile(item));
            return tile;
          })
        )
      );

    info.replaceChildren(meta, intro || '', relatedSection || '');
  }

  /**
   * One menu for where the bookmark lives: pick its folder (one place), and
   * tick its tags on or off (any number), or type a new one.
   */
  function openPlaceMenu(anchor, bookmark) {
    let tags = [...bookmark.tags];
    const move = (categoryId, subcategoryId, label) => () =>
      attempt(() => moveBookmarks([currentId], categoryId, subcategoryId), `Moved to ${label}`);
    const here = (categoryId, subcategoryId) => bookmark.categoryId === categoryId && (bookmark.subcategoryId || null) === subcategoryId;
    const toggleTag = (name) => (on) => {
      tags = on ? [...tags, name] : tags.filter((tag) => tag.toLowerCase() !== name.toLowerCase());
      attempt(() => setTags(currentId, tags));
    };

    const items = [{ heading: 'Saved in' }, { label: 'Inbox', icon: 'inbox', checked: !bookmark.categoryId, onSelect: move(null, null, 'Inbox') }];
    for (const category of state.categories) {
      items.push({ label: category.name, icon: category.icon, checked: here(category.id, null), onSelect: move(category.id, null, category.name) });
      for (const sub of select.subsOf(category.id)) {
        items.push({ label: sub.name, indent: true, checked: here(category.id, sub.id), onSelect: move(category.id, sub.id, `${category.name} / ${sub.name}`) });
      }
    }
    const names = [...new Set([...tags, ...select.tagNames()])];
    items.push({ separator: true }, { heading: 'Tags' });
    for (const name of names) items.push({ label: name, checkbox: true, checked: tags.includes(name), onSelect: toggleTag(name) });
    items.push({
      input: {
        placeholder: 'New tag…',
        onSubmit: (value) => {
          const [name] = cleanTagNames([value]);
          if (!name || tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) return null;
          toggleTag(name)(true);
          return { label: name, checkbox: true, checked: true, onSelect: toggleTag(name) };
        },
      },
    });
    openMenu(anchor, items);
  }

  /** Swaps the title and description for a small form. */
  function editText(bookmark) {
    editing = true;
    const titleField = h('input', { class: 'input', type: 'text', 'aria-label': 'Title', value: bookmark.title, autocomplete: 'off' });
    const descField = h('textarea', { class: 'textarea', 'aria-label': 'Description', placeholder: 'Description…' });
    descField.value = bookmark.description;
    const done = () => {
      editing = false;
      render({ keepStage: true });
    };
    const form = h(
      'form',
      { class: 'viewer-edit' },
      titleField,
      descField,
      h('div', { class: 'dialog-foot' }, h('button', { type: 'button', class: 'btn btn-ghost', onClick: done }, 'Cancel'), h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save'))
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const ok = await attempt(() => updateBookmark(currentId, { title: titleField.value.trim(), description: descField.value.trim() }), 'Bookmark updated');
      if (ok) done();
    });
    info.querySelector('.viewer-intro')?.remove();
    info.querySelector('.viewer-meta').after(form);
    titleField.focus();
  }

  /**
   * The cover that was clicked grows into the preview: the preview starts at
   * the cover's place and size and glides to its own, while the rest of the
   * viewer fades in around it. The cover itself is hidden until the viewer closes.
   */
  function zoomFrom(source, target) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const from = source.getBoundingClientRect();
    if (!from.width) return;
    const play = () => {
      const to = target.getBoundingClientRect();
      if (!to.width || !to.height) return;
      source.style.visibility = 'hidden';
      const restore = () => (source.style.visibility = '');
      modal.panel.addEventListener('viewer-closed', restore, { once: true });
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      target.animate(
        [
          { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width}, ${from.height / to.height})`, borderRadius: '16px' },
          { transformOrigin: 'top left', transform: 'none' },
        ],
        { duration: 560, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
      for (const part of [header, info]) {
        part.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 200, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'backwards' });
      }
    };
    // The preview needs its final size first: a cached cover has it at once.
    if (target.tagName !== 'IMG' || (target.complete && target.naturalWidth)) requestAnimationFrame(play);
    else target.addEventListener('load', () => requestAnimationFrame(play), { once: true });
  }

  render();
}

// --- categories & folders --------------------------------------------------------------

export function openCategoryDialog(category = null) {
  let chosen = category?.icon || 'folder';
  const name = h('input', { class: 'input', type: 'text', value: category?.name || '', placeholder: 'e.g. Research', autofocus: true, maxlength: '48', autocomplete: 'off' });
  const description = h('input', { class: 'input', type: 'text', value: category?.description || '', placeholder: 'Optional', maxlength: '140', autocomplete: 'off' });
  const error = h('p', { class: 'field-error', hidden: true });
  const picker = h('div', { class: 'icon-picker', role: 'group', 'aria-label': 'Icon' });
  const paintPicker = () =>
    picker.replaceChildren(
      ...CATEGORY_ICONS.map((key) =>
        h(
          'button',
          { type: 'button', 'aria-label': key.replace('-', ' '), 'aria-pressed': String(key === chosen), onClick: () => ((chosen = key), paintPicker()) },
          iconEl(key, 16)
        )
      )
    );
  paintPicker();
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, category ? 'Save' : 'Create collection');
  const form = h(
    'form',
    { class: 'dialog' },
    h('h2', { class: 'dialog-title' }, category ? 'Edit collection' : 'New collection'),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), name, error),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Description'), description),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Icon'), picker),
    h('div', { class: 'dialog-foot' }, h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => modal.close() }, 'Cancel'), submit)
  );
  const modal = openModal({ label: category ? 'Edit collection' : 'New collection', content: form, align: 'dock' });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const payload = { name: name.value, icon: chosen, description: description.value.trim() };
      if (category) {
        await updateCategory(category.id, payload);
        toast('Collection updated');
      } else {
        const created = await createCategory(payload);
        toast('Collection created');
        location.hash = `#/c/${created.id}`;
      }
      modal.close();
    } catch (err) {
      error.textContent = err.message || 'Could not save the collection.';
      error.hidden = false;
      submit.disabled = false;
    }
  });
}

export async function confirmDeleteCategory(category) {
  const count = select.inCategory(category.id).length;
  const yes = await confirmDialog({
    title: `Delete “${category.name}”?`,
    message: count
      ? `Its folders are removed and ${plural(count, 'bookmark')} go back to your Inbox. Nothing you saved is deleted.`
      : 'Its folders are removed too.',
  });
  if (!yes) return;
  if (await attempt(() => deleteCategory(category.id), 'Collection deleted')) {
    if (location.hash.includes(category.id)) location.hash = '#/';
  }
}

/** New folder (random colour, changeable) or edit an existing one's name and colour. */
export function openFolderDialog(categoryId, folder = null) {
  const title = folder ? 'Edit folder' : 'New folder';
  let color = (folder ? folderColor(folder) : randomFolderColor(select.subsOf(categoryId))).id;

  const input = h('input', { class: 'input', type: 'text', value: folder?.name || '', placeholder: 'e.g. Typography', autofocus: true, autocomplete: 'off', maxlength: '80' });
  const error = h('p', { class: 'field-error', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, folder ? 'Save' : 'Create Folder');
  const swatches = h(
    'div',
    { class: 'swatches', role: 'radiogroup', 'aria-label': 'Folder color' },
    FOLDER_COLORS.map((option) =>
      h('button', {
        type: 'button', class: 'swatch', role: 'radio', title: option.label, 'aria-label': option.label, 'aria-checked': String(option.id === color),
        style: colorVars(option),
        onClick: (event) => {
          color = option.id;
          for (const el of swatches.children) el.setAttribute('aria-checked', String(el === event.currentTarget));
        },
      })
    )
  );
  const form = h(
    'form',
    { class: 'dialog' },
    h('h2', { class: 'dialog-title' }, title),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, folder ? 'Name' : `Folder in ${select.category(categoryId)?.name || 'collection'}`), input, error),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Color'), swatches),
    h('div', { class: 'dialog-foot' }, h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => modal.close() }, 'Cancel'), submit)
  );
  const modal = openModal({ label: title, content: form, align: 'dock' });
  input.select();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      if (folder) await updateSubcategory(folder.id, { name: input.value, color });
      else await createSubcategory(categoryId, input.value, color);
      toast(folder ? 'Folder updated' : 'Folder created');
      modal.close();
    } catch (problem) {
      error.textContent = problem.message || 'Something went wrong.';
      error.hidden = false;
      submit.disabled = false;
    }
  });
}

export async function confirmDeleteFolder(folder) {
  const count = select.inSubcategory(folder.id).length;
  const parent = select.category(folder.categoryId);
  const yes = await confirmDialog({
    title: `Delete “${folder.name}”?`,
    message: count ? `${plural(count, 'bookmark')} stay in ${parent?.name || 'the collection'}, without a folder.` : null,
  });
  if (!yes) return;
  if (await attempt(() => deleteSubcategory(folder.id), 'Folder deleted')) {
    if (location.hash.includes(folder.id)) location.hash = `#/c/${folder.categoryId}`;
  }
}

// --- media search (Library) --------------------------------------------------------------

const MEDIA_SEARCH = [
  { key: 'filmes', label: 'Movies' },
  { key: 'series', label: 'Series' },
  { key: 'musicas', label: 'Music' },
];

export function openMediaSearch() {
  let category = 'filmes';
  let token = 0;
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Search by title…', autofocus: true, autocomplete: 'off' });
  const results = h('div', { class: 'result-list' });
  const status = h('p', { class: 'dialog-text' }, 'Results come from TMDB and Spotify.');
  // Movies / Series / Music: the same gliding segmented control as the Library tabs.
  const segmented = segmentedControl({
    label: 'Type',
    items: MEDIA_SEARCH.map((option) => ({ key: option.key, label: option.label })),
    value: category,
    onChange: (key) => {
      category = key;
      run();
    },
  }).el;

  const run = async () => {
    const query = input.value.trim();
    results.replaceChildren();
    if (!query) {
      status.textContent = 'Results come from TMDB and Spotify.';
      status.hidden = false;
      return;
    }
    const mine = (token += 1);
    status.textContent = 'Searching…';
    status.hidden = false;
    try {
      const found = await searchMedia(category, query);
      if (mine !== token) return;
      status.hidden = found.length > 0;
      status.textContent = 'Nothing found.';
      results.replaceChildren(
        ...found.map((result) => {
          const isMusic = result.mediaType === 'music';
          const image = isMusic ? result.image : result.posterPath && `https://image.tmdb.org/t/p/w92${result.posterPath}`;
          const add = h('button', { type: 'button', class: 'btn btn-subtle' }, 'Add');
          add.addEventListener('click', async () => {
            add.disabled = true;
            if (await attempt(() => addMedia(result))) add.replaceChildren(iconEl('check', 14), 'Added');
            else add.disabled = false;
          });
          return h(
            'div',
            { class: 'result-row' },
            h('div', { class: `result-thumb${isMusic ? ' is-square' : ''}`, style: image ? { backgroundImage: `url("${image}")` } : null }),
            h('div', { class: 'result-info' }, h('div', { class: 'result-title' }, result.title), h('div', { class: 'result-sub' }, (isMusic ? result.artist : result.year) || '')),
            add
          );
        })
      );
    } catch (err) {
      if (mine !== token) return;
      status.textContent = err.message || 'Search failed.';
      status.hidden = false;
    }
  };
  input.addEventListener('input', debounce(run, 350));

  const modal = openModal({
    className: 'quickadd',
    align: 'dock',
    label: 'Add to library',
    content: h(
      'div',
      { class: 'dialog' },
      h(
        'div',
        { class: 'dialog-head' },
        h('h2', { class: 'dialog-title' }, 'Add to library'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onClick: () => modal.close() }, iconEl('x', 16))
      ),
      segmented,
      input,
      status,
      results
    ),
  });
}

