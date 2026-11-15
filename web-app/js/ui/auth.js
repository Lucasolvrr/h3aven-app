// Sign in / sign up / password recovery screens (email + password, Supabase Auth).

import { APP_NAME } from '../config.js';
import { h } from '../lib/dom.js';
import { createAsciiField } from './ascii.js';

let screen = null;

export function hideAuth() {
  screen?.remove();
  screen = null;
}

function mount(card) {
  hideAuth();
  const field = createAsciiField({ seed: 4 });
  screen = h('div', { class: 'auth' }, field, card);
  field.start();
  document.body.append(screen);
  card.querySelector('input')?.focus();
}

/** onPreview: when given, shows "Continue without an account". */
export function showAuth({ supabase, onPreview }) {
  let mode = 'signin';
  const title = h('h1', { class: 'auth-title' });
  const sub = h('p', { class: 'auth-sub' });
  const email = h('input', { class: 'input', type: 'email', placeholder: 'you@example.com', required: true, autocomplete: 'email', 'aria-label': 'Email' });
  const password = h('input', { class: 'input', type: 'password', placeholder: 'Password', required: true, minlength: '6', 'aria-label': 'Password' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' });
  const status = h('p', { class: 'auth-status', role: 'status' });
  const toggle = h('button', { type: 'button', class: 'link-btn' });
  const forgot = h('button', { type: 'button', class: 'link-btn' }, 'Forgot password?');

  const paint = () => {
    const signin = mode === 'signin';
    title.textContent = signin ? 'Welcome back' : 'Create your account';
    sub.textContent = signin ? 'Sign in to open your library on this device.' : 'One library for every browser and device.';
    submit.textContent = signin ? 'Sign in' : 'Create account';
    toggle.textContent = signin ? 'Create an account' : 'I already have an account';
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
      form,
      status,
      h('div', { class: 'auth-links' }, toggle, forgot),
      onPreview && h('button', { type: 'button', class: 'btn btn-ghost btn-block', onClick: onPreview }, 'Continue without an account')
    )
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
