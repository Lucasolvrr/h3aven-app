// Options: the same one-click connect as the popup, plus a manual token as a fallback.

const $ = (id) => document.getElementById(id);

async function paint() {
  const { refresh_token: token, email } = await chrome.storage.local.get(['refresh_token', 'email']);
  $('state').textContent = token
    ? `Connected${email ? ` to ${email}` : ''}. Pages you save from the toolbar go to this account.`
    : 'Open h3aven, sign in, and press Connect. That’s all.';
  $('connect-btn').textContent = token ? 'Connect another account' : 'Connect to h3aven';
  $('disconnect-btn').classList.toggle('hidden', !token);
}

$('connect-btn').addEventListener('click', () => chrome.tabs.create({ url: `${APP_URL}#/connect` }));

$('disconnect-btn').addEventListener('click', async () => {
  await chrome.storage.local.remove(['refresh_token', 'email']);
  $('status').textContent = 'Disconnected.';
  paint();
});

$('save-btn').addEventListener('click', async () => {
  const value = $('token-input').value.trim();
  if (!value || /\s/.test(value)) {
    $('status').textContent = 'Paste the token you copied from h3aven.';
    return;
  }
  await chrome.storage.local.set({ refresh_token: value, email: null });
  $('token-input').value = '';
  $('status').textContent = 'Connected. You can close this tab.';
  paint();
});

// Connecting from the web app updates storage while this page is open.
chrome.storage.onChanged.addListener(paint);
paint();
