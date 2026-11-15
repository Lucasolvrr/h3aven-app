// The application frame: sidebar, top bar, router, bulk-selection bar and
// global shortcuts. Views are rendered by views.js; this file decides when.

import { APP_NAME, STORAGE } from '../config.js';
import { h, modKey, readJson, writeJson, plural } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';
import { state, select, subscribe, setFavorite, deleteBookmarks, addTagToBookmarks, moveCategory } from '../data/store.js';
import { renderView, grid } from './views.js';
import { selection } from './selection.js';
import { openMenu, hasOpenModal, attempt, confirmDialog, promptDialog } from './overlay.js';
import { openQuickAdd, openCategoryDialog, confirmDeleteCategory, openFolderDialog, openMoveMenu } from './dialogs.js';
import { openPalette } from './palette.js';

const WORKSPACE = [
  { key: 'home', href: '#/', icon: 'home', label: 'Home' },
  { key: 'inbox', href: '#/inbox', icon: 'inbox', label: 'Inbox', count: (c) => c.inbox },
  { key: 'recent', href: '#/recent', icon: 'clock', label: 'Recently Saved' },
  { key: 'favorites', href: '#/favorites', icon: 'star', label: 'Favorites', count: (c) => c.favorites },
  { key: 'all', href: '#/all', icon: 'grid', label: 'All Bookmarks', count: (c) => c.all },
];

function safeDecode(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export function parseRoute() {
  const [head, a, b] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(safeDecode);
  if (['inbox', 'recent', 'favorites', 'all'].includes(head)) return { name: 'list', list: head, key: head };
  if (head === 'c' && a) return { name: 'category', categoryId: a, subId: b || null, key: `c:${a}:${b || ''}` };
  if (head === 'library') return { name: 'library', tab: a || '', key: `library:${a || ''}` };
  if (head === 'search') return { name: 'search', query: a || '', key: 'search' };
  if (head === 'settings') return { name: 'settings', key: 'settings' };
  return { name: 'home', key: 'home' };
}

/** app: callbacks owned by main.js (signIn, signOut, reload, …) */
export function mountShell(app) {
  const mobile = window.matchMedia('(max-width: 767px)');
  let collapsed = localStorage.getItem(STORAGE.sidebar) === 'collapsed';
  const expanded = new Set(readJson(STORAGE.expanded, []));
  let currentKey = null;

  // --- skeleton ---------------------------------------------------------------------

  const nav = h('nav', { class: 'sb-nav', 'aria-label': 'Library' });
  const foot = h('div', { class: 'sb-foot' });
  const collapseBtn = h('button', { type: 'button', class: 'icon-btn sb-collapse' }, iconEl('panel-left', 16));
  const sidebar = h(
    'aside',
    { class: 'sidebar', id: 'sidebar' },
    h(
      'div',
      { class: 'sb-head' },
      h('a', { class: 'sb-brand', href: '#/', 'aria-label': `${APP_NAME} home` }, h('img', { class: 'sb-logo', src: 'icons/favicon-64.png', alt: '' }), h('span', { class: 'sb-name' }, APP_NAME)),
      collapseBtn
    ),
    h(
      'div',
      { class: 'sb-actions' },
      h(
        'button',
        { type: 'button', class: 'sb-search', dataset: { tip: `Search  ${modKey} K` }, 'aria-label': 'Search', onClick: () => showPalette() },
        iconEl('search', 15),
        h('span', null, 'Search'),
        h('kbd', null, `${modKey} K`)
      ),
      h('button', { type: 'button', class: 'icon-btn sb-add', dataset: { tip: 'New bookmark' }, 'aria-label': 'New bookmark', onClick: () => quickAdd() }, iconEl('plus', 16))
    ),
    nav,
    foot
  );

  const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' });
  const viewActions = h('div', { class: 'topbar-actions' });
  const topbar = h(
    'header',
    { class: 'topbar' },
    h('button', { type: 'button', class: 'icon-btn topbar-menu', 'aria-label': 'Open navigation', 'aria-controls': 'sidebar', onClick: () => setDrawer(true) }, iconEl('menu', 18)),
    crumbs,
    viewActions,
    h(
      'div',
      { class: 'topbar-actions' },
      h('button', { type: 'button', class: 'icon-btn topbar-search', 'aria-label': 'Search', title: `Search (${modKey} K)`, onClick: () => showPalette() }, iconEl('search', 16)),
      h('button', { type: 'button', class: 'btn btn-primary topbar-new', 'aria-label': 'New bookmark', onClick: () => quickAdd() }, iconEl('plus', 15), h('span', null, 'New'))
    )
  );
  const view = h('div', { class: 'view', id: 'view' });
  const scroller = h('div', { class: 'main-scroll' }, topbar, view);
  const root = h(
    'div',
    { class: 'app' },
    sidebar,
    h('div', { class: 'scrim', onClick: () => setDrawer(false) }),
    h('main', { class: 'main' }, scroller)
  );
  document.getElementById('root').replaceChildren(root);

  scroller.addEventListener('scroll', () => topbar.classList.toggle('is-stuck', scroller.scrollTop > 6), { passive: true });

  // --- sidebar state ------------------------------------------------------------------

  function paintCollapsed() {
    root.classList.toggle('is-collapsed', collapsed && !mobile.matches);
    const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    collapseBtn.setAttribute('aria-label', label);
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    collapseBtn.dataset.tip = label;
    collapseBtn.title = collapsed ? '' : label;
  }
  function toggleSidebar() {
    if (mobile.matches) return setDrawer(!root.classList.contains('is-drawer-open'));
    collapsed = !collapsed;
    localStorage.setItem(STORAGE.sidebar, collapsed ? 'collapsed' : 'expanded');
    paintCollapsed();
  }
  function setDrawer(open) {
    root.classList.toggle('is-drawer-open', open);
  }
  collapseBtn.addEventListener('click', toggleSidebar);
  mobile.addEventListener('change', () => {
    setDrawer(false);
    paintCollapsed();
  });
  // Navigating from the drawer closes it.
  sidebar.addEventListener('click', (event) => {
    if (event.target.closest('a')) setDrawer(false);
  });

  // --- context helpers ----------------------------------------------------------------

  /** Where a new bookmark should default to, given the page being viewed. */
  function currentLocation() {
    const route = parseRoute();
    if (route.name !== 'category' || !select.category(route.categoryId)) return {};
    return { categoryId: route.categoryId, subcategoryId: route.subId && select.subcategory(route.subId) ? route.subId : null };
  }
  function quickAdd() {
    setDrawer(false);
    openQuickAdd(currentLocation());
  }
  function showPalette() {
    setDrawer(false);
    openPalette({ location: currentLocation(), toggleSidebar });
  }

  // --- sidebar rendering -----------------------------------------------------------------

  function row({ href, icon, label, count, active, chevron, more, child }) {
    return h(
      'div',
      { class: `sb-row${active ? ' is-active' : ''}${more ? ' has-more' : ''}`, dataset: { tip: label } },
      h(
        'a',
        { class: 'sb-link', href, 'aria-current': active ? 'page' : null },
        !child && iconEl(icon, 16),
        h('span', { class: 'sb-label' }, label)
      ),
      chevron,
      count ? h('span', { class: 'sb-count' }, count.toLocaleString('en-US')) : null,
      more
    );
  }

  function categoryMenu(button, category, index) {
    openMenu(
      button,
      [
        { label: 'New folder', icon: 'folder-plus', onSelect: () => openFolderDialog(category.id) },
        { label: 'Edit name & icon', icon: 'pencil', onSelect: () => openCategoryDialog(category) },
        { separator: true },
        { label: 'Move up', icon: 'arrow-up', disabled: index === 0, onSelect: () => attempt(() => moveCategory(category.id, -1)) },
        { label: 'Move down', icon: 'arrow-down', disabled: index === state.categories.length - 1, onSelect: () => attempt(() => moveCategory(category.id, 1)) },
        { separator: true },
        { label: 'Delete category', icon: 'trash', danger: true, onSelect: () => confirmDeleteCategory(category) },
      ],
      { align: 'start' }
    );
  }

  function renderSidebar() {
    const route = parseRoute();
    const counts = select.counts();
    const activeKey = route.name === 'list' ? route.list : route.name;

    const workspace = h(
      'div',
      { class: 'sb-section' },
      WORKSPACE.map((item) => row({ ...item, count: item.count?.(counts), active: activeKey === item.key }))
    );

    const ordered = [...state.categories].sort((a, b) => a.position - b.position);
    const tree = ordered.map((category, index) => {
      const subs = select.subsOf(category.id);
      const onCategory = route.name === 'category' && route.categoryId === category.id;
      const open = expanded.has(category.id) || (onCategory && Boolean(route.subId));

      const chevron =
        subs.length > 0 &&
        h(
          'button',
          {
            type: 'button',
            class: 'sb-chevron',
            'aria-expanded': String(open),
            'aria-label': `${open ? 'Collapse' : 'Expand'} ${category.name}`,
            onClick: () => {
              if (expanded.has(category.id)) expanded.delete(category.id);
              else expanded.add(category.id);
              writeJson(STORAGE.expanded, [...expanded]);
              renderSidebar();
            },
          },
          iconEl('chevron-right', 13)
        );
      const more = h('button', { type: 'button', class: 'icon-btn sb-more', 'aria-label': `Options for ${category.name}`, 'aria-haspopup': 'menu' }, iconEl('more', 15));
      more.addEventListener('click', () => categoryMenu(more, category, index));

      return [
        row({
          href: `#/c/${category.id}`,
          icon: category.icon,
          label: category.name,
          count: counts.category.get(category.id),
          active: onCategory && !route.subId,
          chevron,
          more,
        }),
        open &&
          h(
            'div',
            { class: 'sb-children' },
            subs.map((sub) =>
              row({
                href: `#/c/${category.id}/${sub.id}`,
                label: sub.name,
                count: counts.subcategory.get(sub.id),
                active: onCategory && route.subId === sub.id,
                child: true,
              })
            )
          ),
      ];
    });

    const categories = h(
      'div',
      { class: 'sb-section' },
      h(
        'div',
        { class: 'sb-heading' },
        h('span', null, 'Categories'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'New category', title: 'New category', onClick: () => openCategoryDialog() }, iconEl('plus', 14))
      ),
      tree,
      state.ready && !ordered.length && h('div', { class: 'sb-row' }, h('button', { type: 'button', class: 'sb-link muted', onClick: () => openCategoryDialog() }, iconEl('folder-plus', 16), h('span', { class: 'sb-label' }, 'Create a category')))
    );

    const media = h(
      'div',
      { class: 'sb-section' },
      h('div', { class: 'sb-heading' }, h('span', null, 'Media')),
      row({ href: '#/library', icon: 'library', label: 'Library', count: counts.media, active: activeKey === 'library' })
    );

    nav.replaceChildren(workspace, categories, media);

    const email = state.user?.email;
    const userButton = h(
      'button',
      { type: 'button', class: 'sb-user', dataset: { tip: email || 'Preview mode — sign in' } },
      h('span', { class: 'sb-avatar' }, email ? email[0].toUpperCase() : iconEl('hard-drive', 12)),
      h('span', { class: 'sb-user-text' }, email || 'Preview mode · Sign in')
    );
    userButton.addEventListener('click', () => {
      if (!email) return app.signIn();
      openMenu(userButton, [
        { heading: email },
        { label: 'Settings', icon: 'settings', onSelect: () => (location.hash = '#/settings') },
        { label: 'Sign out', icon: 'log-out', onSelect: app.signOut },
      ]);
    });
    foot.replaceChildren(row({ href: '#/settings', icon: 'settings', label: 'Settings', active: activeKey === 'settings' }), userButton);
  }

  // --- main rendering -----------------------------------------------------------------------

  const ctx = { ...app, rerender: () => renderMain() };

  function renderMain() {
    const route = parseRoute();
    const routeChanged = route.key !== currentKey;
    if (routeChanged) {
      currentKey = route.key;
      selection.clear();
    }

    // A store update re-renders the page under the user: keep their place.
    const scrollTop = scroller.scrollTop;
    const focused = document.activeElement;
    const focusId = view.contains(focused) ? focused.id : '';
    const caret = focusId && 'selectionStart' in focused ? [focused.selectionStart, focused.selectionEnd] : null;

    const page = renderView(route, ctx);
    document.title = page.title === 'Home' ? APP_NAME : `${page.title} · ${APP_NAME}`;
    crumbs.replaceChildren(
      ...page.crumbs.flatMap((crumb, index) => [
        index > 0 && iconEl('chevron-right', 13),
        crumb.href ? h('a', { href: crumb.href }, crumb.label) : h('span', { class: 'crumb-current' }, crumb.label),
      ]).filter(Boolean)
    );
    viewActions.replaceChildren(...(page.actions || []));
    view.replaceChildren(page.node);

    scroller.scrollTop = routeChanged ? 0 : scrollTop;
    if (focusId) {
      const again = document.getElementById(focusId);
      if (again) {
        again.focus({ preventScroll: true });
        if (caret) again.setSelectionRange?.(caret[0], caret[1]);
      }
    }
  }

  // --- bulk selection bar ---------------------------------------------------------------------

  let bulkbar = null;
  function renderBulkbar() {
    if (!selection.active) {
      bulkbar?.remove();
      bulkbar = null;
      return;
    }
    const ids = selection.ids();
    const none = ids.length === 0;
    const done = () => selection.clear();
    const button = (iconName, label, onClick, extra = '') =>
      h('button', { type: 'button', class: `btn btn-ghost ${extra}`, disabled: none, title: label, onClick }, iconEl(iconName, 15), h('span', null, label));

    const next = h(
      'div',
      { class: 'bulkbar', role: 'toolbar', 'aria-label': 'Bulk actions' },
      h('span', { class: 'bulkbar-count', 'aria-live': 'polite' }, none ? 'Select bookmarks' : `${ids.length} selected`),
      h(
        'button',
        { type: 'button', class: 'btn btn-ghost', onClick: () => selection.set(grid.items.map((b) => b.id)) },
        'All'
      ),
      button('folder', 'Move', (event) => openMoveMenu(event.currentTarget, ids, { onDone: done })),
      button('star', 'Favorite', async () => {
        if (await attempt(() => setFavorite(ids, true), `${plural(ids.length, 'bookmark')} added to favorites`)) done();
      }),
      button('tag', 'Tag', () =>
        promptDialog({
          title: `Tag ${plural(ids.length, 'bookmark')}`,
          label: 'Tag name',
          placeholder: 'e.g. inspiration',
          confirmLabel: 'Add tag',
          onSubmit: async (value) => {
            if (!value.trim()) throw new Error('Type a tag name.');
            await addTagToBookmarks(ids, value);
            done();
          },
        })
      ),
      button(
        'trash',
        'Delete',
        async () => {
          const yes = await confirmDialog({ title: `Delete ${plural(ids.length, 'bookmark')}?`, message: "They are removed from your library. This can't be undone." });
          if (yes && (await attempt(() => deleteBookmarks(ids), `${plural(ids.length, 'bookmark')} deleted`))) done();
        },
        'btn-danger'
      ),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cancel selection', title: 'Cancel', onClick: done }, iconEl('x', 15))
    );
    if (bulkbar) bulkbar.replaceWith(next);
    else document.body.append(next);
    // Entrance animation only the first time it appears.
    if (bulkbar) next.style.animation = 'none';
    bulkbar = next;
  }

  // --- wiring ------------------------------------------------------------------------------------

  const renderAll = () => {
    renderSidebar();
    renderMain();
  };
  subscribe(() => {
    selection.prune((id) => Boolean(select.byId(id)));
    renderAll();
  });
  selection.subscribe(renderBulkbar);
  window.addEventListener('hashchange', () => {
    setDrawer(false);
    renderAll();
  });

  document.addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      showPalette();
    } else if (event.key === '/' && !typing && !hasOpenModal()) {
      event.preventDefault();
      showPalette();
    } else if (event.key === 'Escape' && !event.defaultPrevented && !hasOpenModal()) {
      if (root.classList.contains('is-drawer-open')) setDrawer(false);
      else selection.clear();
    }
  });

  paintCollapsed();
  renderAll();
  return { toggleSidebar };
}
