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
const tagFilter = document.getElementById('tag-filter');
const addForm = document.getElementById('add-form');
const linkList = document.getElementById('link-list');
const emptyState = document.getElementById('empty-state');
const syncTokenEl = document.getElementById('sync-token');
const revealBtn = document.getElementById('reveal-token-btn');
const copyBtn = document.getElementById('copy-token-btn');

const sidebar = document.getElementById('sidebar');
const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
const homePills = document.getElementById('home-pills');

const typePicker = document.getElementById('type-picker');
const mediaSearch = document.getElementById('media-search');
const mediaSearchInput = document.getElementById('media-search-input');
const mediaTagsInput = document.getElementById('media-tags');
const mediaSearchBtn = document.getElementById('media-search-btn');
const mediaResults = document.getElementById('media-results');
const mediaStatus = document.getElementById('media-status');

const quickviewOverlay = document.getElementById('quickview-overlay');
const quickviewClose = document.getElementById('quickview-close');
const quickviewImg = document.getElementById('quickview-img');
const quickviewOpenLink = document.getElementById('quickview-open-link');
const quickviewTitle = document.getElementById('quickview-title');
const quickviewDomain = document.getElementById('quickview-domain');
const quickviewTime = document.getElementById('quickview-time');
const quickviewSubtitleRow = document.getElementById('quickview-subtitle-row');
const quickviewDescription = document.getElementById('quickview-description');
const quickviewTags = document.getElementById('quickview-tags');
const quickviewAddTagForm = document.getElementById('quickview-add-tag-form');
const quickviewTagInput = document.getElementById('quickview-tag-input');
const quickviewNotes = document.getElementById('quickview-notes');
const quickviewCopyBtn = document.getElementById('quickview-copy-btn');
const quickviewDeleteBtn = document.getElementById('quickview-delete-btn');

let currentSession = null;
let allLinks = [];
let selectedType = 'link';
let typeManuallyPicked = false;
let homeFilter = '';

const VIEWS = {
  home: { filter: null, layout: 'masonry' },
  filmes: { filter: (l) => l.content_type === 'movie' || l.content_type === 'tv', layout: 'grid' },
  musica: { filter: (l) => l.content_type === 'music', layout: 'grid' },
};
const ROUTES = { '': 'home', filmes: 'filmes', musica: 'musica' };
let currentView = 'home';
let currentQuickviewLink = null;

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
  initSidebarCollapse();

  const { data: { session } } = await supabase.auth.getSession();
  handleSession(session);

  supabase.auth.onAuthStateChange((_event, session) => {
    handleSession(session);
  });

  window.addEventListener('hashchange', renderRoute);
}

function initSidebarCollapse() {
  if (localStorage.getItem('h3aven-sidebar-collapsed') === 'true') {
    sidebar.classList.add('collapsed');
  }
  sidebarCollapseBtn.addEventListener('click', () => {
    const collapsed = sidebar.classList.toggle('collapsed');
    localStorage.setItem('h3aven-sidebar-collapsed', String(collapsed));
  });
}

function renderRoute() {
  if (!currentSession) return;
  const hash = location.hash.replace(/^#\/?/, '');
  currentView = ROUTES[hash] ?? 'home';

  document.querySelectorAll('.sidebar-link').forEach((a) => {
    a.classList.toggle('active', a.dataset.view === currentView);
  });
  homePills.classList.toggle('hidden', currentView !== 'home');
  linkList.className = `library-grid layout-${VIEWS[currentView].layout}`;

  renderLinks(allLinks);
}

function handleSession(session) {
  currentSession = session;
  if (session) {
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    userEmailEl.textContent = session.user.email;
    syncTokenEl.textContent = '••••••••••••••••';
    syncTokenEl.dataset.revealed = 'false';
    syncTokenEl.dataset.value = session.refresh_token;
    loadLinks();
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

revealBtn.addEventListener('click', () => {
  const revealed = syncTokenEl.dataset.revealed === 'true';
  syncTokenEl.textContent = revealed ? '••••••••••••••••' : syncTokenEl.dataset.value;
  syncTokenEl.dataset.revealed = String(!revealed);
  revealBtn.textContent = revealed ? 'Mostrar' : 'Ocultar';
});

copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(syncTokenEl.dataset.value);
  copyBtn.textContent = 'Copiado!';
  setTimeout(() => (copyBtn.textContent = 'Copiar'), 1500);
});

async function loadLinks() {
  const { data, error } = await supabase
    .from('links')
    .select('id, url, title, description, source, content_type, metadata, fetch_status, notes, created_at, link_tags(tags(id, name))')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  allLinks = data;
  populateTagFilter(data);
  renderRoute();
}

function populateTagFilter(links) {
  const tagNames = new Set();
  links.forEach((l) => l.link_tags.forEach((lt) => tagNames.add(lt.tags.name)));
  const current = tagFilter.value;
  tagFilter.innerHTML = '<option value="">Todas as tags</option>';
  [...tagNames].sort().forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `#${name}`;
    tagFilter.appendChild(opt);
  });
  tagFilter.value = current;
}

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
  const tag = tagFilter.value;
  const viewFilter = VIEWS[currentView].filter;

  const filtered = links.filter((l) => {
    const matchesTag = !tag || l.link_tags.some((lt) => lt.tags.name === tag);
    const matchesView = !viewFilter || viewFilter(l);
    const matchesHomePill = currentView !== 'home' || !homeFilter || l.content_type === homeFilter;
    return matchesQuery(l, query) && matchesTag && matchesView && matchesHomePill;
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
  return null;
}

function cardDescriptionFor(link) {
  const meta = link.metadata || {};
  return meta.overview || meta.description || null;
}

function buildCard(link) {
  const li = document.createElement('li');
  li.className = `card card--${link.content_type || 'link'}`;
  if (link.fetch_status === 'pending') li.classList.add('is-pending');
  if (link.fetch_status === 'failed') li.classList.add('is-failed');
  li.setAttribute('role', 'button');
  li.tabIndex = 0;

  const image = cardImageFor(link);
  if (image) {
    const media = document.createElement('div');
    media.className = 'card-media';
    const img = document.createElement('img');
    img.src = image;
    img.loading = 'lazy';
    img.alt = '';
    media.appendChild(img);
    li.appendChild(media);
  } else if (link.fetch_status === 'pending') {
    const media = document.createElement('div');
    media.className = 'card-media';
    li.appendChild(media);
  }

  const body = document.createElement('div');
  body.className = 'card-body';

  const title = document.createElement('span');
  title.className = 'card-title';
  title.textContent = cardTitleFor(link);
  body.appendChild(title);

  li.appendChild(body);

  li.addEventListener('click', () => openQuickview(link));
  li.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openQuickview(link);
    }
  });

  return li;
}

// --- Quickview modal ---

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

function openQuickview(link) {
  currentQuickviewLink = link;

  const image = cardImageFor(link);
  quickviewImg.classList.toggle('hidden', !image);
  quickviewImg.src = image || '';

  quickviewTitle.textContent = cardTitleFor(link);
  quickviewDomain.textContent = domainFor(link.url);
  quickviewTime.textContent = timeAgo(link.created_at);
  quickviewOpenLink.href = link.url;

  const subtitle = cardSubtitleFor(link);
  quickviewSubtitleRow.textContent = subtitle || '';
  quickviewSubtitleRow.classList.toggle('hidden', !subtitle);

  const description = cardDescriptionFor(link);
  quickviewDescription.textContent = description || 'Sem resumo disponível.';

  renderQuickviewTags(link);

  quickviewNotes.value = link.notes || '';

  quickviewOverlay.classList.remove('hidden');
}

function closeQuickview() {
  quickviewOverlay.classList.add('hidden');
  currentQuickviewLink = null;
}

function renderQuickviewTags(link) {
  quickviewTags.innerHTML = '';
  link.link_tags.forEach((lt) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    const label = document.createElement('span');
    label.textContent = `#${lt.tags.name}`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => removeQuickviewTag(link, lt.tags.id));
    chip.append(label, removeBtn);
    quickviewTags.appendChild(chip);
  });
}

async function removeQuickviewTag(link, tagId) {
  await supabase.from('link_tags').delete().eq('link_id', link.id).eq('tag_id', tagId);
  link.link_tags = link.link_tags.filter((lt) => lt.tags.id !== tagId);
  renderQuickviewTags(link);
  loadLinks();
}

quickviewAddTagForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = quickviewTagInput.value.trim().replace(/^#/, '');
  if (!name || !currentQuickviewLink) return;
  await attachTags(currentQuickviewLink.id, [name]);
  quickviewTagInput.value = '';

  const { data: tagRow } = await supabase
    .from('tags')
    .select('id, name')
    .eq('user_id', currentSession.user.id)
    .eq('name', name)
    .single();
  if (tagRow && !currentQuickviewLink.link_tags.some((lt) => lt.tags.id === tagRow.id)) {
    currentQuickviewLink.link_tags.push({ tags: tagRow });
  }
  renderQuickviewTags(currentQuickviewLink);
  loadLinks();
});

quickviewNotes.addEventListener('blur', async () => {
  if (!currentQuickviewLink) return;
  const notes = quickviewNotes.value.trim();
  await supabase.from('links').update({ notes: notes || null }).eq('id', currentQuickviewLink.id);
  currentQuickviewLink.notes = notes;
});

quickviewCopyBtn.addEventListener('click', async () => {
  if (!currentQuickviewLink) return;
  await navigator.clipboard.writeText(currentQuickviewLink.url);
  quickviewCopyBtn.textContent = 'Copiado!';
  setTimeout(() => (quickviewCopyBtn.textContent = 'Copiar link'), 1500);
});

quickviewDeleteBtn.addEventListener('click', async () => {
  if (!currentQuickviewLink) return;
  await deleteLink(currentQuickviewLink.id);
  closeQuickview();
});

quickviewClose.addEventListener('click', closeQuickview);
quickviewOverlay.addEventListener('click', (e) => {
  if (e.target === quickviewOverlay) closeQuickview();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !quickviewOverlay.classList.contains('hidden')) closeQuickview();
});

searchInput.addEventListener('input', () => renderLinks(allLinks));
tagFilter.addEventListener('change', () => renderLinks(allLinks));

homePills.addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-pill');
  if (!btn) return;
  homeFilter = btn.dataset.filter;
  [...homePills.querySelectorAll('.filter-pill')].forEach((b) => {
    b.classList.toggle('active', b === btn);
  });
  renderLinks(allLinks);
});

// --- Seletor de tipo ---

typePicker.addEventListener('click', (e) => {
  const btn = e.target.closest('.type-pill');
  if (!btn) return;
  typeManuallyPicked = true;
  setSelectedType(btn.dataset.type);
});

function setSelectedType(type) {
  selectedType = type;
  [...typePicker.querySelectorAll('.type-pill')].forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
  const isMedia = type === 'movie' || type === 'tv';
  addForm.classList.toggle('hidden', isMedia);
  mediaSearch.classList.toggle('hidden', !isMedia);
}

document.getElementById('add-url').addEventListener('input', (e) => {
  if (typeManuallyPicked) return;
  const detected = detectContentType(e.target.value.trim());
  setSelectedType(detected);
});

// --- Salvar item comum (link/youtube/tweet/music/social) ---

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = document.getElementById('add-url').value.trim();
  const title = document.getElementById('add-title').value.trim();
  const tagsRaw = document.getElementById('add-tags').value.trim();
  const tagNames = tagsRaw
    ? tagsRaw.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean)
    : [];

  await saveLink({ url, title, tagNames, contentType: selectedType });
  addForm.reset();
  typeManuallyPicked = false;
  setSelectedType('link');
});

async function saveLink({ url, title, tagNames, contentType }) {
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
    return;
  }

  await attachTags(linkRow.id, tagNames);
  loadLinks();

  if (needsEnrichment) {
    await enrichLink(linkRow.id, url, contentType);
    loadLinks();
  }
}

async function attachTags(linkId, tagNames) {
  for (const name of tagNames) {
    const { data: tagRow, error: tagError } = await supabase
      .from('tags')
      .upsert({ user_id: currentSession.user.id, name }, { onConflict: 'user_id,name' })
      .select()
      .single();

    if (tagError) {
      console.error(tagError);
      continue;
    }

    await supabase.from('link_tags').insert({ link_id: linkId, tag_id: tagRow.id });
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

// --- Busca de filmes/séries (TMDB via Edge Function) ---

mediaSearchBtn.addEventListener('click', () => runMediaSearch());
mediaSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runMediaSearch();
  }
});

async function runMediaSearch() {
  const query = mediaSearchInput.value.trim();
  if (!query) return;

  mediaStatus.textContent = 'Buscando...';
  mediaResults.innerHTML = '';

  const { data, error } = await supabase.functions.invoke('fetch-metadata', {
    body: { action: 'search', query, mediaType: selectedType },
  });

  if (error) {
    mediaStatus.textContent = `Erro na busca: ${error.message}`;
    return;
  }

  const results = data?.results || [];
  mediaStatus.textContent = results.length ? '' : 'Nada encontrado.';
  results.forEach((r) => mediaResults.appendChild(buildMediaResult(r)));
}

function buildMediaResult(result) {
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

  btn.addEventListener('click', () => saveMediaResult(result));
  return btn;
}

async function saveMediaResult(result) {
  const tagsRaw = mediaTagsInput.value.trim();
  const tagNames = tagsRaw
    ? tagsRaw.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean)
    : [];

  const mediaType = result.mediaType === 'tv' ? 'tv' : 'movie';
  const url = `https://www.themoviedb.org/${mediaType}/${result.id}`;

  const { data: linkRow, error } = await supabase
    .from('links')
    .insert({
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
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return;
  }

  await attachTags(linkRow.id, tagNames);
  mediaSearchInput.value = '';
  mediaTagsInput.value = '';
  mediaResults.innerHTML = '';
  mediaStatus.textContent = 'Salvo!';
  loadLinks();
}

init();
