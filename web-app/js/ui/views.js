// Page renderers. Each returns { title, crumbs, node, actions? } for the shell
// to mount. Views are rebuilt whenever the store changes; the masonry grid is
// a single long-lived instance that reuses its cards, so rebuilding is cheap
// and images never reload.

import { STORAGE } from '../config.js';
import { h, plural, copyText } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';
import { folderColor, colorVars } from '../lib/colors.js';
import { state, select, sortBookmarks, SORTS, displayName, addStarterCategories } from '../data/store.js';
import { STARTER_CATEGORIES } from '../data/sample.js';
import { filterBookmarks } from '../services/organize.js';
import { live, chipsToHash, chipLabel } from './searchdock.js';
import { Masonry } from './masonry.js';
import { heroField } from './ascii.js';
import { morphingTabs, tabAddButton, forgetTabs } from './tabs.js';
import { selection } from './selection.js';
import { openMenu, toast, attempt } from './overlay.js';
import {
  openBookmark, openLink, toggleFavorite, openQuickAdd, openCategoryDialog, confirmDeleteCategory,
  openFolderDialog, confirmDeleteFolder, openMediaSearch,
  openMoveMenu,
} from './dialogs.js';

export const grid = new Masonry({
  onOpen: (id) => openBookmark(id, { sequence: () => grid.items.map((b) => b.id) }),
  onFavorite: toggleFavorite,
  onOpenLink: (id) => {
    const bookmark = select.byId(id);
    if (bookmark) openLink(bookmark);
  },
  onMove: (id, anchor) => openMoveMenu(anchor, [id]),
});

let gridKey = null;
let rerender = () => {};
let sortMode = localStorage.getItem(STORAGE.sort) || 'saved';
if (!SORTS[sortMode]) sortMode = 'saved';

function mountGrid(items, key) {
  grid.setItems(items, { fresh: key !== gridKey });
  gridKey = key;
  return grid.root;
}

// --- building blocks ----------------------------------------------------------------

/** Compact header over the interactive ASCII field. */
function hero({ dim, title, sub }) {
  return h(
    'header',
    { class: 'hero' },
    h('div', { class: 'hero-bg', 'aria-hidden': 'true' }, heroField()),
    h('h1', { class: 'hero-title' }, dim && h('span', { class: 'dim' }, dim), title),
    sub && h('p', { class: 'hero-sub' }, sub)
  );
}

function emptyState({ icon, title, text, action }) {
  return h(
    'div',
    { class: 'empty' },
    h('div', { class: 'empty-icon' }, iconEl(icon, 20)),
    h('p', { class: 'empty-title' }, title),
    text && h('p', { class: 'empty-text' }, text),
    action && h('button', { type: 'button', class: 'btn btn-subtle', onClick: action.onClick }, action.icon && iconEl(action.icon, 15), action.label)
  );
}

let selectButton = null;
function paintSelectButton() {
  if (!selectButton) return;
  selectButton.replaceChildren(iconEl(selection.mode ? 'check' : 'check-square', 15), h('span', null, selection.mode ? 'Done' : 'Select'));
}
selection.subscribe(paintSelectButton);

function sectionControls(sortable) {
  selectButton = h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => selection.setMode(!selection.mode) });
  paintSelectButton();
  const sortButton =
    sortable &&
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-ghost',
        'aria-haspopup': 'menu',
        onClick: (event) =>
          openMenu(
            event.currentTarget,
            [
              { heading: 'Sort by' },
              ...Object.entries(SORTS).map(([key, sort]) => ({
                label: sort.label,
                checked: key === sortMode,
                onSelect: () => {
                  sortMode = key;
                  localStorage.setItem(STORAGE.sort, key);
                  gridKey = null; // reordering is a fresh list, not an animation
                  rerender();
                },
              })),
            ],
            { align: 'end' }
          ),
      },
      iconEl('arrow-up-down', 15),
      h('span', null, SORTS[sortMode].label)
    );
  return h('div', { class: 'section-actions' }, selectButton, sortButton);
}

/** A titled masonry of bookmarks with Select and Sort, or an empty state. */
function gridSection({ title, items, key, sortable = true, empty, extra }) {
  if (!items.length) return h('section', { class: 'section' }, empty);
  const sorted = sortable ? sortBookmarks(items, sortMode) : items;
  return h(
    'section',
    { class: 'section' },
    h(
      'div',
      { class: 'section-head' },
      h('h2', { class: 'section-title' }, title, h('span', { class: 'count' }, items.length.toLocaleString('en-US'))),
      h('div', { class: 'section-actions' }, extra, sectionControls(sortable))
    ),
    mountGrid(sorted, `${key}:${sortable ? sortMode : ''}`)
  );
}

function notices(ctx) {
  const out = [];
  if (state.error) {
    out.push(
      h(
        'div',
        { class: 'notice', role: 'alert' },
        iconEl('alert', 16),
        h('div', null, h('strong', null, 'Your library could not be loaded. '), state.error, ' ', h('button', { type: 'button', class: 'link-btn', onClick: ctx.reload }, 'Try again'))
      )
    );
  }
  if (state.schemaOutdated) {
    out.push(
      h(
        'div',
        { class: 'notice' },
        iconEl('info', 16),
        h(
          'div',
          null,
          h('strong', null, 'One database step left. '),
          'Categories, folders and favorites need the new tables. Run the “Bookmark Manager” section at the end of ',
          h('code', null, 'supabase/schema.sql'),
          ' in the Supabase SQL editor, then reload. Until then your bookmarks are shown read-only in the Inbox.'
        )
      )
    );
  }
  return out;
}

// --- loading -------------------------------------------------------------------------

function loadingView() {
  return h(
    'div',
    { 'aria-busy': 'true', 'aria-label': 'Loading your library' },
    hero({ title: 'Opening your library…' }),
    h('section', { class: 'section' }, h('div', { class: 'skeleton-grid' }, Array.from({ length: 12 }, () => h('div', { class: 'skeleton-card shimmer' }))))
  );
}

// --- home ------------------------------------------------------------------------------

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function quickItem({ href, icon, label, count }) {
  return h(
    'a',
    { class: 'quick-item', href },
    iconEl(icon, 16),
    h('span', { class: 'quick-label' }, label),
    count !== undefined && h('span', { class: 'quick-count' }, count.toLocaleString('en-US'))
  );
}

function homeView(ctx) {
  const counts = select.counts();
  const name = displayName();
  const recent = sortBookmarks(select.bookmarks(), 'saved').slice(0, 96);

  return {
    title: 'Home',
    crumbs: [{ label: 'Home' }],
    node: h(
      'div',
      null,
      hero({
        dim: `${greeting()}${name ? `, ${name}` : ''}.`,
        title: counts.all ? `${plural(counts.all, 'bookmark')} in your library.` : 'Your library starts here.',
      }),
      notices(ctx),
      h(
        'section',
        { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, 'Quick access')),
        h(
          'nav',
          { class: 'quick', 'aria-label': 'Quick access' },
          quickItem({ href: '#/recent', icon: 'clock', label: 'Recently Saved' }),
          quickItem({ href: '#/favorites', icon: 'heart', label: 'Favorites', count: counts.favorites }),
          quickItem({ href: '#/inbox', icon: 'inbox', label: 'Inbox', count: counts.inbox }),
          state.categories.map((category) =>
            quickItem({ href: `#/c/${category.id}`, icon: category.icon, label: category.name, count: counts.category.get(category.id) || 0 })
          )
        )
      ),
      gridSection({
        title: 'Recent bookmarks',
        items: recent,
        key: 'home',
        sortable: false,
        extra: counts.all > recent.length && h('a', { class: 'btn btn-ghost', href: '#/all' }, 'View all'),
        empty: emptyState({
          icon: 'bookmark',
          title: 'Nothing saved yet',
          text: 'Paste a link and it lands here with its preview. Organize it now or later.',
          action: { label: 'Add your first bookmark', icon: 'plus', onClick: () => openQuickAdd() },
        }),
      })
    ),
  };
}

// --- inbox / recent / favorites / all ---------------------------------------------------

const LISTS = {
  inbox: {
    label: 'Inbox',
    sub: 'New links land here. File them when you have a minute — nothing gets lost in the meantime.',
    items: () => select.inbox(),
    empty: { icon: 'inbox', title: 'Inbox zero', text: 'Links saved without a category wait here until you organize them.' },
  },
  recent: {
    label: 'Recently Saved',
    sub: 'Everything from the last 30 days, newest first.',
    sortable: false,
    items: () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      return sortBookmarks(select.bookmarks().filter((b) => b.createdAt > since), 'saved');
    },
    empty: { icon: 'clock', title: 'Nothing new in the last 30 days', text: 'Recently saved links show up here automatically.' },
  },
  favorites: {
    label: 'Favorites',
    sub: 'The references you keep coming back to, from every category.',
    items: () => select.favorites(),
    empty: { icon: 'heart', title: 'No favorites yet', text: 'Tap the heart on a bookmark and it is kept here.' },
  },
  all: {
    label: 'All Bookmarks',
    sub: 'Your whole library, across every category and the Inbox.',
    items: () => select.bookmarks(),
    empty: { icon: 'grid', title: 'Your library is empty', text: 'Save a link to get started.', action: { label: 'Add a bookmark', icon: 'plus', onClick: () => openQuickAdd() } },
  },
};

function listView(route, ctx) {
  const list = LISTS[route.list];
  const items = list.items();
  return {
    title: list.label,
    crumbs: [{ label: list.label }],
    node: h(
      'div',
      null,
      hero({ title: list.label, sub: list.sub }),
      notices(ctx),
      gridSection({
        title: route.list === 'inbox' ? 'To organize' : 'Bookmarks',
        items,
        key: route.list,
        sortable: list.sortable !== false,
        empty: emptyState(list.empty),
      })
    ),
  };
}

// --- category & folder -------------------------------------------------------------------

function folderCard(sub, count) {
  const menu = h('button', { type: 'button', class: 'icon-btn folder-menu', 'aria-label': `Options for ${sub.name}`, 'aria-haspopup': 'menu' }, iconEl('more', 15));
  menu.addEventListener('click', () =>
    openMenu(
      menu,
      [
        { label: 'Edit name & color', icon: 'pencil', onSelect: () => openFolderDialog(sub.categoryId, sub) },
        { label: 'Add bookmark here', icon: 'plus', onSelect: () => openQuickAdd({ categoryId: sub.categoryId, subcategoryId: sub.id }) },
        { separator: true },
        { label: 'Delete folder', icon: 'trash', danger: true, onSelect: () => confirmDeleteFolder(sub) },
      ],
      { align: 'end' }
    )
  );
  return h(
    'div',
    { class: 'folder', style: colorVars(folderColor(sub)) },
    h(
      'a',
      { class: 'folder-link', href: `#/c/${sub.categoryId}/${sub.id}`, 'aria-label': `${sub.name}, ${plural(count, 'bookmark')}` },
      h('div', { class: 'folder-back', 'aria-hidden': 'true' }),
      // One sheet per bookmark, up to three; an empty folder stays closed.
      Array.from({ length: Math.min(count, 3) }, () => h('div', { class: 'folder-paper', 'aria-hidden': 'true' })),
      h('div', { class: 'folder-front' }, h('span', { class: 'folder-name' }, sub.name), h('span', { class: 'folder-count' }, String(count)))
    ),
    menu
  );
}

function categoryMenuButton(category) {
  const button = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Category options', 'aria-haspopup': 'menu', title: 'Category options' }, iconEl('more', 16));
  button.addEventListener('click', () =>
    openMenu(
      button,
      [
        { label: 'Edit category', icon: 'pencil', onSelect: () => openCategoryDialog(category) },
        { label: 'New folder', icon: 'folder-plus', onSelect: () => openFolderDialog(category.id) },
        { separator: true },
        { label: 'Delete category', icon: 'trash', danger: true, onSelect: () => confirmDeleteCategory(category) },
      ],
      { align: 'end' }
    )
  );
  return button;
}

function missingView(label) {
  return {
    title: 'Not found',
    crumbs: [{ label: 'Not found' }],
    node: h('div', null, hero({ title: `This ${label} no longer exists.` }), emptyState({ icon: 'folder', title: 'Nothing here', text: 'It may have been deleted or renamed.', action: { label: 'Back to Home', onClick: () => (location.hash = '#/') } })),
  };
}

function categoryView(route, ctx) {
  const category = select.category(route.categoryId);
  if (!category) return missingView('category');
  const subs = select.subsOf(category.id);
  const items = select.inCategory(category.id);
  const counts = select.counts();
  const sub = route.subId ? select.subcategory(route.subId) : null;
  if (route.subId && (!sub || sub.categoryId !== category.id)) return missingView('folder');

  // Inside a folder, the category's folders are tabs and the selected one's
  // bookmarks fill the panel joined to it. "All" leads back to the category page.
  const tabs = [
    { key: 'all', label: 'All', count: items.length, href: `#/c/${category.id}` },
    ...subs.map((s) => ({
      key: s.id,
      label: s.name,
      count: counts.subcategory.get(s.id) || 0,
      href: `#/c/${category.id}/${s.id}`,
      tint: colorVars(folderColor(s)),
    })),
  ];

  let panel;
  let actions;
  if (sub) {
    const more = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Folder options', 'aria-haspopup': 'menu', title: 'Folder options' }, iconEl('more', 16));
    more.addEventListener('click', () =>
      openMenu(
        more,
        [
          { label: 'Edit name & color', icon: 'pencil', onSelect: () => openFolderDialog(category.id, sub) },
          { label: 'Add bookmark here', icon: 'plus', onSelect: () => openQuickAdd({ categoryId: category.id, subcategoryId: sub.id }) },
          { separator: true },
          { label: 'Delete folder', icon: 'trash', danger: true, onSelect: () => confirmDeleteFolder(sub) },
        ],
        { align: 'end' }
      )
    );
    actions = [more];
    panel = gridSection({
      title: sub.name,
      items: select.inSubcategory(sub.id),
      key: `sub:${sub.id}`,
      empty: emptyState({
        icon: 'folder',
        title: 'This folder is empty',
        text: 'Save a link straight into it, or move bookmarks here from the Inbox.',
        action: { label: 'Add bookmark', icon: 'plus', onClick: () => openQuickAdd({ categoryId: category.id, subcategoryId: sub.id }) },
      }),
    });
  }

  // The category itself keeps its own page: folder cards, then everything in it.
  if (!sub) {
    forgetTabs(category.id);
    return {
      title: category.name,
      crumbs: [{ label: category.name }],
      actions: [categoryMenuButton(category)],
      node: h('div', null, hero({ title: category.name, sub: category.description }), notices(ctx),
      h(
        'section',
        { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, 'Folders')),
        h(
          'div',
          { class: 'folders' },
          subs.map((s) => folderCard(s, counts.subcategory.get(s.id) || 0)),
          h('button', { type: 'button', class: 'folder is-new', onClick: () => openFolderDialog(category.id) }, iconEl('plus', 20), 'New folder')
        )
      ),
      gridSection({
        title: `All in ${category.name}`,
        items,
        key: `cat:${category.id}`,
        empty: emptyState({
          icon: category.icon,
          title: `Nothing in ${category.name} yet`,
          text: 'Save a link here, or move bookmarks in from your Inbox.',
          action: { label: 'Add bookmark', icon: 'plus', onClick: () => openQuickAdd({ categoryId: category.id }) },
        }),
      })),
    };
  }

  return {
    title: `${sub.name} · ${category.name}`,
    crumbs: [{ label: category.name, href: `#/c/${category.id}` }, { label: sub.name }],
    actions,
    node: h(
      'div',
      null,
      hero({ title: category.name, sub: category.description }),
      notices(ctx),
      morphingTabs({
        id: category.id,
        label: `${category.name} folders`,
        tabs,
        activeKey: sub.id,
        trailing: tabAddButton('New folder', () => openFolderDialog(category.id)),
        panel,
      })
    ),
  };
}

// --- library (movies / series / music) -----------------------------------------------------

const LIBRARY_TABS = [
  { key: '', label: 'All' },
  { key: 'movie', label: 'Movies' },
  { key: 'tv', label: 'Series' },
  { key: 'music', label: 'Music' },
];

function libraryView(route, ctx) {
  const media = sortBookmarks(select.media(), 'saved');
  const shown = route.tab ? media.filter((m) => m.contentType === route.tab) : media;
  const add = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-subtle',
      onClick: () => (state.mode === 'cloud' ? openMediaSearch() : toast('Sign in to search movies, series and music.', { type: 'info' })),
    },
    iconEl('plus', 15),
    'Add'
  );

  const poster = (item) => {
    const art = h('div', { class: 'poster-art' });
    if (item.thumbnail) {
      const img = h('img', { src: item.thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => img.replaceWith(h('div', { class: 'bm-fallback-icon' }, iconEl(item.contentType === 'music' ? 'music' : 'film', 20))));
      art.append(img);
    } else {
      art.append(h('div', { class: 'bm-fallback-icon' }, iconEl(item.contentType === 'music' ? 'music' : 'film', 20)));
    }
    const subtitle = item.contentType === 'music' ? item.meta.artist : [item.meta.year, item.contentType === 'tv' ? 'Series' : 'Movie'].filter(Boolean).join(' · ');
    return h(
      'button',
      { type: 'button', class: `poster${item.contentType === 'music' ? ' is-music' : ''}`, onClick: () => openBookmark(item.id) },
      art,
      h('div', { class: 'poster-title' }, item.title),
      h('div', { class: 'poster-sub' }, subtitle || item.domain)
    );
  };

  return {
    title: 'Library',
    crumbs: [{ label: 'Library' }],
    node: h(
      'div',
      null,
      hero({
        title: 'Movies, series and music',
        sub: 'Things to watch and listen to, kept apart from your bookmarks.',
      }),
      notices(ctx),
      h(
        'section',
        { class: 'section' },
        h(
          'div',
          { class: 'section-head' },
          h(
            'nav',
            { class: 'tabs', 'aria-label': 'Library type', style: 'margin:0;padding:0' },
            LIBRARY_TABS.map((tab) =>
              h('a', { class: `tab${tab.key === route.tab ? ' is-active' : ''}`, href: `#/library${tab.key ? `/${tab.key}` : ''}`, 'aria-current': tab.key === route.tab ? 'page' : null }, tab.label)
            )
          ),
          add
        ),
        shown.length
          ? h('div', { class: 'poster-grid' }, shown.map(poster))
          : emptyState({
              icon: 'film',
              title: media.length ? 'Nothing of this type yet' : 'Your library is empty',
              text: state.mode === 'cloud' ? 'Search for a movie, a series or a song and add it here.' : 'Sign in to search TMDB and Spotify and build your watch and listen list.',
            })
      )
    ),
  };
}

// --- search ------------------------------------------------------------------------------------

function searchView(route) {
  const chips = route.chips;
  const place = chips.find((chip) => chip.kind !== 'term');
  const terms = chips.filter((chip) => chip.kind === 'term').map((chip) => chip.value);
  if (live.query) terms.push(live.query);

  if (!place && !terms.length) {
    const tags = select.tagNames().slice(0, 14);
    return {
      title: 'Search',
      crumbs: [{ label: 'Search' }],
      node: h(
        'div',
        null,
        hero({ title: 'Find anything you saved', sub: 'Type in the bar below. Words, categories and folders become filters you can combine.' }),
        tags.length > 0
          ? h(
              'section',
              { class: 'section' },
              h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, 'Try a tag')),
              h('div', { class: 'chips' }, tags.map((tag) => h('a', { class: 'chip', href: chipsToHash([{ kind: 'term', value: tag }]) }, iconEl('hash', 12), tag)))
            )
          : emptyState({ icon: 'search', title: 'Search your library', text: 'Titles, links, domains, descriptions, tags, categories and notes are all searched.' })
      ),
    };
  }

  const found = filterBookmarks({
    terms,
    categoryId: place?.kind === 'category' ? place.id : null,
    subId: place?.kind === 'sub' ? place.id : null,
  });
  const quoted = terms.map((term) => `“${term}”`).join(' + ');
  const where = place ? chipLabel(place) : '';
  const title = quoted && where ? `${quoted} in ${where}` : quoted || where;
  return {
    title: 'Search',
    crumbs: [{ label: 'Search' }],
    node: h(
      'div',
      null,
      hero({ title, sub: `${plural(found.length, 'bookmark')} found` }),
      gridSection({
        title: found.length === 1 ? 'Result' : 'Results',
        items: found,
        key: `search:${chipsToHash(chips)}:${live.query}`,
        sortable: false,
        empty: emptyState({ icon: 'search', title: 'No matches', text: 'Remove a filter, or try fewer words, a domain or a tag.' }),
      })
    ),
  };
}

// --- settings -------------------------------------------------------------------------------------

function settingsView(ctx) {
  const row = (title, description, control) =>
    h('div', { class: 'set-row' }, h('div', { class: 'set-row-text' }, h('div', { class: 'set-row-title' }, title), description && h('div', { class: 'set-row-desc' }, description)), control);
  const group = (title, ...rows) => h('section', { class: 'set-group' }, h('h2', null, title), h('div', { class: 'set-card' }, rows));
  const cloud = state.mode === 'cloud';

  const inlineForm = ({ type, value = '', placeholder, label, action, success }) => {
    const input = h('input', { class: 'input', type, value, placeholder, required: true, minlength: type === 'password' ? '6' : null, autocomplete: type === 'password' ? 'new-password' : 'email', 'aria-label': placeholder });
    const button = h('button', { type: 'submit', class: 'btn btn-subtle' }, label);
    const form = h('form', { class: 'set-form' }, input, button);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      button.disabled = true;
      if ((await attempt(() => action(input.value), success)) && type === 'password') input.value = '';
      button.disabled = false;
    });
    return form;
  };

  const starterMissing = STARTER_CATEGORIES.some((starter) => !state.categories.some((c) => c.name.toLowerCase() === starter.name.toLowerCase()));

  const account = cloud
    ? group(
        'Account',
        row('Email', 'A confirmation is sent to the new address.', inlineForm({ type: 'email', value: state.user?.email || '', placeholder: 'Email', label: 'Save', action: ctx.updateEmail, success: 'Check your new inbox to confirm the change' })),
        row('Password', 'At least 6 characters.', inlineForm({ type: 'password', placeholder: 'New password', label: 'Update', action: ctx.updatePassword, success: 'Password updated' })),
        row('Sign out', state.user?.email, h('button', { type: 'button', class: 'btn btn-subtle', onClick: ctx.signOut }, iconEl('log-out', 15), 'Sign out'))
      )
    : group(
        'Account',
        row(
          'Preview mode',
          'Your library is kept in this browser only. Sign in to store it in your account and reach it from every device and the extension.',
          h('button', { type: 'button', class: 'btn btn-primary', onClick: ctx.signIn }, iconEl('log-in', 15), 'Sign in')
        )
      );

  const capture = group(
    'Capture',
    row(
      'Chrome extension',
      cloud ? 'Paste this sync token into the extension’s options page, once.' : 'Sign in to connect the extension to your account.',
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-subtle',
          disabled: !cloud,
          onClick: async () => {
            const token = await ctx.getSyncToken();
            if (!token) return toast('No active session — sign in again.', { type: 'error' });
            toast((await copyText(token)) ? 'Sync token copied' : 'Could not copy the token', { type: 'info' });
          },
        },
        iconEl('copy', 15),
        'Copy sync token'
      )
    )
  );

  const library = group(
    'Library',
    row(
      'Starter categories',
      'Design, Development, Reading, Inspiration, Productivity and Personal, with their folders. Existing ones are left alone.',
      h(
        'button',
        { type: 'button', class: 'btn btn-subtle', disabled: !starterMissing || state.schemaOutdated, onClick: () => attempt(addStarterCategories, 'Starter categories added') },
        starterMissing ? 'Add' : 'Added'
      )
    ),
    !cloud &&
      row(
        'Sample library',
        'Preview mode opens with sample bookmarks so you can look around.',
        h(
          'div',
          { class: 'section-actions' },
          h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => ctx.resetLocal({ keepSamples: true }) }, 'Restore samples'),
          h('button', { type: 'button', class: 'btn btn-subtle btn-danger', onClick: () => ctx.resetLocal({ keepSamples: false }) }, 'Start empty')
        )
      )
  );

  return {
    title: 'Settings',
    crumbs: [{ label: 'Settings' }],
    node: h('div', null, hero({ title: 'Settings' }), notices(ctx), h('div', { class: 'settings' }, account, capture, library)),
  };
}

// --- entry point -----------------------------------------------------------------------------------

export function renderView(route, ctx) {
  rerender = ctx.rerender;
  selectButton = null;
  if (!state.ready) return { title: 'Loading', crumbs: [{ label: 'Loading…' }], node: loadingView() };
  switch (route.name) {
    case 'list':
      return listView(route, ctx);
    case 'category':
      return categoryView(route, ctx);
    case 'library':
      return libraryView(route, ctx);
    case 'search':
      return searchView(route, ctx);
    case 'settings':
      return settingsView(ctx);
    default:
      return homeView(ctx);
  }
}
