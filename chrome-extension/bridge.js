// Content script, injected only into the h3aven web app (see manifest.json).
//
// It lets the page (1) see that the extension is installed and whether it is
// connected, and (2) hand it a session of its own after the person clicks
// "Connect". Tokens only ever flow from the page to the extension; nothing
// stored here is sent back except the account email.
//
// Messages are window.postMessage on the page's own origin:
//   page -> extension  { source: 'h3aven-app', id, type: 'status' | 'connect' | 'disconnect', token?, email? }
//   extension -> page  { source: 'h3aven-extension', id?, type: 'hello' | 'status' | 'connected' | 'error', connected, email, version }

(() => {
  const VERSION = chrome.runtime.getManifest().version;

  const reply = (type, data = {}) => window.postMessage({ source: 'h3aven-extension', type, version: VERSION, ...data }, location.origin);

  async function status() {
    const { refresh_token: token, email } = await chrome.storage.local.get(['refresh_token', 'email']);
    return { connected: Boolean(token), email: email || null };
  }

  window.addEventListener('message', async (event) => {
    // Only the page itself, in this frame, on this origin.
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.source !== 'h3aven-app' || typeof message.type !== 'string') return;
    const id = typeof message.id === 'string' ? message.id : undefined;

    try {
      if (message.type === 'status') {
        reply('status', { id, ...(await status()) });
      } else if (message.type === 'connect') {
        const token = message.token;
        if (typeof token !== 'string' || token.length < 8 || token.length > 4096 || /\s/.test(token)) {
          reply('error', { id, message: 'That token does not look right.' });
          return;
        }
        await chrome.storage.local.set({ refresh_token: token, email: typeof message.email === 'string' ? message.email.slice(0, 320) : null });
        reply('connected', { id, ...(await status()) });
      } else if (message.type === 'disconnect') {
        await chrome.storage.local.remove(['refresh_token', 'email']);
        reply('status', { id, ...(await status()) });
      }
    } catch (error) {
      reply('error', { id, message: String(error?.message || error) });
    }
  });

  // Lets the page know straight away, without asking.
  document.documentElement.dataset.h3avenExtension = VERSION;
  status().then((info) => reply('hello', info));
})();
