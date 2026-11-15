// Dialogs: quick-add, bookmark detail, category editor, move menu, media search.
// They read from the store and call store actions; they never touch a driver.

import { h, debounce, formatDate, timeAgo, copyText, plural } from '../lib/dom.js';
import { iconEl, CATEGORY_ICONS } from '../lib/icons.js';
import { parseUrl, extractUrls, domainOf, faviconFor } from '../lib/url.js';
import {
  state, select, addBookmark, updateBookmark, moveBookmarks, setFavorite, deleteBookmarks, setTags, markOpened,
  createCategory, updateCategory, deleteCategory, createSubcategory, renameSubcategory, deleteSubcategory, addMedia, cleanTagNames,
} from '../data/store.js';
import { fetchPreview, searchMedia } from '../services/metadata.js';
import { suggestLocation } from '../services/organize.js';
import { openModal, openMenu, toast, attempt, confirmDialog, promptDialog } from './overlay.js';
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
  const modal = openModal({ className: 'quickadd', label: 'New bookmark', content: form });

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

export function openBookmark(id) {
  let bookmark = select.byId(id);
  if (!bookmark) return;
  const refresh = () => (bookmark = select.byId(id) || bookmark);

  // Left: the preview
  const media = h('div', { class: 'detail-media' });
  if (bookmark.thumbnail) {
    const glow = h('div', { class: 'detail-media-glow', style: { backgroundImage: `url("${bookmark.thumbnail.replace(/"/g, '%22')}")` } });
    const img = h('img', { class: 'detail-image', src: bookmark.thumbnail, alt: `Preview of ${bookmark.title || bookmark.domain}`, referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => media.replaceChildren(fallbackTile(bookmark)));
    media.append(glow, img);
  } else {
    media.append(fallbackTile(bookmark));
  }

  // Right: information
  const title = h('h2', { class: 'detail-title' }, bookmark.title || bookmark.domain || bookmark.url);
  const description = h('p', { class: 'detail-desc' });
  const paintText = () => {
    title.textContent = bookmark.title || bookmark.domain || bookmark.url;
    description.textContent = bookmark.description;
    description.hidden = !bookmark.description;
  };
  paintText();

  const favicon = h('img', { src: bookmark.favicon || faviconFor(bookmark.domain), alt: '', referrerpolicy: 'no-referrer' });
  favicon.addEventListener('error', () => favicon.remove());

  const subtitleParts = [];
  if (bookmark.isMedia) {
    subtitleParts.push(MEDIA_LABEL[bookmark.contentType]);
    if (bookmark.meta.artist) subtitleParts.push(bookmark.meta.artist);
    if (bookmark.meta.year) subtitleParts.push(bookmark.meta.year);
  }

  const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value', title: value }, value));
  const stats = h('div', { class: 'detail-stats' });
  const paintStats = () => {
    stats.replaceChildren(
      stat('Saved', formatDate(bookmark.createdAt)),
      stat('Updated', timeAgo(bookmark.updatedAt) || '—'),
      stat('Last opened', bookmark.lastAccessedAt ? timeAgo(bookmark.lastAccessedAt) : 'Never')
    );
  };
  paintStats();

  const favoriteBtn = h('button', { type: 'button', class: 'icon-btn lg' }, iconEl('star', 16));
  const paintFavorite = () => {
    favoriteBtn.classList.toggle('is-on', bookmark.isFavorite);
    favoriteBtn.setAttribute('aria-pressed', String(bookmark.isFavorite));
    favoriteBtn.setAttribute('aria-label', bookmark.isFavorite ? 'Remove from favorites' : 'Add to favorites');
    favoriteBtn.title = bookmark.isFavorite ? 'Remove from favorites' : 'Add to favorites';
  };
  paintFavorite();
  favoriteBtn.addEventListener('click', async () => {
    const next = !bookmark.isFavorite;
    if (await attempt(() => setFavorite([id], next), next ? 'Added to favorites' : 'Removed from favorites')) {
      refresh();
      paintFavorite();
    }
  });

  const copy = async () => toast((await copyText(bookmark.url)) ? 'Link copied' : 'Could not copy the link', { type: 'info' });

  const location = locationSelects({
    categoryId: bookmark.categoryId,
    subcategoryId: bookmark.subcategoryId,
    onChange: async (where) => {
      const ok = await attempt(() => moveBookmarks([id], where.categoryId, where.subcategoryId));
      refresh();
      if (ok) toast(`Moved to ${select.locationLabel(bookmark)}`);
      else location.set(bookmark.categoryId, bookmark.subcategoryId);
      paintStats();
    },
  });

  const tags = tagEditor({
    tags: bookmark.tags,
    onChange: async (names) => {
      await attempt(() => setTags(id, names));
      refresh();
    },
  });

  const notes = h('textarea', { class: 'textarea', placeholder: 'Why did you save this?', 'aria-label': 'Personal notes' });
  notes.value = bookmark.notes;
  notes.addEventListener('blur', async () => {
    const value = notes.value.trim();
    if (value === bookmark.notes) return;
    if (await attempt(() => updateBookmark(id, { notes: value }), 'Notes saved')) refresh();
  });

  // Inline edit of title + description
  const textBlock = h('div', null);
  const showText = () => {
    textBlock.replaceChildren(
      title,
      h(
        'a',
        { class: 'detail-domain', href: bookmark.url, target: '_blank', rel: 'noopener noreferrer', onClick: () => markOpened(id) },
        favicon,
        h('span', null, [bookmark.domain, ...subtitleParts].filter(Boolean).join(' · ')),
        iconEl('arrow-up-right', 13)
      )
    );
  };
  const showEditor = () => {
    const titleField = h('input', { class: 'input', type: 'text', 'aria-label': 'Title', value: bookmark.title });
    const descField = h('textarea', { class: 'textarea', 'aria-label': 'Description', placeholder: 'Description' });
    descField.value = bookmark.description;
    const form = h(
      'form',
      { class: 'detail-edit' },
      titleField,
      descField,
      h(
        'div',
        { class: 'dialog-foot' },
        h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => (showText(), paintText()) }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save')
      )
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const ok = await attempt(
        () => updateBookmark(id, { title: titleField.value.trim(), description: descField.value.trim() }),
        'Bookmark updated'
      );
      if (!ok) return;
      refresh();
      showText();
      paintText();
      paintStats();
    });
    description.hidden = true;
    textBlock.replaceChildren(form);
    titleField.focus();
  };
  showText();

  const remove = async () => {
    const yes = await confirmDialog({
      title: 'Delete this bookmark?',
      message: `“${bookmark.title || bookmark.domain}” will be removed from your library. This can't be undone.`,
    });
    if (!yes) return;
    if (await attempt(() => deleteBookmarks([id]), 'Bookmark deleted')) modal.close();
  };

  const moreBtn = h('button', { type: 'button', class: 'icon-btn lg', 'aria-label': 'More actions', title: 'More actions' }, iconEl('more', 16));
  moreBtn.addEventListener('click', () =>
    openMenu(
      moreBtn,
      [
        { label: 'Edit title & description', icon: 'pencil', onSelect: showEditor },
        !bookmark.isMedia && {
          label: 'Move to…',
          icon: 'folder',
          onSelect: () =>
            openMoveMenu(moreBtn, [id], {
              align: 'end',
              onDone: () => {
                refresh();
                location.set(bookmark.categoryId, bookmark.subcategoryId);
              },
            }),
        },
        { label: 'Copy link', icon: 'copy', onSelect: copy },
        { separator: true },
        { label: 'Delete', icon: 'trash', danger: true, onSelect: remove },
      ],
      { align: 'end' }
    )
  );

  const side = h(
    'div',
    { class: 'detail-side' },
    h(
      'div',
      { class: 'detail-scroll' },
      textBlock,
      description,
      bookmark.selectedText && h('blockquote', { class: 'detail-quote' }, bookmark.selectedText),
      stats,
      h(
        'div',
        { class: 'detail-fields' },
        !bookmark.isMedia && h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Category'), location.el),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Tags'), tags.el),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Notes'), notes),
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'field-label' }, 'Link'),
          h(
            'div',
            { class: 'detail-url' },
            h('span', { title: bookmark.url }, bookmark.url),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Copy link', title: 'Copy link', onClick: copy }, iconEl('copy', 14))
          )
        )
      )
    ),
    h(
      'div',
      { class: 'detail-foot' },
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', onClick: () => (openLink(bookmark), refresh(), paintStats()) }, 'Open link', iconEl('arrow-up-right', 15)),
      favoriteBtn,
      moreBtn
    )
  );

  const modal = openModal({
    className: 'detail',
    label: bookmark.title || 'Bookmark',
    content: [
      h('button', { type: 'button', class: 'icon-btn detail-close', 'aria-label': 'Close', onClick: () => modal.close() }, iconEl('x', 16)),
      media,
      side,
    ],
  });
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
  const modal = openModal({ label: category ? 'Edit category' : 'New category', content: form });

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

export function openFolderDialog(categoryId, folder = null) {
  promptDialog({
    title: folder ? 'Rename folder' : 'New folder',
    label: folder ? 'Name' : `Folder in ${select.category(categoryId)?.name || 'category'}`,
    value: folder?.name || '',
    placeholder: 'e.g. Typography',
    confirmLabel: folder ? 'Save' : 'Create folder',
    onSubmit: async (value) => {
      if (folder) await renameSubcategory(folder.id, value);
      else await createSubcategory(categoryId, value);
      toast(folder ? 'Folder renamed' : 'Folder created');
    },
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

