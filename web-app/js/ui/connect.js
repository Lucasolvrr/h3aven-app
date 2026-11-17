// Connect the browser extension: a modal in the sign-in's style (logo, serif
// title, one wide action). Opened from #/connect (where the extension's own
// "Connect" button lands), from Settings and from the getting-started list.
// Signed in, one click hands the extension a session of its own
// (services/extension.js); nothing to copy.

import { APP_NAME } from '../config.js';
import { h } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';
import { state } from '../data/store.js';
import { extension } from '../services/extension.js';
import { openModal } from './overlay.js';

let open = null; // { close, owner } while the modal is up

/** ctx: { getSyncToken, signIn }. onClose runs when the modal goes away. */
export function openConnectDialog(ctx, { onClose } = {}) {
  if (open) return open;
  const owner = state.user?.id || 'local';
  const flow = { phase: 'checking', status: null, error: '' };
  let keepRoute = false; // closing to sign in: #/connect stays, so the dialog comes back afterwards
  const titleId = 'connect-title';
  const body = h('div', { class: 'connect-body' });
  const card = h('div', { class: 'auth-card connect-card' });

  const button = (label, run, kind = 'btn-primary', icon) =>
    h('button', { type: 'button', class: `btn ${kind} btn-lg btn-block`, onClick: run }, icon && iconEl(icon, 16), label);
  const linkButton = (label, run) => h('button', { type: 'button', class: 'link-btn', onClick: run }, label);

  async function check() {
    flow.phase = 'checking';
    paint();
    flow.status = await extension.status();
    flow.phase = flow.status ? 'ready' : 'missing';
    paint();
  }

  async function connect() {
    flow.phase = 'connecting';
    flow.error = '';
    paint();
    try {
      const token = await ctx.getSyncToken();
      flow.status = await extension.connect(token, state.user?.email || '');
      flow.phase = 'done';
    } catch (error) {
      flow.error = error.message;
      flow.phase = 'ready';
    }
    paint();
  }

  function paint() {
    const cloud = state.mode === 'cloud';
    const email = state.user?.email || '';
    const { phase, status, error } = flow;
    let title;
    let sub;
    let parts = [];
    if (phase === 'checking') {
      title = 'Connect the extension';
      sub = 'Looking for the h3aven extension in this browser…';
    } else if (phase === 'missing') {
      title = 'Add the extension';
      sub = 'This browser doesn’t have the h3aven extension yet. Load it once:';
      parts = [
        h(
          'ol',
          { class: 'connect-steps' },
          h('li', null, 'Open ', h('code', null, 'chrome://extensions'), ' and turn on Developer mode.'),
          h('li', null, 'Click Load unpacked and choose the ', h('code', null, 'chrome-extension'), ' folder of h3aven.'),
          h('li', null, 'Come back here and press the button below.')
        ),
        // A freshly installed extension only reaches pages loaded after it: reload into this dialog.
        button('I’ve added it', () => {
          location.hash = '#/connect';
          location.reload();
        }),
      ];
    } else if (!cloud) {
      title = 'Sign in to connect';
      sub = 'The extension saves into your account. Sign in, and it connects with one click.';
      parts = [
        button(
          'Sign in',
          () => {
            keepRoute = true;
            close();
            ctx.signIn();
          },
          'btn-primary',
          'log-in'
        ),
      ];
    } else if (phase === 'done') {
      title = 'Extension connected';
      sub = 'Click the h3aven icon in your toolbar to save the page you’re on.';
      parts = [h('div', { class: 'connect-done', 'aria-hidden': 'true' }, iconEl('check', 22)), button('Done', () => close())];
    } else {
      const same = status?.connected && status.email && status.email === email;
      title = same ? 'Already connected' : 'Connect the extension';
      sub = same ? 'Pages you save from the toolbar already go to your library.' : 'Save the page you’re on, from any tab, straight into your library.';
      parts = [
        h('p', { class: 'connect-account' }, iconEl('user', 14), h('span', null, email)),
        status?.connected && !same && status.email && h('p', { class: 'connect-note' }, `It’s connected to ${status.email} now; this replaces it.`),
        error && h('p', { class: 'connect-error', role: 'alert' }, error),
        same
          ? button('Done', () => close())
          : button(phase === 'connecting' ? 'Connecting…' : 'Connect', connect, 'btn-primary', phase === 'connecting' ? null : 'link'),
        same && h('div', { class: 'auth-links' }, linkButton('Connect again', connect)),
      ];
    }
    body.replaceChildren(
      ...[
        h('img', { class: 'sb-logo', src: 'icons/favicon-64.png', alt: APP_NAME }),
        h('h1', { class: 'auth-title', id: titleId }, title),
        h('p', { class: 'auth-sub' }, sub),
        ...parts,
      ].filter(Boolean)
    );
    body.setAttribute('aria-busy', String(phase === 'checking' || phase === 'connecting'));
    if (phase === 'connecting') body.querySelectorAll('.btn').forEach((b) => b.setAttribute('aria-busy', 'true'));
  }

  card.append(h('button', { type: 'button', class: 'dialog-close auth-close', 'aria-label': 'Close', onClick: () => close() }, iconEl('x', 16)), body);
  paint();
  const modal = openModal({
    className: 'auth-modal',
    label: 'Connect the extension',
    content: card,
    onClose: () => {
      open = null;
      if (!keepRoute) onClose?.();
    },
  });
  modal.panel.removeAttribute('aria-label');
  modal.panel.setAttribute('aria-labelledby', titleId);
  const close = () => modal.close();
  open = { close, owner };
  check();
  return open;
}

/** Which account the open dialog was opened for (it reopens after a sign-in). */
export const connectDialogOwner = () => open?.owner ?? null;
