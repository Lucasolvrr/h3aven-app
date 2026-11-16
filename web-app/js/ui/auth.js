// Sign in / sign up / password recovery screens (Google or email + password, Supabase Auth).

import { APP_NAME } from '../config.js';
import { h } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';
import { createAsciiField } from './ascii.js';
import { openModal } from './overlay.js';

let screen = null; // full-screen version (when there is no app to go back to)
let sheet = null; // modal version, over the app

// Google's "G", as its sign-in guidelines ask for on a Google button.
const GOOGLE_G =
  '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

export function hideAuth() {
  screen?.remove();
  screen = null;
  const open = sheet;
  sheet = null;
  open?.close();
}

/**
 * dismissible: the app stays usable without an account, so sign-in is a modal
 * over it (Escape, a click outside or the × close it). Otherwise — password
 * recovery, or a build without preview mode — it takes the whole screen.
 */
function mount(card, { dismissible = false } = {}) {
  hideAuth();
  if (dismissible) {
    card.prepend(h('button', { type: 'button', class: 'icon-btn auth-close', 'aria-label': 'Close', title: 'Close', onClick: hideAuth }, iconEl('x', 16)));
    sheet = openModal({ className: 'auth-modal', label: 'Sign in', content: card, onClose: () => (sheet = null) });
    return;
  }
  const field = createAsciiField({ seed: 4 });
  screen = h('div', { class: 'auth' }, field, card);
  field.start();
  document.body.append(screen);
  card.querySelector('input')?.focus();
}

/** onPreview: when given, the app can be used without an account, so this opens as a closable modal. */
export function showAuth({ supabase, onPreview }) {
  let mode = 'signin';
  const title = h('h1', { class: 'auth-title' });
  const sub = h('p', { class: 'auth-sub' });
  const email = h('input', { class: 'input', type: 'email', placeholder: 'you@example.com', required: true, autocomplete: 'email', spellcheck: 'false', 'aria-label': 'Email' });
  const password = h('input', { class: 'input', type: 'password', placeholder: 'Password', required: true, minlength: '6', 'aria-label': 'Password' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' });
  const status = h('p', { class: 'auth-status', role: 'status' });
  const toggle = h('button', { type: 'button', class: 'link-btn' });
  const forgot = h('button', { type: 'button', class: 'link-btn' }, 'Forgot Password?');

  const paint = () => {
    const signin = mode === 'signin';
    title.textContent = signin ? 'Welcome back' : 'Create your account';
    sub.textContent = signin ? 'Sign in to sync your library across devices.' : 'One library for every browser and device.';
    submit.textContent = signin ? 'Sign in' : 'Create account';
    toggle.textContent = signin ? 'Create an Account' : 'I Already Have an Account';
    password.setAttribute('autocomplete', signin ? 'current-password' : 'new-password');
    forgot.hidden = !signin;
    status.textContent = '';
  };
  toggle.addEventListener('click', () => {
    mode = mode === 'signin' ? 'signup' : 'signin';
    paint();
  });

  forgot.addEventListener('click', async () => {
    if (!email.value.trim()) {
      status.textContent = 'Type your email above first.';
      email.focus();
      return;
    }
    status.textContent = 'Sending…';
    const { error } = await supabase.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname });
    status.textContent = error ? error.message : 'Reset email sent. Check your inbox.';
  });

  // Google: Supabase sends the browser to Google and back to this page, where
  // the session in the URL is picked up on load (see main.js).
  const google = h('button', { type: 'button', class: 'btn btn-google btn-lg btn-block', html: GOOGLE_G }, h('span', null, 'Continue with Google'));
  google.addEventListener('click', async () => {
    google.disabled = true;
    status.textContent = 'Opening Google…';
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) {
      google.disabled = false;
      status.textContent = error.message;
    }
  });

  const form = h('form', { class: 'auth-form' }, email, password, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = mode === 'signin' ? 'Signing in…' : 'Creating your account…';
    const credentials = { email: email.value.trim(), password: password.value };
    const { data, error } = mode === 'signin' ? await supabase.auth.signInWithPassword(credentials) : await supabase.auth.signUp(credentials);
    submit.disabled = false;
    if (error) status.textContent = error.message;
    else if (mode === 'signup' && !data.session) status.textContent = 'Account created. Confirm it from the email we just sent, then sign in.';
    else status.textContent = '';
    // On success, main.js receives the auth event and swaps this screen for the app.
  });

  paint();
  mount(
    h(
      'div',
      { class: 'auth-card' },
      h('img', { class: 'sb-logo', src: 'icons/favicon-64.png', alt: APP_NAME }),
      title,
      sub,
      google,
      h('div', { class: 'auth-or' }, h('span', null, 'or with email')),
      form,
      status,
      h('div', { class: 'auth-links' }, toggle, forgot),
      !onPreview && h('p', { class: 'auth-note' }, 'Your bookmarks sync between this app and the extension.')
    ),
    { dismissible: Boolean(onPreview) }
  );
}

export function showRecovery({ supabase, onDone }) {
  const password = h('input', { class: 'input', type: 'password', placeholder: 'New password', required: true, minlength: '6', autocomplete: 'new-password', 'aria-label': 'New password' });
  const confirm = h('input', { class: 'input', type: 'password', placeholder: 'Confirm new password', required: true, minlength: '6', autocomplete: 'new-password', 'aria-label': 'Confirm new password' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, 'Save new password');
  const status = h('p', { class: 'auth-status', role: 'status' });
  const form = h('form', { class: 'auth-form' }, password, confirm, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (password.value !== confirm.value) {
      status.textContent = 'The passwords do not match.';
      return;
    }
    submit.disabled = true;
    status.textContent = 'Saving…';
    const { error } = await supabase.auth.updateUser({ password: password.value });
    submit.disabled = false;
    if (error) {
      status.textContent = error.message;
      return;
    }
    history.replaceState(null, '', location.pathname + location.search);
    onDone();
  });
  mount(
    h(
      'div',
      { class: 'auth-card' },
      h('img', { class: 'sb-logo', src: 'icons/favicon-64.png', alt: APP_NAME }),
      h('h1', { class: 'auth-title' }, 'Set a new password'),
      h('p', { class: 'auth-sub' }, 'Choose a new password for your account.'),
      form,
      status
    )
  );
}
