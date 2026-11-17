// Popup: connect once (through the web app), then save the current tab.
// Plain fetch against Supabase's REST API, so nothing has to be bundled.

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

// The richer type the web app uses to fetch metadata and draw cards.
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

function parseJwt(token) {
  const payload = token.split('.')[1];
  return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
}

/** The connection is gone for good (revoked, expired, used twice): reconnecting is the only fix. */
class ExpiredError extends Error {}

async function refreshAccessToken(refreshToken) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    throw new Error('Could not reach h3aven. Check your connection.');
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new ExpiredError();
  if (!res.ok) throw new Error('h3aven is not answering right now. Try again in a moment.');
  const data = await res.json();
  // Supabase rotates the refresh token on every use: always keep the new one.
  await chrome.storage.local.set({ refresh_token: data.refresh_token });
  const claims = parseJwt(data.access_token);
  return { accessToken: data.access_token, userId: claims.sub, email: claims.email || data.user?.email || null };
}

const NEEDS_ENRICHMENT = new Set(['link', 'social', 'youtube', 'music', 'tweet', 'instagram']);

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
  if (!linkRes.ok) throw new Error('Could not save the link.');
  const [linkRow] = await linkRes.json();

  for (const name of tagNames) {
    const tagRes = await fetch(`${SUPABASE_URL}/rest/v1/tags?on_conflict=user_id,name`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ user_id: userId, name }),
    });
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
      // Best effort: the row is saved; only the preview image is missing.
      console.error(err);
    }
  }
}

// --- views ------------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

function showConnect(message) {
  $('form-view').classList.add('hidden');
  $('connect-view').classList.remove('hidden');
  const text = $('connect-text');
  text.textContent = message || 'Connect this extension to your h3aven account. It takes one click.';
  text.classList.toggle('is-error', Boolean(message));
  $('connect-btn').textContent = message ? 'Connect again' : 'Connect to h3aven';
  $('connect-btn').focus();
}

function setStatus(text, kind = '') {
  const status = $('status');
  status.textContent = text;
  status.className = `status${kind ? ` is-${kind}` : ''}`;
}

$('connect-btn').addEventListener('click', async () => {
  // The app signs the person in (if needed) and hands this extension a session of its own.
  await chrome.tabs.create({ url: `${APP_URL}#/connect` });
  window.close();
});

$('disconnect-btn').addEventListener('click', async () => {
  await chrome.storage.local.remove(['refresh_token', 'email']);
  showConnect();
});

async function main() {
  const { refresh_token: refreshToken, email } = await chrome.storage.local.get(['refresh_token', 'email']);
  if (!refreshToken) {
    showConnect();
    return;
  }

  $('connect-view').classList.add('hidden');
  $('form-view').classList.remove('hidden');
  $('account').textContent = email ? `Saving to ${email}` : 'Connected';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('title-input').value = tab?.title || '';
  $('url-input').value = tab?.url || '';
  $('save-btn').focus();

  let session = null;
  const ready = refreshAccessToken(refreshToken).then(
    (value) => {
      session = value;
      if (value.email && value.email !== email) {
        chrome.storage.local.set({ email: value.email });
        $('account').textContent = `Saving to ${value.email}`;
      }
    },
    async (error) => {
      if (error instanceof ExpiredError) {
        await chrome.storage.local.remove(['refresh_token', 'email']);
        showConnect('This connection has expired. Connect again to keep saving.');
      } else {
        setStatus(error.message, 'error');
      }
    }
  );

  $('save-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('save-btn');
    button.disabled = true;
    setStatus('Saving…');
    await ready;
    if (!session) {
      button.disabled = false;
      return;
    }
    const url = $('url-input').value.trim();
    const title = $('title-input').value.trim();
    const tagNames = $('tags-input')
      .value.split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean);
    try {
      await saveLink({ ...session, url, title, tagNames });
      setStatus('Saved to h3aven', 'ok');
      setTimeout(() => window.close(), 800);
    } catch (error) {
      setStatus(error.message, 'error');
      button.disabled = false;
    }
  });
}

main();
