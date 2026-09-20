import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Preencha com os dados do seu projeto (Settings > API no Supabase)
const SUPABASE_URL = 'https://kxoegfliihryqfwensva.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_C_WACPTJGzfSCf-BtB8QlQ_Jm8EJwmn';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
});

const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');
const loginForm = document.getElementById('login-form');
const loginStatus = document.getElementById('login-status');
const userEmailEl = document.getElementById('user-email');
const logoutBtn = document.getElementById('logout-btn');
const searchInput = document.getElementById('search-input');
const linkList = document.getElementById('link-list');
const emptyState = document.getElementById('empty-state');

const homePills = document.getElementById('home-pills');
const searchSuggestions = document.getElementById('search-suggestions');
const hero = document.getElementById('hero');
const heroGreeting = document.getElementById('hero-greeting');
const avatarBtn = document.getElementById('avatar-btn');
const avatarInitial = document.getElementById('avatar-initial');
const avatarMenu = document.getElementById('avatar-menu');
const headerSearchBtn = document.getElementById('header-search-btn');
const avatarWrap = document.querySelector('.avatar-wrap');
const themeToggle = document.getElementById('theme-toggle');
const densityToggle = document.getElementById('density-toggle');

const createBtn = document.getElementById('create-btn');
const createMenu = document.getElementById('create-menu');
const createWrap = document.querySelector('.create-wrap');
const createModalOverlay = document.getElementById('create-modal-overlay');
const createModalClose = document.getElementById('create-modal-close');
const createModalBody = document.getElementById('create-modal-body');

const collectionsGrid = document.getElementById('collections-grid');
const collectionsRow = document.getElementById('collections-row');
const collectionBackBar = document.getElementById('collection-back-bar');
const collectionBackBtn = document.getElementById('collection-back-btn');
const collectionViewTitle = document.getElementById('collection-view-title');
const collectionPickerOverlay = document.getElementById('collection-picker-overlay');
const collectionPickerList = document.getElementById('collection-picker-list');
const collectionPickerNewForm = document.getElementById('collection-picker-new-form');
const collectionPickerNewInput = document.getElementById('collection-picker-new-input');
const collectionPickerAddToggle = document.getElementById('collection-picker-add-toggle');

const linkDrawerOverlay = document.getElementById('link-drawer-overlay');
const linkDrawerCollage = document.getElementById('link-drawer-collage');
const drawerSaveBtn = document.getElementById('drawer-save-btn');
const drawerCloseBtn = document.getElementById('drawer-close-btn');
const drawerTitle = document.getElementById('drawer-title');
const drawerSource = document.getElementById('drawer-source');
const drawerSubtitle = document.getElementById('drawer-subtitle');
const drawerDescription = document.getElementById('drawer-description');
const drawerTime = document.getElementById('drawer-time');
const drawerCollections = document.getElementById('drawer-collections');
const drawerNotes = document.getElementById('drawer-notes');
const drawerShareBtn = document.getElementById('drawer-share-btn');
const drawerOpenLink = document.getElementById('drawer-open-link');
const drawerDeleteBtn = document.getElementById('drawer-delete-btn');

const extPromoToast = document.getElementById('ext-promo-toast');
const extPromoClose = document.getElementById('ext-promo-close');
const extPromoBtn = document.getElementById('ext-promo-btn');
const progressToast = document.getElementById('progress-toast');
const progressClose = document.getElementById('progress-close');
const progressCountCurrent = document.getElementById('progress-count-current');
const progressBar = document.getElementById('progress-bar');
const PROGRESS_GOAL = 5;

let currentSession = null;
let allLinks = [];
let collections = [];
let homeFilter = '';
let currentView = 'home';
let currentCollectionId = null;
let currentDrawerLink = null;
let collectionPickerLink = null;

const VIEWS = {
  home: { filter: null, layout: 'masonry' },
  biblioteca: { filter: (l) => ['movie', 'tv', 'music'].includes(l.content_type), layout: 'grid' },
  colecoes: { filter: null, layout: 'grid' },
};
const ROUTES = { '': 'home', biblioteca: 'biblioteca', colecoes: 'colecoes' };

// Mantém os mesmos valores usados pela extensão (chrome-extension/popup.js)
function detectSource(url) {
  try {
    const host = new URL(url).hostname.replace('www.', '');
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('twitter.com') || host.includes('x.com')) return 'twitter';
    if (host.includes('reddit.com')) return 'reddit';
    return 'site';
  } catch {
    return 'site';
  }
}

// Classificação mais rica usada para buscar metadados/renderizar cards.
function detectContentType(url) {
  try {
    const host = new URL(url).hostname.replace('www.', '');
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('open.spotify.com')) return 'music';
    if ((host.includes('twitter.com') || host.includes('x.com')) && /\/status\//.test(url)) return 'tweet';
    if (host.includes('instagram.com')) return 'instagram';
    if (host.includes('reddit.com')) return 'social';
    return 'link';
  } catch {
    return 'link';
  }
}

const NEEDS_ENRICHMENT = new Set(['link', 'social', 'youtube', 'music', 'tweet', 'instagram']);

async function init() {
  avatarBtn.addEventListener('click', () => avatarMenu.classList.toggle('hidden'));
  document.addEventListener('click', (e) => {
    if (!avatarWrap.contains(e.target)) avatarMenu.classList.add('hidden');
    if (!createWrap.contains(e.target)) createMenu.classList.add('hidden');
  });
  createBtn.addEventListener('click', () => createMenu.classList.toggle('hidden'));
  createMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.create-menu-item');
    if (!item) return;
    createMenu.classList.add('hidden');
    openCreateModal(item.dataset.action);
  });

  initScrollBlur();
  initThemeToggle();
  initDensityToggle();
  initCollectionBackBtn();

  headerSearchBtn.addEventListener('click', () => {
    if (currentView !== 'home') location.hash = '#/';
    setTimeout(() => searchInput.focus(), 0);
  });

  const { data: { session } } = await supabase.auth.getSession();
  handleSession(session);

  supabase.auth.onAuthStateChange((_event, session) => {
    handleSession(session);
  });

  window.addEventListener('hashchange', renderRoute);
}

function initScrollBlur() {
  let lastY = window.scrollY;
  let resetTimer;
  window.addEventListener(
    'scroll',
    () => {
      const y = window.scrollY;
      const delta = Math.abs(y - lastY);
      lastY = y;
      const blur = Math.min(delta * 0.4, 6);
      linkList.style.transition = 'none';
      linkList.style.filter = `blur(${blur}px)`;
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        linkList.style.transition = 'filter 250ms ease-out';
        linkList.style.filter = 'blur(0px)';
      }, 100);
    },
    { passive: true }
  );
}

function initThemeToggle() {
  const saved = localStorage.getItem('h3aven-theme') || 'dark';
  setTheme(saved, false);
  themeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    setTheme(btn.dataset.theme, true);
  });
}

function setTheme(theme, persist) {
  [...themeToggle.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.dataset.theme === theme));
  if (persist) localStorage.setItem('h3aven-theme', theme);
  // Só o tema escuro existe de fato hoje — os outros ficam preparados na UI.
}

function initDensityToggle() {
  const saved = localStorage.getItem('h3aven-density') || 'medium';
  setDensity(saved, false);
  densityToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    setDensity(btn.dataset.density, true);
  });
}

function setDensity(density, persist) {
  [...densityToggle.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.dataset.density === density));
  linkList.dataset.density = density;
  if (persist) localStorage.setItem('h3aven-density', density);
}

function greetingText() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia! O que você quer salvar hoje?';
  if (h < 18) return 'Boa tarde! O que você quer salvar hoje?';
  return 'Boa noite! O que você quer salvar hoje?';
}

function renderRoute() {
  if (!currentSession) return;
  const hash = location.hash.replace(/^#\/?/, '');
  const collectionMatch = hash.match(/^colecoes\/(.+)$/);

  currentCollectionId = collectionMatch ? collectionMatch[1] : null;
  currentView = collectionMatch ? 'colecoes' : ROUTES[hash] ?? 'home';

  document.querySelectorAll('.pill-nav-link').forEach((a) => {
    a.classList.toggle('active', a.dataset.view === currentView);
  });
  hero.classList.toggle('hidden', currentView !== 'home');
  homePills.classList.toggle('hidden', currentView !== 'home');
  collectionsRow.classList.toggle('hidden', currentView !== 'home');
  if (currentView === 'home') renderCollectionsRow();

  const showingCollectionsList = currentView === 'colecoes' && !currentCollectionId;
  collectionsGrid.classList.toggle('hidden', !showingCollectionsList);
  collectionBackBar.classList.toggle('hidden', !currentCollectionId);
  linkList.classList.toggle('hidden', showingCollectionsList);

  if (showingCollectionsList) {
    renderCollectionsGrid();
  } else {
    if (currentCollectionId) {
      const col = collections.find((c) => c.id === currentCollectionId);
      collectionViewTitle.textContent = col ? col.name : '';
    }
    linkList.className = `library-grid layout-${VIEWS[currentView].layout}`;
    renderLinks(allLinks);
  }
}

function handleSession(session) {
  currentSession = session;
  if (session) {
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    userEmailEl.textContent = session.user.email;
    avatarInitial.textContent = session.user.email[0].toUpperCase();
    heroGreeting.textContent = greetingText();
    loadLinks();
    loadCollections();
  } else {
    loginView.classList.remove('hidden');
    appView.classList.add('hidden');
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email-input').value.trim();
  loginStatus.textContent = 'Enviando...';
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  });
  loginStatus.textContent = error
    ? `Erro: ${error.message}`
    : 'Link enviado! Confira seu email e clique nele.';
});

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
});

async function loadLinks() {
  const { data, error } = await supabase
    .from('links')
    .select('id, url, title, description, source, content_type, metadata, fetch_status, notes, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  allLinks = data;
  renderRoute();
  updateOnboardingToasts();
}

function updateOnboardingToasts() {
  const count = Math.min(allLinks.length, PROGRESS_GOAL);

  if (localStorage.getItem('h3aven-ext-promo-dismissed') !== 'true') {
    extPromoToast.classList.remove('hidden');
  }

  if (allLinks.length < PROGRESS_GOAL && localStorage.getItem('h3aven-progress-dismissed') !== 'true') {
    progressCountCurrent.textContent = count;
    progressBar.innerHTML = '';
    for (let i = 0; i < PROGRESS_GOAL; i++) {
      const segment = document.createElement('span');
      if (i < count) segment.classList.add('filled');
      progressBar.appendChild(segment);
    }
    progressToast.classList.remove('hidden');
  } else {
    progressToast.classList.add('hidden');
  }
}

extPromoClose.addEventListener('click', () => {
  extPromoToast.classList.add('hidden');
  localStorage.setItem('h3aven-ext-promo-dismissed', 'true');
});

extPromoBtn.addEventListener('click', () => openCreateModal('extension'));

progressClose.addEventListener('click', () => {
  progressToast.classList.add('hidden');
  localStorage.setItem('h3aven-progress-dismissed', 'true');
});

function matchesQuery(link, query) {
  if (!query) return true;
  const meta = link.metadata || {};
  const haystack = [link.title, link.url, meta.title, meta.description, meta.overview, meta.author]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function renderLinks(links) {
  const query = searchInput.value.trim().toLowerCase();
  const viewFilter = VIEWS[currentView].filter;
  const collectionLinkIds = currentCollectionId
    ? new Set((collections.find((c) => c.id === currentCollectionId)?.linkIds) || [])
    : null;

  const filtered = links.filter((l) => {
    const matchesView = !viewFilter || viewFilter(l);
    const matchesHomePill = currentView !== 'home' || !homeFilter || l.content_type === homeFilter;
    const matchesCollection = !collectionLinkIds || collectionLinkIds.has(l.id);
    return matchesQuery(l, query) && matchesView && matchesHomePill && matchesCollection;
  });

  linkList.innerHTML = '';
  emptyState.classList.toggle('hidden', filtered.length > 0);

  filtered.forEach((link) => linkList.appendChild(buildCard(link)));
}

function posterUrl(path) {
  return path ? `https://image.tmdb.org/t/p/w342${path}` : null;
}

function cardImageFor(link) {
  const meta = link.metadata || {};
  if (link.content_type === 'movie' || link.content_type === 'tv') return posterUrl(meta.posterPath);
  return meta.image || null;
}

function cardTitleFor(link) {
  const meta = link.metadata || {};
  return meta.title || link.title || link.url;
}

function cardSubtitleFor(link) {
  const meta = link.metadata || {};
  if (link.content_type === 'movie' || link.content_type === 'tv') {
    return meta.year ? `${meta.year} · ${link.content_type === 'movie' ? 'Filme' : 'Série'}` : null;
  }
  if (link.content_type === 'youtube') return meta.author || null;
  if (link.content_type === 'tweet') return meta.author ? `@${meta.author}` : null;
  return cardPriceFor(link);
}

function cardDescriptionFor(link) {
  const meta = link.metadata || {};
  return meta.overview || meta.description || null;
}

function cardPriceFor(link) {
  const price = (link.metadata || {}).price;
  if (!price || !price.amount) return null;
  const amount = parseFloat(price.amount);
  if (Number.isNaN(amount)) return null;
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: price.currency || 'BRL',
    }).format(amount);
  } catch {
    return `${price.currency || ''} ${amount}`.trim();
  }
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// Gradiente único por item, mas sempre dentro da mesma família de azul
// (mesmo espírito das cores que o usuário pediu: #0052D4 → #65C7F7 → #9CECFB).
function placeholderGradient(seed) {
  const hash = hashString(String(seed));
  const hue = 185 + (hash % 35); // 185–219, mesma faixa das cores originais (#0052D4/#65C7F7/#9CECFB)
  const angle = 30 + (hash % 6) * 30; // 30, 60, ..., 180
  const dark = `hsl(${hue}, 85%, 30%)`;
  const mid = `hsl(${hue + 8}, 88%, 55%)`;
  const light = `hsl(${hue + 16}, 92%, 78%)`;
  return `linear-gradient(${angle}deg, ${dark}, ${mid}, ${light})`;
}

function buildCard(link) {
  const li = document.createElement('li');
  li.className = `card card--${link.content_type || 'link'}`;
  if (link.fetch_status === 'pending') li.classList.add('is-pending');
  if (link.fetch_status === 'failed') li.classList.add('is-failed');
  li.setAttribute('role', 'button');
  li.tabIndex = 0;

  const image = cardImageFor(link);
  const media = document.createElement('div');
  media.className = image ? 'card-media' : 'card-media card-media--placeholder';
  if (image) {
    const img = document.createElement('img');
    img.src = image;
    img.loading = 'lazy';
    img.alt = '';
    media.appendChild(img);
  } else {
    media.style.background = placeholderGradient(link.id);
  }

  const scrim = document.createElement('div');
  scrim.className = 'card-scrim';
  media.appendChild(scrim);

  const price = cardPriceFor(link);
  if (price) {
    const priceBadge = document.createElement('span');
    priceBadge.className = 'card-price-badge';
    priceBadge.textContent = price;
    media.appendChild(priceBadge);
  }

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'card-save-btn';
  saveBtn.setAttribute('aria-label', 'Salvar em coleção');
  saveBtn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v16l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>';
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openCollectionPicker(link);
  });
  media.appendChild(saveBtn);

  const favicon = document.createElement('div');
  favicon.className = 'card-favicon-badge';
  favicon.innerHTML = `${faviconIconFor(link)}<span class="card-favicon-domain">${escapeHtml(domainFor(link.url))}</span>`;
  media.appendChild(favicon);

  const title = document.createElement('span');
  title.className = 'card-hover-title';
  title.textContent = cardTitleFor(link);
  media.appendChild(title);

  li.appendChild(media);

  li.addEventListener('click', () => openDrawer(link));
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openDrawer(link);
    }
  });

  return li;
}

// --- Coleções ---

async function loadCollections() {
  const { data, error } = await supabase
    .from('collections')
    .select('id, name, created_at, collection_links(link_id, created_at)')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  collections = data.map((c) => {
    const sorted = [...c.collection_links].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return {
      id: c.id,
      name: c.name,
      linkIds: c.collection_links.map((cl) => cl.link_id),
      thumbIds: sorted.slice(0, 3).map((cl) => cl.link_id),
    };
  });
  if (currentView === 'colecoes') renderRoute();
  if (currentView === 'home') renderCollectionsRow();
}

function renderCollectionsGrid() {
  collectionsGrid.innerHTML = '';

  collections.forEach((col) => {
    const card = document.createElement('a');
    card.href = `#/colecoes/${col.id}`;
    card.className = 'collection-card';
    card.innerHTML = `
      <div class="collection-card-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      </div>
      <p class="collection-card-name">${escapeHtml(col.name)}</p>
      <p class="collection-card-count muted small">${col.linkIds.length} ${col.linkIds.length === 1 ? 'item' : 'itens'}</p>
    `;
    collectionsGrid.appendChild(card);
  });

  const newCard = document.createElement('button');
  newCard.type = 'button';
  newCard.className = 'collection-card collection-card--new';
  newCard.innerHTML = `
    <div class="collection-card-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
    </div>
    <p class="collection-card-name">Nova coleção</p>
  `;
  newCard.addEventListener('click', () => openCreateModal('collection'));
  collectionsGrid.appendChild(newCard);
}

const COLLECTION_STACK_ROTATIONS = [-6, 4, -2];
const COLLECTION_STACK_SPREAD = [
  { x: '-14px', y: '-6px' },
  { x: '0px', y: '8px' },
  { x: '14px', y: '-4px' },
];

function renderCollectionsRow() {
  collectionsRow.innerHTML = '';

  collections.forEach((col) => {
    const card = document.createElement('a');
    card.href = `#/colecoes/${col.id}`;
    card.className = 'collection-row-card';

    const stack = document.createElement('div');
    stack.className = 'collection-stack';
    const thumbs = col.thumbIds.map((id) => allLinks.find((l) => l.id === id)).filter(Boolean);
    if (thumbs.length) {
      thumbs.forEach((link, i) => {
        const tile = document.createElement('div');
        tile.className = 'collection-stack-tile';
        tile.style.setProperty('--rot', `${COLLECTION_STACK_ROTATIONS[i] ?? 0}deg`);
        tile.style.setProperty('--spread-x', `${COLLECTION_STACK_SPREAD[i]?.x ?? '0px'}`);
        tile.style.setProperty('--spread-y', `${COLLECTION_STACK_SPREAD[i]?.y ?? '0px'}`);
        tile.style.zIndex = String(thumbs.length - i);
        const image = cardImageFor(link);
        if (image) tile.style.backgroundImage = `url(${image})`;
        else tile.style.background = placeholderGradient(link.id);
        stack.appendChild(tile);
      });
    } else {
      stack.innerHTML =
        '<div class="collection-stack-empty"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></div>';
    }
    card.appendChild(stack);

    const info = document.createElement('div');
    info.className = 'collection-row-info';
    info.innerHTML = `<p class="collection-row-name">${escapeHtml(col.name)}</p><p class="collection-row-count">${col.linkIds.length} ${col.linkIds.length === 1 ? 'item' : 'itens'}</p>`;
    card.appendChild(info);

    collectionsRow.appendChild(card);
  });

  const newCard = document.createElement('button');
  newCard.type = 'button';
  newCard.className = 'collection-row-card collection-row-card--new';
  newCard.innerHTML = `
    <div class="collection-row-add"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg></div>
    <p class="collection-row-name">Criar coleção</p>
  `;
  newCard.addEventListener('click', () => openCreateModal('collection'));
  collectionsRow.appendChild(newCard);
}

function initCollectionBackBtn() {
  collectionBackBtn.addEventListener('click', () => {
    location.hash = '#/colecoes';
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function createCollection(name) {
  const { data, error } = await supabase
    .from('collections')
    .insert({ name })
    .select()
    .single();
  if (error) {
    console.error(error);
    return null;
  }
  await loadCollections();
  return data;
}

// --- Popover de "salvar em coleção" ---

function openCollectionPicker(link) {
  collectionPickerLink = link;
  renderCollectionPickerList();
  collectionPickerNewForm.classList.add('hidden');
  collectionPickerOverlay.classList.remove('hidden');
}

function closeCollectionPicker() {
  collectionPickerOverlay.classList.add('hidden');
  if (currentDrawerLink && !linkDrawerOverlay.classList.contains('hidden')) {
    renderDrawerCollections(currentDrawerLink);
  }
  collectionPickerLink = null;
}

const BOOKMARK_ICON_OUTLINE =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v16l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>';
const BOOKMARK_ICON_FILLED = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 3h12a1 1 0 0 1 1 1v16l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>';

function renderCollectionPickerList() {
  collectionPickerList.innerHTML = '';
  if (!collections.length) {
    const empty = document.createElement('p');
    empty.className = 'muted small';
    empty.textContent = 'Nenhuma coleção ainda — crie uma com "+ Add" acima.';
    collectionPickerList.appendChild(empty);
    return;
  }
  collections.forEach((col) => {
    const inCollection = col.linkIds.includes(collectionPickerLink.id);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'collection-picker-item';

    const thumbs = document.createElement('div');
    thumbs.className = 'collection-picker-thumbs';
    const thumbLinks = (col.thumbIds || []).slice(0, 2).map((id) => allLinks.find((l) => l.id === id)).filter(Boolean);
    if (thumbLinks.length) {
      thumbLinks.forEach((link) => {
        const tile = document.createElement('div');
        tile.className = 'collection-picker-thumb';
        const image = cardImageFor(link);
        tile.style.background = image ? `url(${image}) center/cover` : placeholderGradient(link.id);
        thumbs.appendChild(tile);
      });
    } else {
      thumbs.classList.add('collection-picker-thumbs--empty');
    }
    row.appendChild(thumbs);

    const info = document.createElement('span');
    info.className = 'collection-picker-info';
    info.innerHTML = `<span class="collection-picker-name">${escapeHtml(col.name)}</span><span class="collection-picker-count">${col.linkIds.length} ${col.linkIds.length === 1 ? 'item' : 'itens'}</span>`;
    row.appendChild(info);

    const bookmark = document.createElement('span');
    bookmark.className = `collection-picker-bookmark${inCollection ? ' collection-picker-bookmark--active' : ''}`;
    bookmark.innerHTML = inCollection ? BOOKMARK_ICON_FILLED : BOOKMARK_ICON_OUTLINE;
    row.appendChild(bookmark);

    row.addEventListener('click', () => toggleLinkInCollection(col, collectionPickerLink));
    collectionPickerList.appendChild(row);
  });
}

async function toggleLinkInCollection(col, link) {
  const inCollection = col.linkIds.includes(link.id);
  if (inCollection) {
    await supabase.from('collection_links').delete().eq('collection_id', col.id).eq('link_id', link.id);
    col.linkIds = col.linkIds.filter((id) => id !== link.id);
  } else {
    await supabase.from('collection_links').insert({ collection_id: col.id, link_id: link.id });
    col.linkIds.push(link.id);
  }
  if (!collectionPickerOverlay.classList.contains('hidden')) renderCollectionPickerList();
  if (currentView === 'colecoes' && currentCollectionId) renderRoute();
}

collectionPickerAddToggle.addEventListener('click', () => {
  const revealed = collectionPickerNewForm.classList.toggle('hidden') === false;
  if (revealed) collectionPickerNewInput.focus();
});

collectionPickerNewForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = collectionPickerNewInput.value.trim();
  if (!name) return;
  const col = await createCollection(name);
  if (col) {
    await supabase.from('collection_links').insert({ collection_id: col.id, link_id: collectionPickerLink.id });
    await loadCollections();
    collectionPickerNewInput.value = '';
    collectionPickerNewForm.classList.add('hidden');
    renderCollectionPickerList();
  }
});

collectionPickerOverlay.addEventListener('click', (e) => {
  if (e.target === collectionPickerOverlay) closeCollectionPicker();
});

// --- Drawer lateral (detalhe de um item salvo) ---

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `há ${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `há ${months} m${months > 1 ? 'eses' : 'ês'}`;
  return `há ${Math.floor(months / 12)} ano(s)`;
}

function domainFor(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return '';
  }
}

// Ícone da própria plataforma quando ela tem uma marca reconhecível; para
// links genéricos, usa o favicon real do domínio (serviço gratuito, sem chave).
const PLATFORM_ICONS = {
  youtube: '<svg width="16" height="16" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#FF0000"/><path d="M10 8l6 4-6 4V8Z" fill="#fff"/></svg>',
  music: '<svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1DB954"/><path d="M6.5 9.5c3.5-1 8-.6 10.8 1.1M7 13c3-.8 6.5-.5 9 .9M7.5 16.2c2.4-.6 5-.4 7 .7" stroke="#fff" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>',
  tweet: '<svg width="16" height="16" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#000"/><path d="M6 6l12 12M18 6 6 18" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
};

function faviconIconFor(link) {
  const platformIcon = PLATFORM_ICONS[link.content_type];
  if (platformIcon) return platformIcon;
  const host = domainFor(link.url);
  if (!host) return '';
  return `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64" alt="" />`;
}

// Recortes decorativos da mesma imagem do link, girados/posicionados
// diferente — pura composição CSS (mesma imagem, position/rotação
// diferentes por tile), sem precisar gerar nada no servidor.
const DRAWER_COLLAGE_TILES = [
  { top: '8%', left: '68%', width: '17%', height: '32%', rot: 8, radius: '16px 20px 12px 24px', bgPos: '20% 10%' },
  { top: '46%', left: '46%', width: '17%', height: '36%', rot: -5, radius: '18px 18px 24px 24px', bgPos: '60% 70%' },
  { top: '52%', left: '33%', width: '8%', height: '20%', rot: 3, radius: '8px 8px 16px 16px', bgPos: '40% 40%' },
  { top: '36%', left: '4%', width: '15%', height: '20%', rot: -4, radius: '24px 12px 24px 12px', bgPos: '80% 20%' },
  { top: '28%', left: '37%', width: '8%', height: '15%', rot: 6, radius: '10px', bgPos: '10% 80%' },
  { top: '72%', left: '66%', width: '14%', height: '24%', rot: 0, radius: '20px 20px 0 0', bgPos: '50% 50%' },
  { top: '0%', left: '46%', width: '9%', height: '10%', rot: 0, radius: '0 0 12px 12px', bgPos: '30% 90%' },
];

function buildDrawerCollage(image) {
  linkDrawerCollage.innerHTML = '';
  linkDrawerCollage.classList.toggle('hidden', !image);
  if (!image) return;
  DRAWER_COLLAGE_TILES.forEach((t) => {
    const tile = document.createElement('div');
    tile.className = 'link-drawer-collage-tile';
    tile.style.top = t.top;
    tile.style.left = t.left;
    tile.style.width = t.width;
    tile.style.height = t.height;
    tile.style.borderRadius = t.radius;
    tile.style.backgroundImage = `url(${image})`;
    tile.style.backgroundPosition = t.bgPos;
    tile.style.transform = `rotate(${t.rot}deg)`;
    linkDrawerCollage.appendChild(tile);
  });
}

function renderDrawerCollections(link) {
  drawerCollections.innerHTML = '';
  collections
    .filter((c) => c.linkIds.includes(link.id))
    .forEach((col) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'link-drawer-collection-chip';
      chip.textContent = col.name;
      chip.title = 'Remover dessa coleção';
      chip.addEventListener('click', async () => {
        await toggleLinkInCollection(col, link);
        renderDrawerCollections(link);
      });
      drawerCollections.appendChild(chip);
    });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'link-drawer-collection-add';
  addBtn.setAttribute('aria-label', 'Adicionar a uma coleção');
  addBtn.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
  addBtn.addEventListener('click', () => openCollectionPicker(link));
  drawerCollections.appendChild(addBtn);
}

function openDrawer(link) {
  currentDrawerLink = link;

  drawerTitle.textContent = cardTitleFor(link);
  drawerSource.innerHTML = `${faviconIconFor(link)}<span>${escapeHtml(domainFor(link.url))}</span>`;

  const subtitle = cardSubtitleFor(link);
  drawerSubtitle.textContent = subtitle || '';
  drawerSubtitle.classList.toggle('hidden', !subtitle);

  const description = cardDescriptionFor(link);
  drawerDescription.textContent = description || 'Sem resumo disponível.';

  drawerTime.textContent = timeAgo(link.created_at);
  drawerOpenLink.href = link.url;

  drawerNotes.value = link.notes || '';

  renderDrawerCollections(link);
  buildDrawerCollage(cardImageFor(link));

  linkDrawerOverlay.classList.remove('hidden');
}

function closeDrawer() {
  linkDrawerOverlay.classList.add('hidden');
  currentDrawerLink = null;
}

drawerNotes.addEventListener('blur', async () => {
  if (!currentDrawerLink) return;
  const notes = drawerNotes.value.trim();
  await supabase.from('links').update({ notes: notes || null }).eq('id', currentDrawerLink.id);
  currentDrawerLink.notes = notes;
});

drawerShareBtn.addEventListener('click', async () => {
  if (!currentDrawerLink) return;
  const shareLabel = drawerShareBtn.querySelector('span');
  if (navigator.share) {
    try {
      await navigator.share({ title: cardTitleFor(currentDrawerLink), url: currentDrawerLink.url });
      return;
    } catch {
      // usuário cancelou o share nativo — cai pro fallback de copiar
    }
  }
  await navigator.clipboard.writeText(currentDrawerLink.url);
  shareLabel.textContent = 'Copiado!';
  setTimeout(() => (shareLabel.textContent = 'Compartilhar'), 1500);
});

drawerSaveBtn.addEventListener('click', () => {
  if (currentDrawerLink) openCollectionPicker(currentDrawerLink);
});

drawerDeleteBtn.addEventListener('click', async () => {
  if (!currentDrawerLink) return;
  await deleteLink(currentDrawerLink.id);
  closeDrawer();
});

drawerCloseBtn.addEventListener('click', closeDrawer);
linkDrawerOverlay.addEventListener('click', (e) => {
  if (e.target === linkDrawerOverlay || e.target.classList.contains('link-drawer-backdrop')) closeDrawer();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!linkDrawerOverlay.classList.contains('hidden')) closeDrawer();
  if (!createModalOverlay.classList.contains('hidden')) closeCreateModal();
  if (!collectionPickerOverlay.classList.contains('hidden')) closeCollectionPicker();
});

searchInput.addEventListener('input', () => {
  renderLinks(allLinks);
  renderSearchSuggestions();
});
searchInput.addEventListener('focus', () => renderSearchSuggestions());
document.addEventListener('click', (e) => {
  if (!e.target.closest('.hero-search-bar')) searchSuggestions.classList.add('hidden');
});
document.getElementById('hero-search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  renderLinks(allLinks);
  searchSuggestions.classList.add('hidden');
});

function renderSearchSuggestions() {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) {
    searchSuggestions.classList.add('hidden');
    searchSuggestions.innerHTML = '';
    return;
  }

  const matches = allLinks.filter((l) => matchesQuery(l, query)).slice(0, 6);
  searchSuggestions.innerHTML = '';
  if (!matches.length) {
    searchSuggestions.classList.add('hidden');
    return;
  }

  matches.forEach((link) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'search-suggestion';
    const image = cardImageFor(link);
    if (image) {
      const img = document.createElement('img');
      img.src = image;
      img.alt = '';
      item.appendChild(img);
    }
    const label = document.createElement('span');
    label.textContent = cardTitleFor(link);
    item.appendChild(label);
    item.addEventListener('click', () => {
      openDrawer(link);
      searchSuggestions.classList.add('hidden');
    });
    searchSuggestions.appendChild(item);
  });
  searchSuggestions.classList.remove('hidden');
}

homePills.addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-pill');
  if (!btn) return;
  homeFilter = btn.dataset.filter;
  [...homePills.querySelectorAll('.filter-pill')].forEach((b) => {
    b.classList.toggle('active', b === btn);
  });
  renderLinks(allLinks);
});

// --- Core: salvar / tags / enriquecimento / excluir (reaproveitados pelos
// fluxos do menu "Criar" e pela extensão indiretamente via mesma tabela) ---

async function saveLink({ url, title, collectionNames, contentType }) {
  const source = detectSource(url);
  const needsEnrichment = NEEDS_ENRICHMENT.has(contentType);

  const { data: linkRow, error: linkError } = await supabase
    .from('links')
    .insert({
      url,
      title: title || null,
      source,
      content_type: contentType,
      fetch_status: needsEnrichment ? 'pending' : 'ready',
    })
    .select()
    .single();

  if (linkError) {
    console.error(linkError);
    return null;
  }

  await attachToCollections(linkRow.id, collectionNames);
  loadLinks();

  if (needsEnrichment) {
    await enrichLink(linkRow.id, url, contentType);
    loadLinks();
  }

  return linkRow;
}

async function attachToCollections(linkId, names) {
  for (const name of names) {
    let col = collections.find((c) => c.name === name);
    if (!col) {
      const created = await createCollection(name);
      if (!created) continue;
      col = collections.find((c) => c.id === created.id);
      if (!col) continue;
    }
    await supabase.from('collection_links').insert({ collection_id: col.id, link_id: linkId });
    col.linkIds.push(linkId);
  }
}

async function enrichLink(linkId, url, contentType) {
  try {
    const { error } = await supabase.functions.invoke('fetch-metadata', {
      body: { action: 'enrich', linkId, url, contentType },
    });
    if (error) console.error(error);
  } catch (err) {
    console.error(err);
  }
}

async function deleteLink(id) {
  await supabase.from('links').delete().eq('id', id);
  loadLinks();
}

// --- Menu "Criar" ---

function openCreateModal(kind) {
  createModalBody.innerHTML = CREATE_MODAL_TEMPLATES[kind]();
  CREATE_MODAL_INIT[kind]();
  createModalOverlay.querySelector('.create-modal').classList.toggle('create-modal--media', kind === 'media');
  createModalOverlay.classList.toggle('overlay--intense-blur', kind === 'media');
  createModalOverlay.classList.remove('hidden');
}

function closeCreateModal() {
  createModalOverlay.classList.add('hidden');
  createModalOverlay.classList.remove('overlay--intense-blur');
  createModalBody.innerHTML = '';
}

createModalClose.addEventListener('click', closeCreateModal);
createModalOverlay.addEventListener('click', (e) => {
  if (e.target === createModalOverlay) closeCreateModal();
});

const CREATE_MODAL_TEMPLATES = {
  collection: () => `
    <h2>Nova coleção</h2>
    <form id="cm-collection-form" class="cm-form">
      <input type="text" id="cm-collection-name" placeholder="Nome da coleção" autocomplete="off" required />
      <button type="submit">Criar</button>
    </form>
    <p id="cm-collection-status" class="muted small"></p>
  `,
  media: () => `
    <h2>Filme ou série</h2>
    <div class="media-search-input-wrap">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input type="text" id="cm-media-search-input" placeholder="Buscar por título..." autocomplete="off" />
    </div>
    <p id="cm-media-status" class="muted small"></p>
    <div id="cm-media-results" class="media-results"></div>
  `,
  music: () => `
    <h2>Adicionar música</h2>
    <form id="cm-music-form" class="cm-form">
      <input type="url" id="cm-music-url" placeholder="Link do Spotify" autocomplete="off" required />
      <input type="text" id="cm-music-tags" placeholder="tags separadas por vírgula" autocomplete="off" />
      <button type="submit">Salvar</button>
    </form>
    <p id="cm-music-status" class="muted small"></p>
  `,
  import: () => `
    <h2>Importar lista</h2>
    <p class="muted small">Cole uma linha por item, direto de uma planilha: URL e, se quiser, as coleções na coluna ao lado (uma célula com nomes separados por vírgula). Linhas só com URL também funcionam.</p>
    <form id="cm-import-form" class="cm-form">
      <textarea id="cm-import-textarea" rows="8" placeholder="https://exemplo.com/1&#9;coleção1, coleção2&#10;https://exemplo.com/2"></textarea>
      <button type="submit">Importar</button>
    </form>
    <p id="cm-import-status" class="muted small"></p>
  `,
  extension: () => `
    <h2>Extensão do Chrome</h2>
    <p class="muted small">Cole este token na tela de opções da extensão, uma única vez.</p>
    <div class="token-row">
      <code id="cm-sync-token">••••••••••••••••</code>
      <button type="button" id="cm-reveal-token-btn" class="ghost small-btn">Mostrar</button>
      <button type="button" id="cm-copy-token-btn" class="ghost small-btn">Copiar</button>
    </div>
  `,
};

const CREATE_MODAL_INIT = {
  collection: () => {
    const form = document.getElementById('cm-collection-form');
    const status = document.getElementById('cm-collection-status');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('cm-collection-name').value.trim();
      if (!name) return;
      status.textContent = 'Criando...';
      const col = await createCollection(name);
      if (col) {
        closeCreateModal();
        location.hash = `#/colecoes/${col.id}`;
      } else {
        status.textContent = 'Erro ao criar (nome já existe?).';
      }
    });
  },
  media: () => {
    const searchInputEl = document.getElementById('cm-media-search-input');
    const statusEl = document.getElementById('cm-media-status');
    const resultsEl = document.getElementById('cm-media-results');
    let debounceTimer;

    async function runSearch() {
      const query = searchInputEl.value.trim();
      if (!query) {
        statusEl.textContent = '';
        resultsEl.innerHTML = '';
        return;
      }
      statusEl.textContent = 'Buscando...';
      const { data, error } = await supabase.functions.invoke('fetch-metadata', {
        body: { action: 'search', query },
      });
      if (error) {
        statusEl.textContent = `Erro na busca: ${error.message}`;
        return;
      }
      const results = data?.results || [];
      resultsEl.innerHTML = '';
      statusEl.textContent = results.length ? '' : 'Nada encontrado.';
      results.forEach((r) => resultsEl.appendChild(buildMediaResult(r, statusEl)));
    }

    searchInputEl.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runSearch, 350);
    });
    searchInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(debounceTimer);
        runSearch();
      }
    });
    searchInputEl.focus();
  },
  music: () => {
    const form = document.getElementById('cm-music-form');
    const status = document.getElementById('cm-music-status');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('cm-music-url').value.trim();
      const tagsRaw = document.getElementById('cm-music-tags').value.trim();
      const collectionNames = tagsRaw ? tagsRaw.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean) : [];
      status.textContent = 'Salvando...';
      const row = await saveLink({ url, title: '', collectionNames, contentType: 'music' });
      if (row) {
        closeCreateModal();
      } else {
        status.textContent = 'Erro ao salvar.';
      }
    });
  },
  import: () => {
    const form = document.getElementById('cm-import-form');
    const status = document.getElementById('cm-import-status');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = document.getElementById('cm-import-textarea').value;
      const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return;

      status.textContent = `Importando 0/${lines.length}...`;
      let done = 0;

      await Promise.all(
        lines.map(async (line) => {
          const [urlPart, collectionsPart] = line.includes('\t') ? line.split('\t') : [line, ''];
          const url = urlPart.trim();
          const collectionNames = collectionsPart
            ? collectionsPart.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean)
            : [];
          try {
            new URL(url);
          } catch {
            done++;
            return;
          }
          await saveLink({ url, title: '', collectionNames, contentType: detectContentType(url) });
          done++;
          status.textContent = `Importando ${done}/${lines.length}...`;
        })
      );

      status.textContent = `Concluído: ${done} item(ns) importado(s).`;
      setTimeout(closeCreateModal, 1200);
    });
  },
  extension: () => {
    const tokenEl = document.getElementById('cm-sync-token');
    const revealBtn = document.getElementById('cm-reveal-token-btn');
    const copyBtnEl = document.getElementById('cm-copy-token-btn');
    tokenEl.dataset.value = currentSession.refresh_token;

    revealBtn.addEventListener('click', () => {
      const revealed = tokenEl.dataset.revealed === 'true';
      tokenEl.textContent = revealed ? '••••••••••••••••' : tokenEl.dataset.value;
      tokenEl.dataset.revealed = String(!revealed);
      revealBtn.textContent = revealed ? 'Mostrar' : 'Ocultar';
    });

    copyBtnEl.addEventListener('click', async () => {
      await navigator.clipboard.writeText(tokenEl.dataset.value);
      copyBtnEl.textContent = 'Copiado!';
      setTimeout(() => (copyBtnEl.textContent = 'Copiar'), 1500);
    });
  },
};

function buildMediaResult(result, statusEl) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'media-result';

  const poster = posterUrl(result.posterPath);
  if (poster) {
    const img = document.createElement('img');
    img.src = poster;
    img.alt = '';
    img.loading = 'lazy';
    btn.appendChild(img);
  }

  const info = document.createElement('div');
  info.className = 'media-result-info';
  const title = document.createElement('div');
  title.className = 'media-result-title';
  title.textContent = result.title;
  const year = document.createElement('div');
  year.className = 'media-result-year';
  year.textContent = result.year || '';
  info.append(title, year);
  btn.appendChild(info);

  btn.addEventListener('click', () => saveMediaResult(result, statusEl));
  return btn;
}

async function saveMediaResult(result, statusEl) {
  const mediaType = result.mediaType === 'tv' ? 'tv' : 'movie';
  const url = `https://www.themoviedb.org/${mediaType}/${result.id}`;

  const { error } = await supabase.from('links').insert({
    url,
    title: result.title,
    source: 'tmdb',
    content_type: mediaType,
    external_id: `tmdb:${mediaType}:${result.id}`,
    fetch_status: 'ready',
    metadata: {
      title: result.title,
      year: result.year,
      posterPath: result.posterPath,
      overview: result.overview,
    },
  });

  if (error) {
    console.error(error);
    statusEl.textContent = 'Erro ao salvar.';
    return;
  }

  statusEl.textContent = 'Salvo!';
  loadLinks();
  setTimeout(closeCreateModal, 700);
}

init();
