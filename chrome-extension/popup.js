// Usa fetch puro contra a API REST do Supabase (sem bundlar supabase-js)

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

// Classificação mais rica usada para buscar metadados/renderizar cards no web app.
function detectContentType(url) {
  try {
    const host = new URL(url).hostname.replace('www.', '');
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('open.spotify.com')) return 'music';
    if ((host.includes('twitter.com') || host.includes('x.com')) && /\/status\//.test(url)) return 'tweet';
    if (host.includes('reddit.com')) return 'social';
    return 'link';
  } catch {
    return 'link';
  }
}

function parseJwt(token) {
  const payload = token.split('.')[1];
  return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error('Falha ao renovar sessão. Cole o token novamente nas opções.');
  const data = await res.json();
  // Supabase gira o refresh_token a cada uso — sempre salva o novo
  await chrome.storage.local.set({ refresh_token: data.refresh_token });
  return { accessToken: data.access_token, userId: parseJwt(data.access_token).sub };
}

const NEEDS_ENRICHMENT = new Set(['link', 'social', 'youtube', 'music', 'tweet']);

async function saveLink({ accessToken, userId, url, title, tagNames }) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  const source = detectSource(url);
  const contentType = detectContentType(url);
  const needsEnrichment = NEEDS_ENRICHMENT.has(contentType);

  const linkRes = await fetch(`${SUPABASE_URL}/rest/v1/links`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      url,
      title: title || null,
      source,
      content_type: contentType,
      fetch_status: needsEnrichment ? 'pending' : 'ready',
    }),
  });
  if (!linkRes.ok) throw new Error('Erro ao salvar o link.');
  const [linkRow] = await linkRes.json();

  for (const name of tagNames) {
    const tagRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tags?on_conflict=user_id,name`,
      {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ user_id: userId, name }),
      }
    );
    if (!tagRes.ok) continue;
    const [tagRow] = await tagRes.json();

    await fetch(`${SUPABASE_URL}/rest/v1/link_tags`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({ link_id: linkRow.id, tag_id: tagRow.id }),
    });
  }

  if (needsEnrichment) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/fetch-metadata`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'enrich', linkId: linkRow.id, url, contentType }),
      });
    } catch (err) {
      // Best-effort: a linha já foi salva, só o enriquecimento visual falhou.
      console.error(err);
    }
  }
}

async function main() {
  const notConfigured = document.getElementById('not-configured');
  const formView = document.getElementById('form-view');
  const statusEl = document.getElementById('status');

  const { refresh_token } = await chrome.storage.local.get('refresh_token');
  if (!refresh_token) {
    notConfigured.classList.remove('hidden');
    document.getElementById('open-options').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  formView.classList.remove('hidden');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  document.getElementById('title-input').value = tab.title || '';
  document.getElementById('url-input').value = tab.url || '';
  document.getElementById('tags-input').value = detectSource(tab.url || '');

  let session;
  try {
    session = await refreshAccessToken(refresh_token);
  } catch (err) {
    statusEl.textContent = err.message;
    return;
  }

  document.getElementById('save-btn').addEventListener('click', async () => {
    statusEl.textContent = 'Salvando...';
    const url = document.getElementById('url-input').value.trim();
    const title = document.getElementById('title-input').value.trim();
    const tagNames = document
      .getElementById('tags-input')
      .value.split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);

    try {
      await saveLink({ ...session, url, title, tagNames });
      statusEl.textContent = 'Salvo!';
      setTimeout(() => window.close(), 700);
    } catch (err) {
      statusEl.textContent = err.message;
    }
  });
}

main();
