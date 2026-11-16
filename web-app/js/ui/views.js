// Page renderers. Each returns { title, crumbs, node, actions? } for the shell
// to mount. Views are rebuilt whenever the store changes; the masonry grid is
// a single long-lived instance that reuses its cards, so rebuilding is cheap
// and images never reload.

import { STORAGE } from '../config.js';
import { h, plural, copyText } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';
import { siteGroups, inSiteGroup } from '../lib/sites.js';
import { faviconFor } from '../lib/url.js';
import { folderColor, colorVars, FOLDER_COLORS } from '../lib/colors.js';
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
function gridSection({ title, items, key, sortable = true, empty, extra, lead }) {
  if (!items.length && !lead) return h('section', { class: 'section' }, empty);
  const sorted = sortable ? sortBookmarks(items, sortMode) : items;
  return h(
    'section',
    { class: 'section' },
    h(
      'div',
      { class: 'section-head' },
      lead || h('h2', { class: 'section-title' }, title, h('span', { class: 'count' }, items.length.toLocaleString('en-US'))),
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

// --- home: site filters --------------------------------------------------------------

let homeSite = 'all'; // the site filter on Home; kept while the app is open
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
          homeSite = key;
          siteScroll = track.scrollLeft;
          rerender();
        },
      },
      icon,
      h('span', null, label),
      h('span', { class: 'count' }, count.toLocaleString('en-US'))
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

function homeView(ctx) {
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
    sub: 'The references you keep coming back to, from every category.',
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
          h(
            'nav',
            { class: 'tabs', 'aria-label': 'Library type', style: 'margin:0;padding:0' },
            LIBRARY_TABS.map((t) =>
              h('a', { class: `tab${t.key === tab ? ' is-active' : ''}`, href: `#/library/${t.key}`, 'aria-current': t.key === tab ? 'page' : null }, t.label)
            )
          ),
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
