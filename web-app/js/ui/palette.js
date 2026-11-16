// Command palette (Ctrl/Cmd + K): find any bookmark, jump anywhere, create
// things and run actions without touching the mouse.

import { STORAGE } from '../config.js';
import { h, debounce, readJson, writeJson } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';
import { parseUrl, faviconFor } from '../lib/url.js';
import { state, select } from '../data/store.js';
import { searchBookmarks } from '../services/organize.js';
import { openModal } from './overlay.js';
import { openQuickAdd, openBookmark, openCategoryDialog, openFolderDialog } from './dialogs.js';
import { selection } from './selection.js';

let open = false;

const go = (hash) => () => {
  location.hash = hash;
};

/** Everything that isn't a bookmark. Rebuilt on open so it reflects the library. */
function commands(context) {
  const list = [
    { id: 'nav:home', group: 'Navigate', label: 'Home', icon: 'home', run: go('#/') },
    { id: 'nav:inbox', group: 'Navigate', label: 'Inbox', icon: 'inbox', hint: String(select.counts().inbox || ''), run: go('#/inbox') },
    { id: 'nav:recent', group: 'Navigate', label: 'Recently Saved', icon: 'clock', run: go('#/recent') },
    { id: 'nav:favorites', group: 'Navigate', label: 'Favorites', icon: 'heart', run: go('#/favorites') },
    { id: 'nav:all', group: 'Navigate', label: 'All Bookmarks', icon: 'grid', run: go('#/all') },
    { id: 'nav:library', group: 'Navigate', label: 'Library', icon: 'library', hint: 'Movies, series, music', run: go('#/library') },
    { id: 'nav:settings', group: 'Navigate', label: 'Settings', icon: 'settings', run: go('#/settings') },
  ];

  for (const category of state.categories) {
    list.push({ id: `cat:${category.id}`, group: 'Categories', label: category.name, icon: category.icon, hint: 'Category', run: go(`#/c/${category.id}`), searchOnly: true });
    for (const sub of select.subsOf(category.id)) {
      list.push({
        id: `sub:${sub.id}`, group: 'Categories', label: sub.name, icon: 'folder', hint: category.name,
        run: go(`#/c/${category.id}/${sub.id}`), searchOnly: true,
      });
    }
  }

  list.push(
    { id: 'new:bookmark', group: 'Create', label: 'Add a bookmark', icon: 'plus', run: () => openQuickAdd(context.location) },
    { id: 'new:category', group: 'Create', label: 'Create a category', icon: 'folder-plus', run: () => openCategoryDialog() }
  );
  if (context.location.categoryId) {
    const category = select.category(context.location.categoryId);
    if (category) {
      list.push({ id: 'new:folder', group: 'Create', label: `Create a folder in ${category.name}`, icon: 'folder-plus', run: () => openFolderDialog(category.id) });
    }
  }

  list.push(
    {
      id: 'act:organize', group: 'Actions', label: 'Organize Inbox', icon: 'check-square', hint: 'Select and move in bulk',
      run: () => {
        location.hash = '#/inbox';
        selection.setMode(true);
      },
    },
    { id: 'act:recent', group: 'Actions', label: 'Open Recently Saved', icon: 'clock', run: go('#/recent') },
    { id: 'act:sidebar', group: 'Actions', label: 'Toggle sidebar', icon: 'panel-left', run: context.toggleSidebar }
  );
  return list;
}

function remember(id) {
  const recent = readJson(STORAGE.recentCommands, []).filter((item) => item !== id);
  writeJson(STORAGE.recentCommands, [id, ...recent].slice(0, 4));
}

/** context: { location: { categoryId, subcategoryId }, toggleSidebar } */
export function openPalette(context, initialQuery = '') {
  if (open) return;
  open = true;

  const all = commands(context);
  let rows = []; // flat list of selectable rows currently shown
  let active = 0;

  const input = h('input', {
    type: 'text', placeholder: 'Search bookmarks, categories and commands…', autofocus: true, autocomplete: 'off', spellcheck: 'false',
    role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list', 'aria-label': 'Search or run a command', value: initialQuery,
  });
  const list = h('div', { class: 'palette-list', id: 'palette-list', role: 'listbox' });
  const modal = openModal({
    className: 'palette',
    align: 'top',
    label: 'Command palette',
    onClose: () => (open = false),
    content: [
      h('div', { class: 'palette-input' }, iconEl('search', 17), input, h('kbd', null, 'esc')),
      list,
      h(
        'div',
        { class: 'palette-foot' },
        h('span', null, h('kbd', null, '↑'), h('kbd', null, '↓'), 'navigate'),
        h('span', null, h('kbd', null, 'Enter'), 'open'),
        h('span', { class: 'spacer' }),
        h('span', null, h('kbd', null, 'esc'), 'close')
      ),
    ],
  });

  const run = (row) => {
    modal.close();
    if (row.id) remember(row.id);
    row.run();
  };

  const setActive = (index, scroll = true) => {
    active = Math.max(0, Math.min(index, rows.length - 1));
    [...list.querySelectorAll('.palette-item')].forEach((el, i) => {
      el.classList.toggle('is-active', i === active);
      el.setAttribute('aria-selected', String(i === active));
      if (i === active && scroll) el.scrollIntoView({ block: 'nearest' });
    });
  };

  const bookmarkRow = (bookmark) => ({
    group: 'Bookmarks',
    label: bookmark.title || bookmark.url,
    hint: `${bookmark.domain} · ${bookmark.isMedia ? 'Library' : select.locationLabel(bookmark)}`,
    thumb: bookmark,
    run: () => openBookmark(bookmark.id),
  });

  const build = () => {
    const query = input.value.trim();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    rows = [];

    if (!query) {
      const recentIds = readJson(STORAGE.recentCommands, []);
      const recent = recentIds.map((id) => all.find((c) => c.id === id)).filter(Boolean);
      rows.push(...recent.map((c) => ({ ...c, group: 'Recent' })));
      rows.push(...all.filter((c) => !c.searchOnly && !recentIds.includes(c.id)));
    } else {
      const parsed = /[./]/.test(query) ? parseUrl(query) : null;
      if (parsed) {
        const duplicate = select.findDuplicate(parsed.toString());
        rows.push(
          duplicate
            ? { ...bookmarkRow(duplicate), group: 'Already saved' }
            : { group: 'Create', label: `Save ${parsed.hostname.replace(/^www\./, '')}${parsed.pathname === '/' ? '' : parsed.pathname}`, icon: 'plus', hint: 'New bookmark', run: () => openQuickAdd({ ...context.location, url: parsed.toString() }) }
        );
      }
      rows.push(...searchBookmarks(query).slice(0, 7).map(bookmarkRow));
      rows.push(...all.filter((c) => words.every((word) => `${c.label} ${c.hint || ''} ${c.group}`.toLowerCase().includes(word))).slice(0, 8));
      rows.push({
        group: 'Search', label: `Search everything for “${query}”`, icon: 'search',
        run: go(`#/search/${encodeURIComponent(query)}`),
      });
    }

    list.replaceChildren();
    let lastGroup = null;
    rows.forEach((row, index) => {
      if (row.group !== lastGroup) {
        lastGroup = row.group;
        list.append(h('div', { class: 'palette-group' }, row.group));
      }
      let lead;
      if (row.thumb) {
        lead = h('span', { class: 'palette-thumb' });
        if (row.thumb.thumbnail) lead.style.backgroundImage = `url("${row.thumb.thumbnail.replace(/"/g, '%22')}")`;
        else {
          const img = h('img', { src: row.thumb.favicon || faviconFor(row.thumb.domain), alt: '', referrerpolicy: 'no-referrer' });
          img.addEventListener('error', () => img.replaceWith(iconEl('globe', 13)));
          lead.append(img);
        }
      } else {
        lead = iconEl(row.icon || 'chevron-right', 16);
      }
      list.append(
        h(
          'button',
          { type: 'button', class: 'palette-item', role: 'option', tabindex: '-1', onClick: () => run(row), onMousemove: () => active !== index && setActive(index, false) },
          lead,
          h('span', { class: 'palette-label' }, row.label),
          row.hint && h('span', { class: 'palette-hint' }, row.hint)
        )
      );
    });
    if (!rows.length) list.append(h('div', { class: 'palette-empty' }, 'Nothing matches.'));
    list.scrollTop = 0;
    setActive(0, false);
  };

  input.addEventListener('input', debounce(build, 90));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(active === rows.length - 1 ? 0 : active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(active === 0 ? rows.length - 1 : active - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (rows[active]) run(rows[active]);
    }
  });

  build();
  input.select();
}
