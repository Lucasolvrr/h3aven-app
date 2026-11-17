// Page renderers. Each returns { title, crumbs, node, actions? } for the shell
// to mount. Views are rebuilt whenever the store changes; the masonry grid is
// a single long-lived instance that reuses its cards, so rebuilding is cheap
// and images never reload.

import { STORAGE } from '../config.js';
import { h, plural, copyText, formatNumber, ambientMotion } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';
import { siteGroups, inSiteGroup } from '../lib/sites.js';
import { faviconFor } from '../lib/url.js';
import { folderColor, colorVars, FOLDER_COLORS } from '../lib/colors.js';
import { state, select, sortBookmarks, SORTS, displayName, addStarterCategories, updateCategory, updateSubcategory } from '../data/store.js';
import { STARTER_CATEGORIES } from '../data/sample.js';
import { filterBookmarks } from '../services/organize.js';
import { live, chipsToHash, chipLabel } from './searchdock.js';
import { Masonry } from './masonry.js';
import { heroField } from './ascii.js';
import { morphingTabs, tabAddButton, forgetTabs } from './tabs.js';
import { importButton, previewStatus } from './import.js';
import { previews } from '../services/importer.js';
import { extension } from '../services/extension.js';
import { onboardingCard } from './onboarding.js';
import { segmentedTabs } from './segmented.js';
import { passwordStrength } from './password-strength.js';
import { actionSwap } from './action-swap.js';
import { inlineEdit } from './inline-edit.js';
import { selection } from './selection.js';
import { openMenu, toast, attempt, hasOpenModal } from './overlay.js';
import { openConnectDialog, connectDialogOwner } from './connect.js';
import { PASSWORD_MIN, hasPassword } from './auth.js';
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
    // The same frosted folder as the folder cards, empty but for two blank
    // sheets, with the page's icon on its flap.
    h(
      'div',
      { class: 'folder empty-art', 'aria-hidden': 'true', style: colorVars(FOLDER_COLORS[0]) },
      h('div', { class: 'folder-back' }),
      h('div', { class: 'folder-paper' }),
      h('div', { class: 'folder-paper' }),
      h('div', { class: 'folder-front' }, iconEl(icon, 22))
    ),
    h('p', { class: 'empty-title' }, title),
    text && h('p', { class: 'empty-text' }, text),
    action && h('button', { type: 'button', class: 'btn btn-subtle btn-lg', onClick: action.onClick }, action.icon && iconEl(action.icon, 15), action.label)
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
function gridSection({ title, titleNode, items, key, sortable = true, empty, extra, lead }) {
  if (!items.length && !lead && !titleNode) return h('section', { class: 'section' }, empty);
  const sorted = sortable ? sortBookmarks(items, sortMode) : items;
  return h(
    'section',
    { class: 'section' },
    h(
      'div',
      { class: 'section-head' },
      lead ? h('div', { class: 'section-lead' }, h('h2', { class: 'sr-only' }, title), lead) : h('h2', { class: 'section-title' }, titleNode || title, h('span', { class: 'count' }, formatNumber(items.length))),
      h('div', { class: 'section-actions' }, extra, sectionControls(sortable))
    ),
    items.length ? mountGrid(sorted, `${key}:${sortable ? sortMode : ''}`) : empty
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
          'Collections, folders and favorites need the new tables. Run the “Bookmark Manager” section at the end of ',
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

// --- home: site filters --------------------------------------------------------------

let homeSite = 'all'; // the site filter on Home, from the URL (#/site/<key>)
let siteScroll = 0;

/** A row of pills: All, then each site with how many links come from it. */
function siteFilters(bookmarks) {
  const groups = siteGroups(bookmarks);
  if (homeSite !== 'all' && !groups.some((g) => g.key === homeSite)) homeSite = 'all';

  const pill = (key, label, count, icon) =>
    h(
      'button',
      {
        type: 'button', class: 'site-pill', 'aria-pressed': String(homeSite === key), dataset: { site: key },
        onClick: () => {
          if (homeSite === key) return;
          siteScroll = track.scrollLeft;
          // The filter is part of the URL, so it survives a reload and can be shared.
          history.replaceState(null, '', key === 'all' ? '#/' : `#/site/${encodeURIComponent(key)}`);
          rerender();
        },
      },
      icon,
      h('span', null, label),
      h('span', { class: 'count' }, formatNumber(count))
    );
  const favicon = (group) => {
    const img = h('img', { class: 'site-pill-icon', src: group.favicon || faviconFor(group.domain), alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' });
    img.addEventListener('error', () => img.remove());
    return img;
  };

  const track = h(
    'div',
    { class: 'site-track', role: 'toolbar', 'aria-label': 'Filter by site' },
    pill('all', 'All', bookmarks.length),
    groups.map((group) => pill(group.key, group.label, group.count, group.domain ? favicon(group) : iconEl('globe', 14)))
  );
  const scrollBy = (direction) => track.scrollBy({ left: direction * track.clientWidth * 0.7, behavior: 'smooth' });
  const back = h('button', { type: 'button', class: 'site-more is-back', 'aria-label': 'Scroll sites back', onClick: () => scrollBy(-1) }, iconEl('chevron-left', 16));
  const more = h('button', { type: 'button', class: 'site-more', 'aria-label': 'More sites', onClick: () => scrollBy(1) }, iconEl('chevron-right', 16));
  const root = h('div', { class: 'site-filters' }, back, track, more);

  // The arrows and the fades only show where there is more to scroll to.
  const paint = () => {
    const start = track.scrollLeft > 2;
    const end = track.scrollLeft + track.clientWidth < track.scrollWidth - 2;
    root.classList.toggle('has-before', start);
    root.classList.toggle('has-after', end);
    siteScroll = track.scrollLeft;
  };
  track.addEventListener('scroll', paint, { passive: true });
  new ResizeObserver(paint).observe(track);
  requestAnimationFrame(() => {
    track.scrollLeft = siteScroll;
    paint();
  });
  return root;
}

/** Home's bookmarks under the chosen site filter. */
function homeItems() {
  const all = select.bookmarks();
  if (homeSite === 'all') return all;
  const group = siteGroups(all).find((g) => g.key === homeSite);
  return group ? all.filter((b) => inSiteGroup(b, group)) : all;
}

/** The getting-started checklist, on Home only while there is something left to do. */
function homeOnboarding() {
  const card = onboardingCard({ where: 'home', rerender: () => rerender() });
  return card && h('div', { class: 'home-onboarding' }, card);
}

function homeView(ctx, route) {
  homeSite = route.site || 'all';
  const counts = select.counts();
  const name = displayName();

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
      homeOnboarding(),
      gridSection({
        title: 'Bookmarks',
        lead: counts.all ? siteFilters(select.bookmarks()) : null,
        items: homeItems(),
        key: `home:${homeSite}`,
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

// --- favorites ---------------------------------------------------

const LISTS = {
  favorites: {
    label: 'Favorites',
    sub: 'The references you keep coming back to, from every collection.',
    items: () => select.favorites(),
    empty: { icon: 'heart', title: 'No favorites yet', text: 'Tap the heart on a bookmark and it is kept here.' },
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
        { label: 'Edit Name & Color', icon: 'pencil', onSelect: () => openFolderDialog(sub.categoryId, sub) },
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
  const button = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Collection options', 'aria-haspopup': 'menu', title: 'Collection options' }, iconEl('more', 16));
  button.addEventListener('click', () =>
    openMenu(
      button,
      [
        { label: 'Edit collection', icon: 'pencil', onSelect: () => openCategoryDialog(category) },
        { label: 'New folder', icon: 'folder-plus', onSelect: () => openFolderDialog(category.id) },
        { separator: true },
        { label: 'Delete collection', icon: 'trash', danger: true, onSelect: () => confirmDeleteCategory(category) },
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

/** Saves, and if it fails says why (a toast), then lets inlineEdit roll the text back. */
async function saveOrSay(save) {
  try {
    await save();
  } catch (error) {
    toast(error.message || 'Could not save.', { type: 'error' });
    throw error;
  }
}

/** A collection's header: its name and description, both editable in place. */
function collectionHero(category) {
  return hero({
    title: inlineEdit({
      value: category.name,
      label: 'Collection name',
      validate: (next) => (next ? null : 'The name can’t be empty'),
      onSave: (next) => saveOrSay(() => updateCategory(category.id, { name: next })),
    }),
    sub: inlineEdit({
      value: category.description || '',
      label: 'Description',
      placeholder: 'Add a description',
      multiline: true,
      variant: 'body',
      onSave: (next) => saveOrSay(() => updateCategory(category.id, { description: next })),
    }),
  });
}

function categoryView(route, ctx) {
  const category = select.category(route.categoryId);
  if (!category) return missingView('collection');
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
          { label: 'Edit Name & Color', icon: 'pencil', onSelect: () => openFolderDialog(category.id, sub) },
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
      titleNode: inlineEdit({
        value: sub.name,
        label: 'Folder name',
        variant: 'section',
        validate: (next) => (next ? null : 'The name can’t be empty'),
        onSave: (next) => saveOrSay(() => updateSubcategory(sub.id, { name: next })),
      }),
      items: select.inSubcategory(sub.id),
      key: `sub:${sub.id}`,
      empty: emptyState({
        icon: 'folder',
        title: 'This folder is empty',
        text: 'Save a link straight into it, or move bookmarks here from the Inbox.',
        action: { label: 'Add Bookmark', icon: 'plus', onClick: () => openQuickAdd({ categoryId: category.id, subcategoryId: sub.id }) },
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
      node: h('div', null, collectionHero(category), notices(ctx),
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
          action: { label: 'Add Bookmark', icon: 'plus', onClick: () => openQuickAdd({ categoryId: category.id }) },
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
      collectionHero(category),
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
  { key: 'movie', label: 'Movies' },
  { key: 'tv', label: 'Series' },
  { key: 'music', label: 'Music' },
];

/**
 * Items in rows, each row on its own glass shelf. Rows are cut by hand (not a
 * wrapping grid) so every shelf spans its row; they are re-cut when the width
 * changes the number that fit.
 */
function shelves(items, { min = 176 } = {}) {
  const root = h('div', { class: 'shelves' });
  let columns = 0;
  const cut = () => {
    if (!root.isConnected) return;
    const style = getComputedStyle(root);
    const gap = parseFloat(style.getPropertyValue('--shelf-gap')) || 28;
    const inset = (parseFloat(style.getPropertyValue('--shelf-inset')) || 28) * 2;
    const next = Math.max(2, Math.floor((root.clientWidth - inset + gap) / (min + gap)));
    if (next === columns) return;
    columns = next;
    const rows = [];
    for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
    root.replaceChildren(
      ...rows.map((row) => h('div', { class: 'shelf', style: `--cols:${columns}` }, h('div', { class: 'shelf-glass', 'aria-hidden': 'true' }), row))
    );
  };
  const observer = new ResizeObserver(() => (root.isConnected ? cut() : observer.disconnect()));
  observer.observe(root);
  return root;
}

function libraryView(route, ctx) {
  const media = sortBookmarks(select.media(), 'saved');
  // No "All" tab: plain #/library opens on Movies.
  const tab = LIBRARY_TABS.some((t) => t.key === route.tab) ? route.tab : LIBRARY_TABS[0].key;
  const shown = media.filter((m) => m.contentType === tab);
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

  // Each item stands on a glass shelf: the cover, its reflection on the glass,
  // and the title shown over the cover on hover.
  const poster = (item) => {
    const icon = item.contentType === 'music' ? 'music' : 'film';
    const art = h('div', { class: 'poster-art' });
    const reflection = h('div', { class: 'poster-reflection', 'aria-hidden': 'true' });
    if (item.thumbnail) {
      const img = h('img', { src: item.thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => {
        img.replaceWith(h('div', { class: 'bm-fallback-icon' }, iconEl(icon, 20)));
        reflection.remove();
      });
      art.append(img);
      reflection.style.backgroundImage = `url("${item.thumbnail.replace(/"/g, '%22')}")`;
    } else {
      art.append(h('div', { class: 'bm-fallback-icon' }, iconEl(icon, 20)));
    }
    const subtitle = item.contentType === 'music' ? item.meta.artist : [item.meta.year, item.contentType === 'tv' ? 'Series' : 'Movie'].filter(Boolean).join(' · ');
    art.append(h('div', { class: 'poster-caption' }, h('div', { class: 'poster-title' }, item.title), h('div', { class: 'poster-sub' }, subtitle || item.domain)));
    return h(
      'button',
      { type: 'button', class: `poster${item.contentType === 'music' ? ' is-music' : ''}`, title: item.title, 'aria-label': [item.title, subtitle].filter(Boolean).join(', '), onClick: (event) => openBookmark(item.id, { origin: event.currentTarget.querySelector('.poster-art'), sequence: () => shown.map((b) => b.id) }) },
      art,
      reflection
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
          segmentedTabs({
            id: 'library',
            label: 'Library type',
            active: tab,
            items: LIBRARY_TABS.map((t) => ({ key: t.key, label: t.label, href: `#/library/${t.key}`, badge: media.filter((m) => m.contentType === t.key).length || null })),
          }),
          add
        ),
        shown.length
          ? shelves(shown.map(poster), { min: tab === 'music' ? 168 : 176 })
          : emptyState({
              icon: { movie: 'film', tv: 'tv', music: 'music' }[tab],
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
        hero({ title: 'Find anything you saved', sub: 'Type in the bar below. Words, collections and folders become filters you can combine.' }),
        tags.length > 0
          ? h(
              'section',
              { class: 'section' },
              h('div', { class: 'section-head' }, h('h2', { class: 'section-title' }, 'Try a tag')),
              h('div', { class: 'chips' }, tags.map((tag) => h('a', { class: 'chip', href: chipsToHash([{ kind: 'term', value: tag }]) }, iconEl('hash', 12), tag)))
            )
          : emptyState({ icon: 'search', title: 'Search your library', text: 'Titles, links, domains, descriptions, tags, collections and notes are all searched.' })
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

/** Settings → Capture: whether the extension is here and connected, and the one button that moves it forward. */
function extensionRow(row, ctx, cloud) {
  const desc = 'Save the page you’re on from the browser toolbar.';
  const controls = h('div', { class: 'section-actions' });
  const el = row('Chrome extension', desc, controls);
  const text = el.querySelector('.set-row-desc');
  const email = state.user?.email || '';

  // The states the pill moves between, and what pressing it does in each.
  const STATES = {
    checking: { id: 'checking', label: 'Checking', tone: 'neutral', busy: true },
    missing: { id: 'missing', label: 'Set up', icon: 'arrow-right', tone: 'neutral' },
    signIn: { id: 'signIn', label: 'Sign in to connect', icon: 'log-in', tone: 'neutral' },
    connect: { id: 'connect', label: 'Connect', icon: 'link', tone: 'accent' },
    connected: { id: 'connected', label: 'Connected', icon: 'check', tone: 'success' },
  };
  const describe = (id, status) => {
    text.textContent =
      id === 'connected'
        ? `Connected to ${status?.email || email || 'your account'}. Press to connect again.`
        : id === 'missing'
          ? `${desc} Not installed in this browser yet.`
          : id === 'signIn'
            ? `${desc} Sign in first, then connect it in one click.`
            : `${desc} Installed, not connected yet.`;
  };

  // Connecting happens right here: a session of the extension's own, handed over in place.
  const connect = () =>
    pill.run(
      async () => {
        const token = await ctx.getSyncToken();
        const status = await extension.connect(token, email);
        if (!status.connected) throw new Error('The extension did not keep the connection.');
        describe('connected', status);
      },
      { pendingLabel: pill.state.id === 'connected' ? 'Reconnecting' : 'Connecting', done: STATES.connected, failureLabel: 'Try again' }
    );

  const pill = actionSwap({
    state: STATES.checking,
    onPress: (current) => {
      if (current.id === 'missing') openConnectDialog(ctx, { onClose: () => ctx.rerender() });
      else if (current.id === 'signIn') ctx.signIn();
      else if (current.id === 'connect' || current.id === 'connected') connect();
    },
  });

  // The old way, kept for the odd case where the page can't reach the extension.
  const copyToken = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-ghost',
      title: 'Copy a token to paste in the extension’s options instead',
      onClick: async (event) => {
        const button = event.currentTarget;
        button.setAttribute('aria-busy', 'true');
        try {
          const token = await ctx.getSyncToken();
          toast((await copyText(token)) ? 'Token copied. Paste it in the extension’s options.' : 'Could not copy the token', { type: 'info' });
        } catch (error) {
          toast(error.message, { type: 'error' });
        } finally {
          button.removeAttribute('aria-busy');
        }
      },
    },
    'Copy token'
  );
  controls.append(...[cloud && copyToken, pill.el].filter(Boolean));

  extension.status().then((status) => {
    const id = !status ? 'missing' : !cloud ? 'signIn' : status.connected ? 'connected' : 'connect';
    describe(id, status);
    pill.set(STATES[id], { announce: false });
    if (id === 'missing') copyToken.remove();
  });
  return el;
}

function settingsView(ctx) {
  // A row: label (and a line of help) on the left, its control on the right.
  const row = (title, description, control) =>
    h(
      'div',
      { class: 'set-row' },
      h('div', { class: 'set-row-text' }, h('div', { class: 'set-row-title' }, title), description && h('div', { class: 'set-row-desc' }, description)),
      control && h('div', { class: 'set-row-control' }, control)
    );
  // A section: its title and what it is for, then one card of rows.
  const group = (title, description, ...rows) =>
    h('section', { class: 'set-group' }, h('header', { class: 'set-head' }, h('h2', null, title), description && h('p', null, description)), h('div', { class: 'set-card' }, rows));
  // A text field with its icon inside, like the search bar.
  const field = (icon, attrs) => {
    const input = h('input', { class: 'set-input', spellcheck: 'false', ...attrs });
    return { input, el: h('label', { class: 'set-field' }, iconEl(icon, 15), input) };
  };
  // An on/off switch.
  const toggle = (label, on, onChange) =>
    h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(on), 'aria-label': label, onClick: () => onChange(!on) }, h('span', { class: 'switch-knob' }));

  const cloud = state.mode === 'cloud';
  const user = state.user;
  const meta = user?.user_metadata || {};

  // --- profile ---

  const avatar = () => {
    const name = displayName() || user?.email || '?';
    const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    const box = h('span', { class: 'set-avatar', 'aria-hidden': 'true' }, initials);
    const photo = meta.avatar_url || meta.picture;
    if (photo) {
      const img = h('img', { src: photo, alt: '', referrerpolicy: 'no-referrer' });
      img.addEventListener('load', () => box.replaceChildren(img));
    }
    return box;
  };

  // Saved when it changes (Enter or leaving the field), no button needed.
  const nameField = () => {
    const current = meta.full_name || meta.name || '';
    const { input, el } = field('user', { type: 'text', value: current, placeholder: 'Your name', 'aria-label': 'Full name', autocomplete: 'name', maxlength: '80' });
    let saved = current;
    const save = async () => {
      const value = input.value.trim();
      if (value === saved) return;
      saved = value;
      if (!(await attempt(() => ctx.updateName(value), 'Name saved'))) saved = current;
    };
    input.addEventListener('change', save);
    input.addEventListener('keydown', (event) => event.key === 'Enter' && input.blur());
    return el;
  };

  // The Save button only shows once the address differs from the current one.
  const emailField = () => {
    const { input, el } = field('mail', { type: 'email', value: user?.email || '', placeholder: 'you@example.com', 'aria-label': 'Email', autocomplete: 'email', required: true });
    const save = h('button', { type: 'submit', class: 'btn btn-primary set-inline-btn', hidden: true }, 'Save');
    const form = h('form', { class: 'set-inline' }, el, save);
    input.addEventListener('input', () => (save.hidden = input.value.trim() === (user?.email || '')));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      save.disabled = true;
      if (await attempt(() => ctx.updateEmail(input.value), 'Check your inbox to confirm the change')) save.hidden = true;
      save.disabled = false;
    });
    return form;
  };

  // "Change" opens the fields under the row: current (when there is one), new, confirm.
  const passwordRows = () => {
    const needsCurrent = hasPassword(user);
    const panel = h('div', { class: 'set-expand', hidden: true });
    const opener = h('button', { type: 'button', class: 'btn btn-subtle', 'aria-expanded': 'false' }, needsCurrent ? 'Change' : 'Set password');
    const pw = (placeholder, autocomplete) =>
      field('lock', { type: 'password', placeholder, 'aria-label': placeholder, required: true, autocomplete, minlength: autocomplete === 'new-password' ? String(PASSWORD_MIN) : null });
    const current = needsCurrent ? pw('Current password', 'current-password') : null;
    // The new one shows its strength as it is typed, with a strong suggestion on offer.
    const next = passwordStrength({ label: 'New password', minLength: PASSWORD_MIN });
    const confirm = pw('Confirm new password', 'new-password');
    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save password');
    const cancel = h('button', { type: 'button', class: 'btn btn-ghost' }, 'Cancel');
    const suggest = h('button', { type: 'button', class: 'btn btn-subtle' }, 'Suggest one');
    suggest.addEventListener('click', () => {
      confirm.input.value = next.suggest();
      next.input.focus();
    });
    const form = h('form', { class: 'set-expand-form' }, current?.el, next.el, confirm.el, h('div', { class: 'set-expand-actions' }, suggest, h('span', { class: 'set-expand-gap' }), cancel, submit));
    panel.append(form);
    const setOpen = (open) => {
      panel.hidden = !open;
      opener.setAttribute('aria-expanded', String(open));
      opener.hidden = open;
      if (open) (current || next).input.focus();
      else {
        form.reset();
        next.reset();
      }
    };
    opener.addEventListener('click', () => setOpen(true));
    cancel.addEventListener('click', () => setOpen(false));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      if (next.input.value !== confirm.input.value) {
        toast('The new passwords do not match.', { type: 'error' });
        return confirm.input.focus();
      }
      submit.disabled = true;
      const ok = await attempt(() => ctx.updatePassword({ current: current?.input.value, password: next.input.value }), 'Password updated');
      submit.disabled = false;
      if (ok) setOpen(false);
    });
    const help = needsCurrent
      ? `At least ${PASSWORD_MIN} characters. Other devices are signed out when it changes.`
      : 'You sign in with Google. Add a password to also sign in with your email.';
    return [row('Password', help, opener), panel];
  };

  const profile = cloud
    ? group(
        'Profile',
        'Your account and how you sign in.',
        row('Avatar', displayName() || user?.email, avatar()),
        row('Full name', null, nameField()),
        row('Email', 'Changes once you confirm it from your inbox.', emailField()),
        ...passwordRows(),
        row('Sign out', 'Of this browser only. The extension stays connected.', h('button', { type: 'button', class: 'btn btn-subtle', onClick: ctx.signOut }, iconEl('log-out', 15), 'Sign out'))
      )
    : group(
        'Profile',
        'Your account and how you sign in.',
        row(
          'Preview mode',
          'Your library is kept in this browser only. Sign in to keep it in your account and reach it from every device and the extension.',
          h('button', { type: 'button', class: 'btn btn-primary', onClick: ctx.signIn }, iconEl('log-in', 15), 'Sign in')
        )
      );

  // --- appearance ---

  const motionOn = ambientMotion();
  const appearance = group(
    'Appearance',
    'How h3aven looks and moves.',
    row(
      'Background animation',
      'The moving letters behind page titles and the rotating search hint. Off automatically when your system asks for reduced motion.',
      toggle('Background animation', motionOn, (on) => {
        try {
          localStorage.setItem(STORAGE.motion, on ? 'on' : 'off');
        } catch {}
        window.dispatchEvent(new Event('h3aven:motion'));
        rerender();
      })
    )
  );

  // --- saving and importing ---

  const saving = group(
    'Saving',
    'Ways to bring links into h3aven.',
    extensionRow(row, ctx, cloud),
    row(
      'Browser bookmarks',
      'From Chrome, Edge, Brave or Firefox. In Chrome: open the bookmark manager (Ctrl+Shift+O), then ⋮ → Export bookmarks, and choose the saved file here.',
      importButton()
    ),
    previews.state.total > 0 && row('Preview images', null, previewStatus())
  );

  // --- library ---

  const starterMissing = STARTER_CATEGORIES.some((starter) => !state.categories.some((c) => c.name.toLowerCase() === starter.name.toLowerCase()));
  const library = group(
    'Library',
    'Collections and the data kept in this browser.',
    row(
      'Starter collections',
      'Design, Development, Reading, Inspiration, Productivity and Personal, with their folders. Existing ones are left alone.',
      h(
        'button',
        { type: 'button', class: 'btn btn-subtle', disabled: !starterMissing || state.schemaOutdated, onClick: () => attempt(addStarterCategories, 'Starter collections added') },
        starterMissing ? 'Add' : 'Added'
      )
    ),
    !cloud &&
      row(
        'Sample library',
        'Preview mode starts empty. Load a set of sample bookmarks to look around, or clear everything saved here.',
        h(
          'div',
          { class: 'section-actions' },
          h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => ctx.resetLocal({ keepSamples: true }) }, 'Load samples'),
          h('button', { type: 'button', class: 'btn btn-subtle btn-danger', onClick: () => ctx.resetLocal({ keepSamples: false }) }, 'Clear all')
        )
      )
  );

  return {
    title: 'Settings',
    crumbs: [{ label: 'Settings' }],
    node: h('div', null, hero({ title: 'Settings' }), notices(ctx), h('div', { class: 'settings' }, onboardingCard({ where: 'settings', rerender: () => rerender() }), profile, appearance, saving, library)),
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
    case 'connect':
      // #/connect (where the extension's button lands): the connect dialog over Home.
      if (!connectDialogOwner() && !hasOpenModal()) {
        setTimeout(() => {
          if (connectDialogOwner() || hasOpenModal()) return;
          openConnectDialog(ctx, { onClose: () => location.hash.startsWith('#/connect') && (location.hash = '#/') });
        }, 0);
      }
      return homeView(ctx, { name: 'home', key: 'home' });
    default:
      return homeView(ctx, route);
  }
}
