// Talks to the h3aven browser extension through its content script
// (chrome-extension/bridge.js), which runs on this page when it is installed.
//
//   extension.status()             -> { connected, email, version } or null (not installed)
//   extension.connect(token, email) -> hands the extension a session of its own
//   extension.disconnect()
//
// Only window.postMessage on this page's own origin is used; tokens only
// flow from here to the extension, never back.

const APP = 'h3aven-app';
const EXT = 'h3aven-extension';

let seq = 0;
const pending = new Map(); // id -> { resolve, reject, timer }
let lastHello = null;

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const message = event.data;
  if (!message || message.source !== EXT) return;
  if (message.type === 'hello') lastHello = message;
  const waiter = message.id && pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  clearTimeout(waiter.timer);
  if (message.type === 'error') waiter.reject(new Error(message.message || 'The extension could not do that.'));
  else waiter.resolve(message);
});

function request(type, data = {}, timeout = 1500) {
  const id = `h3-${Date.now().toString(36)}-${++seq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('timeout'));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    window.postMessage({ source: APP, id, type, ...data }, location.origin);
  });
}

const pick = (message) => ({ connected: Boolean(message.connected), email: message.email || null, version: message.version || null });

export const extension = {
  /** Set by the content script as soon as the page starts: no round trip needed. */
  get installed() {
    return Boolean(document.documentElement.dataset.h3avenExtension) || Boolean(lastHello);
  },
  /** { connected, email, version }, or null when the extension is not installed (or too old to answer). */
  async status() {
    try {
      return pick(await request('status'));
    } catch {
      return null;
    }
  },
  async connect(token, email) {
    try {
      return pick(await request('connect', { token, email }, 4000));
    } catch (error) {
      throw new Error(error.message === 'timeout' ? 'The extension did not answer. Reload this page and try again.' : error.message);
    }
  },
  async disconnect() {
    return pick(await request('disconnect'));
  },
};
