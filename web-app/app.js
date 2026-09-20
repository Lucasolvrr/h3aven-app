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
const passwordInput = document.getElementById('password-input');
const authHeadline = document.getElementById('auth-headline');
const authSubline = document.getElementById('auth-subline');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authToggleText = document.getElementById('auth-toggle-text');
const authToggleBtn = document.getElementById('auth-toggle-btn');
const authForgotBtn = document.getElementById('auth-forgot-btn');
const recoveryView = document.getElementById('recovery-view');
const recoveryForm = document.getElementById('recovery-form');
const recoveryStatus = document.getElementById('recovery-status');
const userEmailEl = document.getElementById('user-email');
const logoutBtn = document.getElementById('logout-btn');
const linkList = document.getElementById('link-list');
const emptyState = document.getElementById('empty-state');

const avatarBtn = document.getElementById('avatar-btn');
const avatarInitial = document.getElementById('avatar-initial');
const avatarMenu = document.getElementById('avatar-menu');
const settingsBtn = document.getElementById('settings-btn');
const headerSearchBtn = document.getElementById('header-search-btn');
const searchOverlay = document.getElementById('search-overlay');
const searchOverlayForm = document.getElementById('search-overlay-form');
const searchOverlayInput = document.getElementById('search-overlay-input');
const searchOverlayResults = document.getElementById('search-overlay-results');
const searchOverlayStatus = document.getElementById('search-overlay-status');
const searchResultsSection = document.getElementById('search-results-section');
const searchCategoryChip = document.getElementById('search-category-chip');
const searchCategoryLabel = document.getElementById('search-category-label');
const searchCategoryClear = document.getElementById('search-category-clear');
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
const bibliotecaTabs = document.getElementById('biblioteca-tabs');
const collectionBackBtn = document.getElementById('collection-back-btn');
const collectionViewTitle = document.getElementById('collection-view-title');
const collectionPickerOverlay = document.getElementById('collection-picker-overlay');
const collectionPickerPanel = document.querySelector('.collection-picker');
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
const drawerCopyBtn = document.getElementById('drawer-copy-btn');
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
let currentView = 'home';
let currentCollectionId = null;
let currentDrawerLink = null;
let collectionPickerLink = null;
let currentBibliotecaTab = '';

const MEDIA_TYPES = ['movie', 'tv', 'music'];
const VIEWS = {
  home: { filter: (l) => !MEDIA_TYPES.includes(l.content_type), layout: 'masonry' },
  biblioteca: {
    filter: (l) => MEDIA_TYPES.includes(l.content_type) && (!currentBibliotecaTab || l.content_type === currentBibliotecaTab),
    layout: 'grid',
  },
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
  settingsBtn.addEventListener('click', () => {
    avatarMenu.classList.add('hidden');
    openCreateModal('account');
  });
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

  initThemeToggle();
  initDensityToggle();
  initCollectionBackBtn();

  if (new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery') {
    isPasswordRecovery = true;
  }

  const { data: { session } } = await supabase.auth.getSession();
  handleSession(session);

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') isPasswordRecovery = true;
    handleSession(session);
  });

  window.addEventListener('hashchange', renderRoute);
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

function renderRoute() {
  if (!currentSession) return;
  const hash = location.hash.replace(/^#\/?/, '');
  const collectionMatch = hash.match(/^colecoes\/(.+)$/);

  currentCollectionId = collectionMatch ? collectionMatch[1] : null;
  currentView = collectionMatch ? 'colecoes' : ROUTES[hash] ?? 'home';

  document.querySelectorAll('.pill-nav-link').forEach((a) => {
    a.classList.toggle('active', a.dataset.view === currentView);
  });
  collectionsRow.classList.toggle('hidden', currentView !== 'home');
  if (currentView === 'home') renderCollectionsRow();
  bibliotecaTabs.classList.toggle('hidden', currentView !== 'biblioteca');

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

let isPasswordRecovery = false;

function handleSession(session) {
  currentSession = session;
  if (isPasswordRecovery && session) {
    loginView.classList.add('hidden');
    appView.classList.add('hidden');
    recoveryView.classList.remove('hidden');
    return;
  }
  recoveryView.classList.add('hidden');
  if (session) {
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    userEmailEl.textContent = session.user.email;
    avatarInitial.textContent = session.user.email[0].toUpperCase();
    loadLinks();
    loadCollections();
  } else {
    loginView.classList.remove('hidden');
    appView.classList.add('hidden');
  }
}

recoveryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('recovery-password-input').value;
  const confirm = document.getElementById('recovery-password-confirm-input').value;
  if (password !== confirm) {
    recoveryStatus.textContent = 'As senhas não coincidem.';
    return;
  }
  recoveryStatus.textContent = 'Salvando...';
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    recoveryStatus.textContent = `Erro: ${error.message}`;
    return;
  }
  isPasswordRecovery = false;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  handleSession(currentSession);
});

let authMode = 'signup';

function setAuthMode(mode) {
  authMode = mode;
  loginStatus.textContent = '';
  if (mode === 'signup') {
    authHeadline.textContent = 'Crie sua conta gratuita';
    authSubline.textContent = 'Sua biblioteca pessoal, sincronizada com a extensão.';
    authSubmitBtn.textContent = 'Criar conta';
    authToggleText.textContent = 'Já tem uma conta?';
    authToggleBtn.textContent = 'Entrar';
  } else {
    authHeadline.textContent = 'Bem-vindo de volta';
    authSubline.textContent = 'Entre com seu email e senha.';
    authSubmitBtn.textContent = 'Entrar';
    authToggleText.textContent = 'Ainda não tem conta?';
    authToggleBtn.textContent = 'Criar conta';
  }
}

authToggleBtn.addEventListener('click', () => {
  setAuthMode(authMode === 'signup' ? 'signin' : 'signup');
});

authForgotBtn.addEventListener('click', async () => {
  const email = document.getElementById('email-input').value.trim();
  if (!email) {
    loginStatus.textContent = 'Digite seu email acima antes de pedir a redefinição.';
    return;
  }
  loginStatus.textContent = 'Enviando...';
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href,
  });
  loginStatus.textContent = error
    ? `Erro: ${error.message}`
    : 'Email de redefinição enviado! Confira sua caixa de entrada.';
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email-input').value.trim();
  const password = passwordInput.value;
  loginStatus.textContent = authMode === 'signup' ? 'Criando conta...' : 'Entrando...';

  const { data, error } =
    authMode === 'signup'
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    loginStatus.textContent = `Erro: ${error.message}`;
  } else if (authMode === 'signup' && !data.session) {
    loginStatus.textContent = 'Conta criada! Confira seu email para confirmar antes de entrar.';
  } else {
    loginStatus.textContent = '';
  }
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
  const viewFilter = VIEWS[currentView].filter;
  const collectionLinkIds = currentCollectionId
    ? new Set((collections.find((c) => c.id === currentCollectionId)?.linkIds) || [])
    : null;

  const filtered = links.filter((l) => {
    const matchesView = !viewFilter || viewFilter(l);
    const matchesCollection = !collectionLinkIds || collectionLinkIds.has(l.id);
    return matchesView && matchesCollection;
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
  if (link.content_type === 'music') return buildAlbumCard(link);

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
    openCollectionPicker(link, e);
  });
  media.appendChild(saveBtn);

  const favicon = document.createElement('div');
  favicon.className = 'card-favicon-badge';
  favicon.innerHTML = faviconIconFor(link);
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

// Card de álbum/faixa (Ref: "untitled" — capa quadrada com play sempre
// visível, título abaixo e uma linha de fonte + menu, diferente do card
// genérico com hover-reveal usado pros outros tipos de conteúdo.
function buildAlbumCard(link) {
  const li = document.createElement('li');
  li.className = 'card card--music album-card';
  li.setAttribute('role', 'button');
  li.tabIndex = 0;

  const media = document.createElement('div');
  media.className = 'album-card-media';
  const image = cardImageFor(link);
  if (image) {
    const img = document.createElement('img');
    img.src = image;
    img.loading = 'lazy';
    img.alt = '';
    media.appendChild(img);
  } else {
    media.style.background = placeholderGradient(link.id);
  }

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'album-play-btn';
  playBtn.setAttribute('aria-label', 'Abrir faixa');
  playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.open(link.url, '_blank', 'noopener');
  });
  media.appendChild(playBtn);
  li.appendChild(media);

  const info = document.createElement('div');
  info.className = 'album-card-info';

  const title = document.createElement('h3');
  title.className = 'album-card-title';
  title.textContent = cardTitleFor(link);
  info.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'album-card-meta';
  const artist = (link.metadata || {}).artist || domainFor(link.url);
  meta.innerHTML = `<span class="album-card-source">${PLATFORM_ICONS.music}</span><span class="album-card-artist">${escapeHtml(artist || '')}</span>`;

  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'album-card-menu';
  menuBtn.setAttribute('aria-label', 'Salvar em coleção');
  menuBtn.textContent = '⋯';
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openCollectionPicker(link, e);
  });
  meta.appendChild(menuBtn);
  info.appendChild(meta);
  li.appendChild(info);

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

bibliotecaTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.biblioteca-tab');
  if (!btn || btn.disabled) return;
  currentBibliotecaTab = btn.dataset.tab;
  [...bibliotecaTabs.querySelectorAll('.biblioteca-tab')].forEach((b) => b.classList.toggle('active', b === btn));
  renderLinks(allLinks);
});

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

function openCollectionPicker(link, triggerEvent) {
  collectionPickerLink = link;
  renderCollectionPickerList();
  collectionPickerNewForm.classList.add('hidden');
  collectionPickerOverlay.classList.remove('hidden');
  positionCollectionPicker(triggerEvent?.currentTarget);
}

// Posiciona o popover perto de onde o usuário clicou (card ou drawer) em vez
// de sempre centralizado — cai pra cima do gatilho quando não cabe embaixo.
function positionCollectionPicker(trigger) {
  const margin = 12;
  const panelWidth = collectionPickerPanel.offsetWidth || 408;
  const panelHeight = collectionPickerPanel.offsetHeight || 320;

  let top = window.innerHeight / 2 - panelHeight / 2;
  let left = window.innerWidth / 2 - panelWidth / 2;

  if (trigger) {
    const rect = trigger.getBoundingClientRect();
    top = rect.bottom + margin;
    left = rect.left;
    if (top + panelHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - panelHeight - margin);
    }
    if (left + panelWidth > window.innerWidth - margin) {
      left = window.innerWidth - panelWidth - margin;
    }
    left = Math.max(margin, left);
  }

  collectionPickerPanel.style.top = `${top}px`;
  collectionPickerPanel.style.left = `${left}px`;
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

    const left = document.createElement('span');
    left.className = 'collection-picker-item-left';

    const thumbs = document.createElement('div');
    thumbs.className = 'collection-picker-thumbs';
    const thumbLinks = (col.thumbIds || []).slice(0, 3).map((id) => allLinks.find((l) => l.id === id)).filter(Boolean);
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
    left.appendChild(thumbs);

    const info = document.createElement('span');
    info.innerHTML = `<span class="collection-picker-name">${escapeHtml(col.name)}</span><span class="collection-picker-count">${col.linkIds.length}</span>`;
    left.appendChild(info);
    row.appendChild(left);

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
  music: '<svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1DB954"/><circle cx="12" cy="12" r="6" fill="#0b3d1f"/><circle cx="12" cy="12" r="1.6" fill="#1DB954"/></svg>',
  tweet: '<svg width="16" height="16" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#000"/><path d="M6 6l12 12M18 6 6 18" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
  movie: '<svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#01b4e4"/><path d="M5 10h14v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7Z" fill="#fff"/><path d="M5 10l1.5-3h3L8 10H5Zm5 0 1.5-3h3L13 10h-3Zm5 0 1.5-3H19l-1 3h-3Z" fill="#0d253f"/></svg>',
  tv: '<svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#01b4e4"/><rect x="5" y="7" width="14" height="10" rx="1.5" fill="#fff"/><path d="M9 19h6" stroke="#0d253f" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

// Mídias adicionadas manualmente (filme/série/música, via busca) não mostram
// a favicon real do site de origem (TMDB/Spotify) — vira a miniatura de
// categoria, já que elas não navegam para o site de origem no dia a dia.
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

  if (!drawerCollections.children.length) {
    const empty = document.createElement('span');
    empty.className = 'link-drawer-collections-empty muted small';
    empty.textContent = 'Nenhuma coleção ainda.';
    drawerCollections.appendChild(empty);
  }
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
  document.body.classList.add('scroll-locked');
}

function closeDrawer() {
  linkDrawerOverlay.classList.add('hidden');
  document.body.classList.remove('scroll-locked');
  currentDrawerLink = null;
}

drawerNotes.addEventListener('blur', async () => {
  if (!currentDrawerLink) return;
  const notes = drawerNotes.value.trim();
  await supabase.from('links').update({ notes: notes || null }).eq('id', currentDrawerLink.id);
  currentDrawerLink.notes = notes;
});

drawerCopyBtn.addEventListener('click', async () => {
  if (!currentDrawerLink) return;
  await navigator.clipboard.writeText(currentDrawerLink.url);
  drawerCopyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  setTimeout(() => {
    drawerCopyBtn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  }, 1500);
});

drawerSaveBtn.addEventListener('click', (e) => {
  if (currentDrawerLink) openCollectionPicker(currentDrawerLink, e);
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
  if (!searchOverlay.classList.contains('hidden')) closeSearchOverlay();
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
  createModalOverlay.classList.remove('hidden');
}

function closeCreateModal() {
  createModalOverlay.classList.add('hidden');
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
  account: () => `
    <h2>Configurações da conta</h2>
    <form id="cm-account-email-form" class="cm-form">
      <input type="email" id="cm-account-email" required autocomplete="email" />
      <button type="submit">Salvar email</button>
    </form>
    <p id="cm-account-email-status" class="muted small"></p>

    <form id="cm-account-password-form" class="cm-form cm-form-section">
      <input type="password" id="cm-account-password" placeholder="Nova senha" minlength="6" required autocomplete="new-password" />
      <button type="submit">Salvar senha</button>
    </form>
    <p id="cm-account-password-status" class="muted small"></p>
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
  account: () => {
    const emailForm = document.getElementById('cm-account-email-form');
    const emailInput = document.getElementById('cm-account-email');
    const emailStatus = document.getElementById('cm-account-email-status');
    emailInput.value = currentSession.user.email;

    emailForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newEmail = emailInput.value.trim();
      if (!newEmail || newEmail === currentSession.user.email) return;
      emailStatus.textContent = 'Salvando...';
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      emailStatus.textContent = error
        ? `Erro: ${error.message}`
        : 'Confira a caixa de entrada do novo email para confirmar a troca.';
    });

    const passwordForm = document.getElementById('cm-account-password-form');
    const passwordFormInput = document.getElementById('cm-account-password');
    const passwordStatus = document.getElementById('cm-account-password-status');

    passwordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      passwordStatus.textContent = 'Salvando...';
      const { error } = await supabase.auth.updateUser({ password: passwordFormInput.value });
      passwordStatus.textContent = error ? `Erro: ${error.message}` : 'Senha atualizada!';
      if (!error) passwordForm.reset();
    });
  },
};

// Salva um resultado de busca externa (TMDB ou Spotify) direto na
// biblioteca — reaproveitado pelo overlay de busca unificada.
async function saveExternalResult(result) {
  let payload;
  if (result.mediaType === 'music') {
    if (!result.url) return { error: 'Sem link do Spotify pra esse resultado.' };
    payload = {
      url: result.url,
      title: result.title,
      source: 'spotify',
      content_type: 'music',
      external_id: `spotify:track:${result.id}`,
      fetch_status: 'ready',
      metadata: { title: result.title, artist: result.artist, year: result.year, image: result.image },
    };
  } else {
    const mediaType = result.mediaType === 'tv' ? 'tv' : 'movie';
    payload = {
      url: `https://www.themoviedb.org/${mediaType}/${result.id}`,
      title: result.title,
      source: 'tmdb',
      content_type: mediaType,
      external_id: `tmdb:${mediaType}:${result.id}`,
      fetch_status: 'ready',
      metadata: { title: result.title, year: result.year, posterPath: result.posterPath, overview: result.overview },
    };
  }

  const { error } = await supabase.from('links').insert(payload);
  if (error) {
    console.error(error);
    return { error: 'Erro ao salvar.' };
  }
  loadLinks();
  return { error: null };
}

// --- Overlay de busca unificada (Início/header) ---
// Sem categoria travada: filtra os itens já salvos (via matchesQuery).
// Com uma categoria travada (Filmes/Séries/
// Músicas): busca externa (TMDB ou Spotify), absorvendo os antigos fluxos
// "Filme ou série"/"Música" do Criar.

const SEARCH_CATEGORY_LABELS = { filmes: 'Filmes', series: 'Séries', musicas: 'Músicas' };
let searchOverlayCategory = null;
let searchOverlayDebounce;

function openSearchOverlay() {
  searchOverlayCategory = null;
  searchCategoryChip.classList.add('hidden');
  document.querySelectorAll('.search-category-card').forEach((c) => c.classList.remove('active'));
  searchOverlayInput.value = '';
  searchOverlayResults.innerHTML = '';
  searchOverlayStatus.classList.add('hidden');
  searchResultsSection.classList.add('hidden');
  searchOverlay.classList.remove('hidden');
  setTimeout(() => searchOverlayInput.focus(), 0);
}

function closeSearchOverlay() {
  searchOverlay.classList.add('hidden');
}

function setSearchCategory(category) {
  searchOverlayCategory = category;
  document.querySelectorAll('.search-category-card').forEach((c) => {
    c.classList.toggle('active', c.dataset.category === category);
  });
  if (category) {
    searchCategoryLabel.textContent = SEARCH_CATEGORY_LABELS[category];
    searchCategoryChip.classList.remove('hidden');
  } else {
    searchCategoryChip.classList.add('hidden');
  }
  searchOverlayInput.focus();
  runSearchOverlayQuery();
}

function renderSavedResults(query) {
  searchResultsSection.classList.toggle('hidden', !query);
  const matches = query ? allLinks.filter((l) => matchesQuery(l, query)).slice(0, 20) : [];
  searchOverlayResults.innerHTML = '';
  searchOverlayStatus.classList.toggle('hidden', !query || matches.length > 0);
  if (query && !matches.length) searchOverlayStatus.textContent = 'Nada encontrado nos itens salvos.';
  matches.forEach((link) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'search-result-row';
    const thumb = document.createElement('div');
    thumb.className = 'search-result-thumb';
    const image = cardImageFor(link);
    thumb.style.background = image ? `url(${image}) center/cover` : placeholderGradient(link.id);
    row.appendChild(thumb);
    const info = document.createElement('div');
    info.className = 'search-result-info';
    info.innerHTML = `<span class="search-result-title">${escapeHtml(cardTitleFor(link))}</span><span class="search-result-subtitle">${escapeHtml(domainFor(link.url))}</span>`;
    row.appendChild(info);
    row.addEventListener('click', () => {
      closeSearchOverlay();
      openDrawer(link);
    });
    searchOverlayResults.appendChild(row);
  });
}

async function runSearchOverlayQuery() {
  const query = searchOverlayInput.value.trim();

  if (!searchOverlayCategory) {
    renderSavedResults(query);
    return;
  }

  searchResultsSection.classList.toggle('hidden', !query);
  if (!query) {
    searchOverlayResults.innerHTML = '';
    searchOverlayStatus.classList.add('hidden');
    return;
  }

  searchOverlayStatus.textContent = 'Buscando...';
  searchOverlayStatus.classList.remove('hidden');

  const { data, error } = await supabase.functions.invoke('fetch-metadata', {
    body: { action: 'search', category: searchOverlayCategory, query },
  });

  if (error) {
    searchOverlayStatus.textContent = `Erro na busca: ${error.message}`;
    return;
  }

  const results = data?.results || [];
  searchOverlayResults.innerHTML = '';
  searchOverlayStatus.classList.toggle('hidden', results.length > 0);
  if (!results.length) searchOverlayStatus.textContent = 'Nada encontrado.';

  results.forEach((result) => {
    const row = document.createElement('div');
    row.className = 'search-result-row';
    const thumb = document.createElement('div');
    thumb.className = 'search-result-thumb';
    const image = result.mediaType === 'music' ? result.image : posterUrl(result.posterPath);
    if (image) thumb.style.backgroundImage = `url(${image})`;
    row.appendChild(thumb);
    const info = document.createElement('div');
    info.className = 'search-result-info';
    const subtitle = result.mediaType === 'music' ? result.artist : result.year;
    info.innerHTML = `<span class="search-result-title">${escapeHtml(result.title)}</span><span class="search-result-subtitle">${escapeHtml(subtitle || '')}</span>`;
    row.appendChild(info);
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'search-result-action';
    action.setAttribute('aria-label', 'Salvar');
    action.innerHTML = BOOKMARK_ICON_OUTLINE;
    action.addEventListener('click', async () => {
      action.disabled = true;
      const { error: saveError } = await saveExternalResult(result);
      if (saveError) {
        action.disabled = false;
        return;
      }
      action.innerHTML = BOOKMARK_ICON_FILLED;
    });
    row.appendChild(action);
    searchOverlayResults.appendChild(row);
  });
}

headerSearchBtn.addEventListener('click', openSearchOverlay);

document.querySelectorAll('.search-category-card').forEach((card) => {
  card.addEventListener('click', () => {
    if (card.disabled) return;
    setSearchCategory(card.dataset.category);
  });
});

searchCategoryClear.addEventListener('click', () => setSearchCategory(null));

searchOverlayInput.addEventListener('input', () => {
  clearTimeout(searchOverlayDebounce);
  searchOverlayDebounce = setTimeout(runSearchOverlayQuery, 350);
});

searchOverlayForm.addEventListener('submit', (e) => {
  e.preventDefault();
  clearTimeout(searchOverlayDebounce);
  runSearchOverlayQuery();
});

searchOverlay.addEventListener('click', (e) => {
  if (e.target === searchOverlay) closeSearchOverlay();
});

init();
