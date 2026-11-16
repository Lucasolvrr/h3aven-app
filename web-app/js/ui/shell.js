// The application frame: sidebar, top bar, router, bulk-selection bar and
// global shortcuts. Views are rendered by views.js; this file decides when.

import { APP_NAME, STORAGE } from '../config.js';
import { h, readJson, writeJson, plural } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';
import { folderColor, colorVars } from '../lib/colors.js';
import { state, select, subscribe, displayName, setFavorite, deleteBookmarks, addTagToBookmarks, moveCategory } from '../data/store.js';
import { renderView, grid } from './views.js';
import { selection } from './selection.js';
import { openMenu, hasOpenModal, attempt, confirmDialog, promptDialog } from './overlay.js';
import { openQuickAdd, openCategoryDialog, confirmDeleteCategory, openFolderDialog, openMoveMenu, openMediaSearch } from './dialogs.js';
import { mountSearchDock, parseChips } from './searchdock.js';
import { openPalette } from './palette.js';

const WORKSPACE = [
  { key: 'home', href: '#/', icon: 'home', label: 'Home' },
  { key: 'inbox', href: '#/inbox', icon: 'inbox', label: 'Inbox', count: (c) => c.inbox },
  { key: 'recent', href: '#/recent', icon: 'clock', label: 'Recently Saved' },
  { key: 'favorites', href: '#/favorites', icon: 'heart', label: 'Favorites', count: (c) => c.favorites },
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
  const [head, a, b, ...rest] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(safeDecode);
  if (['inbox', 'recent', 'favorites', 'all'].includes(head)) return { name: 'list', list: head, key: head };
  if (head === 'c' && a) return { name: 'category', categoryId: a, subId: b || null, key: `c:${a}:${b || ''}`, page: `c:${a}:${b ? 'folder' : ''}` };
  if (head === 'library') return { name: 'library', tab: a || '', key: `library:${a || ''}` };
  if (head === 'search') return { name: 'search', chips: parseChips([a, b, ...rest].filter(Boolean)), key: 'search' };
  if (head === 'settings') return { name: 'settings', key: 'settings' };
  return { name: 'home', key: 'home' };
}

/** app: callbacks owned by main.js (signIn, signOut, reload, …) */
export function mountShell(app) {
  const mobile = window.matchMedia('(max-width: 767px)');
  let collapsed = localStorage.getItem(STORAGE.sidebar) === 'collapsed';
  const expanded = new Set(readJson(STORAGE.expanded, []));
  let currentKey = null;
  let currentPage = null; // routes that share a `page` (a category's tabs) keep the scroll position

  // --- skeleton ---------------------------------------------------------------------

  const nav = h('nav', { class: 'sb-nav', 'aria-label': 'Library' });
  // The selected background: one pill that glides from row to row.
  const pill = h('div', { class: 'sb-pill', 'aria-hidden': 'true' });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let pendingToggle = null; // { id, opening, ghost } — a folder list to animate after the next render
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
      h('button', { type: 'button', class: 'btn btn-primary topbar-new', 'aria-label': 'New bookmark', onClick: () => quickAdd() }, iconEl('plus', 15), h('span', null, 'New'))
    )
  );
  const view = h('div', { class: 'view', id: 'view' });
  const scroller = h('div', { class: 'main-scroll' }, topbar, view);
  const main = h('main', { class: 'main' }, scroller);
  const root = h(
    'div',
    { class: 'app' },
    sidebar,
    h('div', { class: 'scrim', onClick: () => setDrawer(false) }),
    main
  );
  document.getElementById('root').replaceChildren(root);
  let lastHash = location.hash;
  const dock = mountSearchDock(main, {
    getRoute: parseRoute,
    onLiveQuery: () => renderMain(),
    createActions() {
      const { categoryId } = currentLocation();
      const category = categoryId && select.category(categoryId);
      return [
        { label: 'New bookmark', icon: 'bookmark', hint: 'Paste a link', run: () => quickAdd() },
        category && { label: `New folder in ${category.name}`, icon: 'folder-plus', hint: 'Folder', run: () => openFolderDialog(category.id) },
        { label: 'New category', icon: 'folder-plus', hint: 'Category', run: () => openCategoryDialog() },
        state.mode === 'cloud' && { label: 'Add a movie, series or song', icon: 'film', hint: 'Library', run: () => openMediaSearch() },
      ].filter(Boolean);
    },
  });

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

  function row({ href, icon, label, count, active, chevron, more, child, tint }) {
    return h(
      'div',
      { class: `sb-row${active ? ' is-active' : ''}${more ? ' has-more' : ''}`, dataset: { tip: label } },
      h(
        'a',
        { class: 'sb-link', href, 'aria-current': active ? 'page' : null },
        child ? h('span', { class: 'sb-dot', 'aria-hidden': 'true', style: tint }) : iconEl(icon, 17),
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

  /** Move the pill under the selected row (rows are rebuilt on every render; the pill is not). */
  function placePill() {
    const active = nav.querySelector('.sb-row.is-active');
    if (!active) {
      pill.style.opacity = '0';
      return;
    }
    const row = active.getBoundingClientRect();
    const box = nav.getBoundingClientRect();
    pill.style.width = `${row.width}px`;
    pill.style.height = `${row.height}px`;
    pill.style.transform = `translate(${row.left - box.left}px, ${row.top - box.top + nav.scrollTop}px)`;
    pill.style.opacity = '1';
    // No glide on the very first paint.
    if (!nav.classList.contains('is-ready')) requestAnimationFrame(() => nav.classList.add('is-ready'));
  }
  new ResizeObserver(placePill).observe(nav);

  /** Everything laid out after `el` in the nav: the rows that move when a folder list opens or closes. */
  function rowsAfter(el) {
    const list = [];
    for (let node = el.nextElementSibling; node; node = node.nextElementSibling) list.push(node);
    for (let section = el.closest('.sb-section')?.nextElementSibling; section; section = section.nextElementSibling) list.push(section);
    return list;
  }

  function toggleFolders(categoryId, wasOpen) {
    const opening = !wasOpen;
    let ghost = null;
    const current = nav.querySelector(`.sb-children[data-children="${categoryId}"]`);
    if (!opening && current && !reducedMotion.matches) {
      // Keep a copy of the list to fold away over the rows that slide up.
      const box = nav.getBoundingClientRect();
      const rect = current.getBoundingClientRect();
      ghost = current.cloneNode(true);
      ghost.classList.add('sb-ghost');
      ghost.removeAttribute('data-children');
      Object.assign(ghost.style, { left: `${rect.left - box.left}px`, top: `${rect.top - box.top + nav.scrollTop}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    }
    if (opening) expanded.add(categoryId);
    else expanded.delete(categoryId);
    writeJson(STORAGE.expanded, [...expanded]);
    pendingToggle = { id: categoryId, opening, ghost };
    renderSidebar();
  }

  /** Runs once after the render that followed a chevron click. */
  function playToggle() {
    const toggle = pendingToggle;
    pendingToggle = null;
    if (!toggle || reducedMotion.matches) return;
    const ease = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
    const chevron = nav.querySelector(`[data-chevron="${toggle.id}"] .icon`);
    chevron?.animate([{ transform: `rotate(${toggle.opening ? 0 : 90}deg)` }, { transform: `rotate(${toggle.opening ? 90 : 0}deg)` }], { duration: 240, easing: ease });

    if (toggle.opening) {
      const list = nav.querySelector(`.sb-children[data-children="${toggle.id}"]`);
      if (!list) return;
      const height = list.offsetHeight + 6;
      // The list is revealed from the top while its rows arrive one after another…
      list.animate([{ clipPath: 'inset(0 0 100% 0 round 8px)', opacity: 0 }, { clipPath: 'inset(0 0 0% 0 round 8px)', opacity: 1 }], { duration: 200, easing: ease });
      [...list.children].forEach((item, index) =>
        item.animate([{ opacity: 0, transform: 'translateY(-6px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 180, delay: 35 + index * 45, easing: ease, fill: 'backwards' })
      );
      // …and what sits below glides down to make room.
      for (const el of rowsAfter(list)) el.animate([{ transform: `translateY(${-height}px)` }, { transform: 'none' }], { duration: 260, easing: ease });
    } else if (toggle.ghost) {
      const height = parseFloat(toggle.ghost.style.height) + 6;
      const anchor = nav.querySelector(`[data-chevron="${toggle.id}"]`)?.closest('.sb-row');
      nav.append(toggle.ghost);
      const fold = toggle.ghost.animate([{ clipPath: 'inset(0 0 0% 0 round 8px)', opacity: 1 }, { clipPath: 'inset(0 0 100% 0 round 8px)', opacity: 0 }], { duration: 160, easing: ease, fill: 'forwards' });
      fold.onfinish = () => toggle.ghost.remove();
      setTimeout(() => toggle.ghost.remove(), 320);
      if (anchor) for (const el of rowsAfter(anchor)) el.animate([{ transform: `translateY(${height}px)` }, { transform: 'none' }], { duration: 240, easing: ease });
    }
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
            dataset: { chevron: category.id },
            onClick: () => toggleFolders(category.id, open),
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
            { class: 'sb-children', dataset: { children: category.id } },
            subs.map((sub) =>
              row({
                href: `#/c/${category.id}/${sub.id}`,
                label: sub.name,
                count: counts.subcategory.get(sub.id),
                active: onCategory && route.subId === sub.id,
                child: true,
                tint: colorVars(folderColor(sub)),
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

    nav.replaceChildren(pill, workspace, categories, media);
    placePill();
    playToggle();

    // The account photo from Google when there is one, else the initial.
    const avatar = (name) => {
      const box = h('span', { class: 'sb-avatar' }, name[0].toUpperCase());
      const meta = state.user?.user_metadata || {};
      const photo = meta.avatar_url || meta.picture;
      if (photo) {
        const img = h('img', { src: photo, alt: '', referrerpolicy: 'no-referrer' });
        img.addEventListener('load', () => box.replaceChildren(img));
      }
      return box;
    };

    // Who is here: a signed-in account (name + email, menu on click) or the
    // local preview with a clear way to sign in.
    const email = state.user?.email;
    const userButton = email
      ? h(
          'button',
          { type: 'button', class: 'sb-user', 'aria-haspopup': 'menu', 'aria-label': `Account: ${email}`, dataset: { tip: email } },
          avatar(displayName() || email),
          h('span', { class: 'sb-user-text' }, h('span', { class: 'sb-user-name' }, displayName() || email), h('span', { class: 'sb-user-sub' }, email)),
          iconEl('arrow-up-down', 15)
        )
      : h(
          'button',
          { type: 'button', class: 'sb-user is-guest', 'aria-label': 'Preview mode. Sign in', dataset: { tip: 'Preview mode — sign in' } },
          h('span', { class: 'sb-avatar' }, iconEl('user', 16)),
          h('span', { class: 'sb-user-text' }, h('span', { class: 'sb-user-name' }, 'Preview mode'), h('span', { class: 'sb-user-sub' }, 'Saved on this device')),
          h('span', { class: 'sb-signin' }, 'Sign in')
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
    const pageChanged = (route.page || route.key) !== currentPage;
    if (routeChanged) {
      currentKey = route.key;
      currentPage = route.page || route.key;
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

    scroller.scrollTop = pageChanged ? 0 : scrollTop;
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
    // The bulk bar takes the search dock's place while bookmarks are selected.
    root.classList.toggle('is-selecting', selection.active);
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
      button('heart', 'Favorite', async () => {
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
    dock.sync(parseRoute(), lastHash);
    lastHash = location.hash;
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b' && !hasOpenModal()) {
      event.preventDefault();
      toggleSidebar();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      showPalette();
    } else if (event.key === '/' && !typing && !hasOpenModal()) {
      event.preventDefault();
      dock.focus();
    } else if (event.key === 'Escape' && !event.defaultPrevented && !hasOpenModal()) {
      if (root.classList.contains('is-drawer-open')) setDrawer(false);
      else selection.clear();
    }
  });

  paintCollapsed();
  renderAll();
  return { toggleSidebar };
}
