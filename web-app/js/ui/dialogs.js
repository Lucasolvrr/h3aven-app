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
import { fallbackTile } from './masonry.js';

// --- shared pieces ---------------------------------------------------------------

/** Category + subcategory selects that stay in sync. */
function locationSelects({ categoryId = null, subcategoryId = null, onChange } = {}) {
  const category = h('select', { class: 'select', 'aria-label': 'Category' });
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
  const hint = h('span', { class: 'hint' }, 'No category? It goes to your Inbox.');
  const location = locationSelects({
    categoryId, subcategoryId,
    onChange: () => {
      locationTouched = true;
      hint.textContent = 'No category? It goes to your Inbox.';
    },
  });
  const tags = tagEditor();
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save');
  const titleInput = h('input', { class: 'qa-title', type: 'text', placeholder: 'Title', 'aria-label': 'Title' });
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

/**
 * The bookmark viewer: the page's preview centred over a blurred backdrop, and
 * a quiet side panel with what we know about the link.
 * sequence(): ids of the list it was opened from, for the previous / next arrows.
 */
export function openBookmark(id, { sequence = null } = {}) {
  if (!select.byId(id)) return;
  let currentId = id;

  const panel = h('aside', { class: 'viewer-panel' });
  const stage = h('div', { class: 'viewer-stage' });
  const backdrop = h('div', { class: 'viewer-backdrop', 'aria-hidden': 'true' });

  const ids = () => (sequence ? sequence().filter((value) => select.byId(value)) : []);
  const step = (delta) => {
    const list = ids();
    const index = list.indexOf(currentId);
    if (index < 0 || !list[index + delta]) return;
    currentId = list[index + delta];
    render({ direction: delta });
  };

  const modal = openModal({
    className: 'viewer',
    label: 'Bookmark',
    content: [backdrop, panel, stage],
    onClose: () => unsubscribe(),
  });

  // Clicking the blurred area around the preview closes, as with any lightbox.
  stage.addEventListener('click', (event) => {
    if (event.target === stage) modal.close();
  });
  modal.panel.addEventListener('keydown', (event) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'ArrowRight') step(1);
  });

  // Edits made elsewhere (or by this panel) repaint it in place.
  let editing = false;
  const unsubscribe = subscribe(() => {
    if (!select.byId(currentId)) return modal.close();
    const active = document.activeElement;
    // Don't repaint under someone typing in the panel (tags, notes, the edit form).
    if (editing || (panel.contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName))) return;
    const focusKey = panel.contains(active) ? active.dataset.key : null;
    render({ keepStage: true });
    if (focusKey) panel.querySelector(`[data-key="${focusKey}"]`)?.focus({ preventScroll: true });
  });

  function render({ direction = 0, keepStage = false } = {}) {
    const bookmark = select.byId(currentId);
    if (!bookmark) return;
    modal.panel.setAttribute('aria-label', bookmark.title || bookmark.domain || 'Bookmark');
    const list = ids();
    const index = list.indexOf(currentId);

    // --- stage: the preview, centred, over a blur of itself -------------------------
    if (!keepStage) {
      const thumb = bookmark.thumbnail;
      backdrop.style.backgroundImage = thumb ? `url("${thumb.replace(/"/g, '%22')}")` : 'none';
      let shot;
      if (thumb) {
        shot = h('img', { class: 'viewer-shot', src: thumb, alt: `Preview of ${bookmark.title || bookmark.domain}`, referrerpolicy: 'no-referrer' });
        shot.addEventListener('error', () => shot.replaceWith(h('div', { class: 'viewer-shot is-fallback' }, fallbackTile(bookmark))));
      } else {
        shot = h('div', { class: 'viewer-shot is-fallback' }, fallbackTile(bookmark));
      }
      const link = h('a', { class: 'viewer-shot-link', href: bookmark.url, target: '_blank', rel: 'noopener noreferrer', title: 'Open link', onClick: () => markOpened(currentId) }, shot);
      stage.replaceChildren(link);
      if (direction && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        link.animate([{ opacity: 0, transform: `translateX(${direction * 24}px) scale(0.985)` }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
      }
    }

    // --- panel ------------------------------------------------------------------------
    const navButton = (icon, label, delta, disabled) =>
      h('button', { type: 'button', class: 'viewer-icon', 'aria-label': label, title: label, disabled, onClick: () => step(delta) }, iconEl(icon, 16));
    const favorite = h(
      'button',
      {
        type: 'button', class: `viewer-icon${bookmark.isFavorite ? ' is-on' : ''}`, 'aria-pressed': String(bookmark.isFavorite), dataset: { key: 'favorite' },
        'aria-label': bookmark.isFavorite ? 'Remove from favorites' : 'Add to favorites', title: bookmark.isFavorite ? 'Remove from favorites' : 'Add to favorites',
        onClick: () => attempt(() => setFavorite([currentId], !bookmark.isFavorite)),
      },
      iconEl('heart', 16)
    );
    const top = h(
      'div',
      { class: 'viewer-top' },
      h('button', { type: 'button', class: 'viewer-icon', 'aria-label': 'Close', title: 'Close', onClick: () => modal.close() }, iconEl('x', 16)),
      h(
        'div',
        { class: 'viewer-top-actions' },
        favorite,
        list.length > 1 && navButton('arrow-left', 'Previous', -1, index <= 0),
        list.length > 1 && navButton('arrow-right', 'Next', 1, index < 0 || index >= list.length - 1)
      )
    );

    const icon = h('div', { class: 'viewer-favicon' });
    const faviconSrc = bookmark.favicon || faviconFor(bookmark.domain);
    if (faviconSrc) {
      const img = h('img', { src: faviconSrc, alt: '', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => icon.replaceChildren((bookmark.domain || '?').charAt(0).toUpperCase()));
      icon.append(img);
    } else icon.append((bookmark.domain || '?').charAt(0).toUpperCase());

    const place = bookmark.isMedia ? MEDIA_LABEL[bookmark.contentType] : select.locationLabel(bookmark);
    const head = h(
      'div',
      { class: 'viewer-head' },
      icon,
      h('p', { class: 'viewer-eyebrow' }, place),
      h('h2', { class: 'viewer-title' }, bookmark.title || bookmark.domain || bookmark.url),
      bookmark.description && h('p', { class: 'viewer-desc' }, bookmark.description),
      bookmark.selectedText && h('blockquote', { class: 'viewer-quote' }, bookmark.selectedText),
      h('p', { class: 'viewer-when' }, timeAgo(bookmark.createdAt) || formatDate(bookmark.createdAt))
    );

    const row = (label, value, extra = {}) => h('div', { class: `viewer-row${extra.stack ? ' is-stacked' : ''}` }, h('dt', null, label), h('dd', null, value));

    const placeButton = h('button', { type: 'button', class: 'viewer-value-btn', 'aria-haspopup': 'menu', title: 'Move to…', dataset: { key: 'place' } }, h('span', null, select.locationLabel(bookmark)), iconEl('chevron-down', 13));
    placeButton.addEventListener('click', () => openMoveMenu(placeButton, [currentId], { align: 'end' }));

    const tags = tagEditor({
      tags: bookmark.tags,
      onChange: async (names) => {
        await attempt(() => setTags(currentId, names));
      },
    });

    const notes = h('textarea', { class: 'viewer-notes', placeholder: 'Add a note…', 'aria-label': 'Personal notes', rows: '2' });
    notes.value = bookmark.notes;
    notes.addEventListener('blur', async () => {
      const value = notes.value.trim();
      if (value !== bookmark.notes) await attempt(() => updateBookmark(currentId, { notes: value }), 'Notes saved');
    });

    const meta = [];
    if (bookmark.isMedia) {
      if (bookmark.meta.artist) meta.push(row('Artist', bookmark.meta.artist));
      if (bookmark.meta.year) meta.push(row('Year', String(bookmark.meta.year)));
    }
    const facts = h(
      'dl',
      { class: 'viewer-facts' },
      row('Site', h('a', { href: bookmark.url, target: '_blank', rel: 'noopener noreferrer', onClick: () => markOpened(currentId) }, bookmark.domain || 'Link')),
      !bookmark.isMedia && row('Saved in', placeButton),
      ...meta,
      row('Saved', formatDate(bookmark.createdAt)),
      row('Last opened', bookmark.lastAccessedAt ? timeAgo(bookmark.lastAccessedAt) : 'Never'),
      row('Tags', tags.el, { stack: true }),
      row('Notes', notes, { stack: true })
    );

    const copy = async () => toast((await copyText(bookmark.url)) ? 'Link copied' : 'Could not copy the link', { type: 'info' });
    const remove = async () => {
      const yes = await confirmDialog({
        title: 'Delete this bookmark?',
        message: `“${bookmark.title || bookmark.domain}” will be removed from your library. This can't be undone.`,
      });
      if (yes) await attempt(() => deleteBookmarks([currentId]), 'Bookmark deleted');
    };
    const more = h('button', { type: 'button', class: 'viewer-icon is-boxed', 'aria-label': 'More actions', title: 'More actions', 'aria-haspopup': 'menu' }, iconEl('more', 16));
    more.addEventListener('click', () =>
      openMenu(
        more,
        [
          { label: 'Edit title & description', icon: 'pencil', onSelect: () => editText(bookmark) },
          { label: 'Copy link', icon: 'copy', onSelect: copy },
          { separator: true },
          { label: 'Delete', icon: 'trash', danger: true, onSelect: remove },
        ],
        { align: 'end' }
      )
    );
    const foot = h(
      'div',
      { class: 'viewer-foot' },
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', onClick: () => openLink(bookmark) }, 'Open link', iconEl('arrow-up-right', 15)),
      more
    );

    panel.replaceChildren(top, h('div', { class: 'viewer-body' }, head, facts), foot);
  }

  /** Swaps the head of the panel for a small form. */
  function editText(bookmark) {
    editing = true;
    const titleField = h('input', { class: 'input', type: 'text', 'aria-label': 'Title', value: bookmark.title });
    const descField = h('textarea', { class: 'textarea', 'aria-label': 'Description', placeholder: 'Description' });
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
    panel.querySelector('.viewer-head').replaceWith(form);
    titleField.focus();
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
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, category ? 'Save' : 'Create category');
  const form = h(
    'form',
    { class: 'dialog' },
    h('h2', { class: 'dialog-title' }, category ? 'Edit category' : 'New category'),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), name, error),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Description'), description),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Icon'), picker),
    h('div', { class: 'dialog-foot' }, h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => modal.close() }, 'Cancel'), submit)
  );
  const modal = openModal({ label: category ? 'Edit category' : 'New category', content: form, align: 'dock' });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const payload = { name: name.value, icon: chosen, description: description.value.trim() };
      if (category) {
        await updateCategory(category.id, payload);
        toast('Category updated');
      } else {
        const created = await createCategory(payload);
        toast('Category created');
        location.hash = `#/c/${created.id}`;
      }
      modal.close();
    } catch (err) {
      error.textContent = err.message || 'Could not save the category.';
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
  if (await attempt(() => deleteCategory(category.id), 'Category deleted')) {
    if (location.hash.includes(category.id)) location.hash = '#/';
  }
}

/** New folder (random colour, changeable) or edit an existing one's name and colour. */
export function openFolderDialog(categoryId, folder = null) {
  const title = folder ? 'Edit folder' : 'New folder';
  let color = (folder ? folderColor(folder) : randomFolderColor(select.subsOf(categoryId))).id;

  const input = h('input', { class: 'input', type: 'text', value: folder?.name || '', placeholder: 'e.g. Typography', autofocus: true, autocomplete: 'off', maxlength: '80' });
  const error = h('p', { class: 'field-error', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, folder ? 'Save' : 'Create folder');
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
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, folder ? 'Name' : `Folder in ${select.category(categoryId)?.name || 'category'}`), input, error),
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
    message: count ? `${plural(count, 'bookmark')} stay in ${parent?.name || 'the category'}, without a folder.` : null,
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
  const segmented = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Type' });
  const paintSegmented = () =>
    segmented.replaceChildren(
      ...MEDIA_SEARCH.map((option) =>
        h('button', { type: 'button', 'aria-pressed': String(option.key === category), onClick: () => ((category = option.key), paintSegmented(), run()) }, option.label)
      )
    );
  paintSegmented();

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

