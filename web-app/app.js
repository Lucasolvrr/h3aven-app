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

let currentSession = null;
let allLinks = [];

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

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  handleSession(session);

  supabase.auth.onAuthStateChange((_event, session) => {
    handleSession(session);
  });
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
    .select('id, url, title, description, source, created_at, link_tags(tags(id, name))')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  allLinks = data;
  populateTagFilter(data);
  renderLinks(data);
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

function renderLinks(links) {
  const query = searchInput.value.trim().toLowerCase();
  const tag = tagFilter.value;

  const filtered = links.filter((l) => {
    const matchesQuery =
      !query ||
      (l.title || '').toLowerCase().includes(query) ||
      l.url.toLowerCase().includes(query);
    const matchesTag = !tag || l.link_tags.some((lt) => lt.tags.name === tag);
    return matchesQuery && matchesTag;
  });

  linkList.innerHTML = '';
  emptyState.classList.toggle('hidden', filtered.length > 0);

  filtered.forEach((link) => {
    const li = document.createElement('li');

    const titleRow = document.createElement('div');
    titleRow.className = 'link-title-row';
    const a = document.createElement('a');
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'link-title';
    a.textContent = link.title || link.url;
    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.textContent = 'Remover';
    delBtn.addEventListener('click', () => deleteLink(link.id));
    titleRow.append(a, delBtn);

    const urlEl = document.createElement('div');
    urlEl.className = 'link-url';
    urlEl.textContent = link.url;

    const metaEl = document.createElement('div');
    metaEl.className = 'link-meta';
    const badge = document.createElement('span');
    badge.className = 'source-badge';
    badge.textContent = capitalize(link.source || detectSource(link.url));
    metaEl.appendChild(badge);
    link.link_tags.forEach((lt) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = `#${lt.tags.name}`;
      metaEl.appendChild(chip);
    });

    li.append(titleRow, urlEl, metaEl);
    linkList.appendChild(li);
  });
}

searchInput.addEventListener('input', () => renderLinks(allLinks));
tagFilter.addEventListener('change', () => renderLinks(allLinks));

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = document.getElementById('add-url').value.trim();
  const title = document.getElementById('add-title').value.trim();
  const tagsRaw = document.getElementById('add-tags').value.trim();
  const tagNames = tagsRaw
    ? tagsRaw.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean)
    : [];

  await saveLink({ url, title, tagNames });
  addForm.reset();
});

async function saveLink({ url, title, tagNames }) {
  const source = detectSource(url);
  const { data: linkRow, error: linkError } = await supabase
    .from('links')
    .insert({ url, title: title || null, source })
    .select()
    .single();

  if (linkError) {
    console.error(linkError);
    return;
  }

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

    await supabase.from('link_tags').insert({ link_id: linkRow.id, tag_id: tagRow.id });
  }

  loadLinks();
}

async function deleteLink(id) {
  await supabase.from('links').delete().eq('id', id);
  loadLinks();
}

init();
