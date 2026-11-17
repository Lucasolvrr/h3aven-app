// Sign in, sign up, password reset and "set a new password" (Google or email +
// password, Supabase Auth).
//
// One card, several states:
//   signin  -> email + password, links to "forgot" and "signup"
//   signup  -> email + password (with the rule shown up front)
//   forgot  -> email only, sends the reset link
//   sent    -> "check your email", with a resend button on a cooldown
// Successful sign-ins are picked up by main.js through the auth events.

import { APP_NAME } from '../config.js';
import { h } from '../lib/dom.js';
import { iconEl } from '../lib/icons.js';
import { createAsciiField } from './ascii.js';
import { openModal, toast } from './overlay.js';
import { passwordStrength } from './password-strength.js';

/** Minimum for new passwords (sign-up, reset, Settings). Old 6-character passwords still sign in. */
export const PASSWORD_MIN = 8;
/** Accounts made with Google alone have no password to check. */
export const hasPassword = (user) => Boolean(user?.identities?.some((identity) => identity.provider === 'email'));
const RESEND_COOLDOWN = 60; // seconds, roughly Supabase's own limit per address

let screen = null; // full-screen version (when there is no app to go back to)
let sheet = null; // modal version, over the app
let uid = 0;
const nextId = (name) => `auth-${name}-${++uid}`;

// Where links in auth emails and the Google round trip come back to.
const returnUrl = () => location.origin + location.pathname;

// Google's "G", as its sign-in guidelines ask for on a Google button.
const GOOGLE_G =
  '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

/** A Supabase auth error as a sentence someone can act on. */
export function authMessage(error) {
  if (!error) return '';
  const code = error.code || '';
  if (error.name === 'AuthRetryableFetchError' || error.status === 0 || /failed to fetch|network/i.test(error.message || '')) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  switch (code) {
    case 'invalid_credentials':
      return 'Wrong email or password. If you signed up with Google, use Continue with Google.';
    case 'email_not_confirmed':
      return 'Confirm your email first: open the link we sent you.';
    case 'user_already_exists':
    case 'email_exists':
      return 'There is already an account with this email. Sign in instead.';
    case 'weak_password':
      return `Choose a stronger password: at least ${PASSWORD_MIN} characters, and not a common one.`;
    case 'same_password':
      return 'The new password must be different from the current one.';
    case 'email_address_invalid':
      return 'That email address does not look right.';
    case 'over_email_send_rate_limit':
      return 'Too many emails sent to this address. Wait a few minutes and try again.';
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a minute and try again.';
    case 'signup_disabled':
      return 'New accounts are closed at the moment.';
    case 'otp_expired':
      return 'That link has expired or was already used.';
    case 'session_not_found':
    case 'refresh_token_not_found':
      return 'Your session ended. Sign in again.';
  }
  if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
  return error.message || 'Something went wrong. Try again.';
}

export function hideAuth() {
  screen?.remove();
  screen = null;
  const open = sheet;
  sheet = null;
  open?.close();
}

/**
 * dismissible: the app stays usable without an account, so sign-in is a modal
 * over it (Escape, a click outside or the × close it). Otherwise — setting a
 * new password, or a build without preview mode — it takes the whole screen.
 */
function mount(card, titleId, { dismissible = false } = {}) {
  hideAuth();
  if (dismissible) {
    card.prepend(h('button', { type: 'button', class: 'dialog-close auth-close', 'aria-label': 'Close', onClick: hideAuth }, iconEl('x', 16)));
    sheet = openModal({ className: 'auth-modal', label: 'Sign in', content: card, onClose: () => (sheet = null) });
    // Named by the visible title, so it follows the state (Sign in / Create account / …).
    sheet.panel.removeAttribute('aria-label');
    sheet.panel.setAttribute('aria-labelledby', titleId);
    return;
  }
  const field = createAsciiField({ seed: 4 });
  screen = h('div', { class: 'auth', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, field, card);
  field.start();
  document.body.append(screen);
  card.querySelector('input')?.focus();
}

/** A labelled field. hint: shown under it and read with it. */
function field(label, control, hint) {
  const input = control.matches('input') ? control : control.querySelector('input');
  const id = input.id || nextId('field');
  input.id = id;
  const hintEl = hint && h('p', { class: 'auth-hint', id: `${id}-hint` }, hint);
  if (hintEl) input.setAttribute('aria-describedby', hintEl.id);
  return h('div', { class: 'auth-field' }, h('label', { class: 'auth-label', for: id }, label), control, hintEl);
}

/** Password input with a show / hide button. */
function passwordInput({ autocomplete, minlength, placeholder = '' }) {
  const input = h('input', { class: 'input', type: 'password', required: true, autocomplete, minlength, placeholder, spellcheck: 'false' });
  const toggle = h('button', { type: 'button', class: 'icon-btn pw-toggle', 'aria-label': 'Show password', 'aria-pressed': 'false' }, iconEl('eye', 16));
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    toggle.replaceChildren(iconEl(show ? 'eye-off' : 'eye', 16));
    input.focus();
  });
  const wrap = h('div', { class: 'pw-wrap' }, input, toggle);
  wrap.input = input;
  return wrap;
}

/** The status line under a form: a message, optionally an error and a follow-up button. */
function statusLine() {
  const el = h('div', { class: 'auth-status', role: 'status', 'aria-live': 'polite' });
  el.set = (text, { error = false, action } = {}) => {
    el.classList.toggle('is-error', Boolean(error && text));
    el.replaceChildren(...(text ? [h('span', null, text)] : []), ...(action ? [h('button', { type: 'button', class: 'link-btn', onClick: action.run }, action.label)] : []));
  };
  return el;
}

/** Turns every control in `root` off while a request runs (the close button stays usable). */
function busy(root, on) {
  for (const el of root.querySelectorAll('input, button:not(.auth-close)')) el.disabled = on;
  root.setAttribute('aria-busy', String(on));
}

/**
 * onPreview: when given, the app can be used without an account, so this opens as a closable modal.
 * mode: 'signin' | 'signup' | 'forgot'. notice: a message to show on arrival (e.g. an expired link).
 */
export function showAuth({ supabase, onPreview, mode: startMode = 'signin', email: startEmail = '', notice = null }) {
  let mode = startMode;
  let sentKind = null; // 'signup' | 'reset', for the "check your email" state
  let cooldownTimer = null;

  const titleId = nextId('title');
  const title = h('h1', { class: 'auth-title', id: titleId, tabindex: '-1' });
  const sub = h('p', { class: 'auth-sub' });
  const body = h('div', { class: 'auth-body' });
  const email = h('input', { class: 'input', type: 'email', placeholder: 'you@example.com', required: true, autocomplete: 'email', spellcheck: 'false', autocapitalize: 'off', value: startEmail, autofocus: true });
  const passwordWrap = passwordInput({ autocomplete: 'current-password' });
  const password = passwordWrap.input;
  const status = statusLine();
  const card = h('div', { class: 'auth-card' });

  const emailValue = () => email.value.trim();

  const google = h('button', { type: 'button', class: 'btn btn-google btn-lg btn-block', html: GOOGLE_G }, h('span', null, 'Continue with Google'));
  // Supabase sends the browser to Google and back to this page, where main.js picks the session up.
  google.addEventListener('click', async () => {
    busy(card, true);
    status.set('Opening Google…');
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnUrl() } });
    if (error) {
      busy(card, false);
      status.set(authMessage(error), { error: true });
    }
  });

  let justSent = false; // the "sent" state starts with the resend cooldown only if an email really just went out
  const go = (next, message, { justSent: sent = true } = {}) => {
    mode = next;
    justSent = sent;
    clearInterval(cooldownTimer);
    render();
    if (message) status.set(message.text, message);
    // "Check your email" has nothing to type: focus the heading so it is read out.
    (mode === 'sent' ? title : card.querySelector('.auth-body input'))?.focus();
  };

  const resend = async () => {
    const { error } =
      sentKind === 'signup'
        ? await supabase.auth.resend({ type: 'signup', email: emailValue(), options: { emailRedirectTo: returnUrl() } })
        : await supabase.auth.resetPasswordForEmail(emailValue(), { redirectTo: returnUrl() });
    return error;
  };

  // A resend button that counts down before it can be used again.
  const resendButton = (label) => {
    const button = h('button', { type: 'button', class: 'btn btn-subtle btn-lg btn-block' }, label);
    const countdown = (seconds) => {
      clearInterval(cooldownTimer);
      let left = seconds;
      const tick = () => {
        button.disabled = left > 0;
        button.textContent = left > 0 ? `${label} in ${left}s` : label;
        if (left-- <= 0) clearInterval(cooldownTimer);
      };
      tick();
      cooldownTimer = setInterval(tick, 1000);
    };
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.set('Sending…');
      const error = await resend();
      if (error) {
        status.set(authMessage(error), { error: true });
        button.disabled = false;
        return;
      }
      status.set('Sent again. It can take a minute to arrive.');
      countdown(RESEND_COOLDOWN);
    });
    if (justSent) countdown(RESEND_COOLDOWN);
    return button;
  };

  const submitButton = (label) => h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, label);
  const linkButton = (label, run) => h('button', { type: 'button', class: 'link-btn', onClick: run }, label);

  async function onSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    status.set('');

    if (mode === 'signup' && password.value.length < PASSWORD_MIN) {
      status.set(`Use at least ${PASSWORD_MIN} characters for the password.`, { error: true });
      password.focus();
      return;
    }

    busy(card, true);
    status.set(mode === 'signin' ? 'Signing in…' : mode === 'signup' ? 'Creating your account…' : 'Sending the link…');
    const credentials = { email: emailValue(), password: password.value };

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword(credentials);
      busy(card, false);
      if (!error) return status.set(''); // main.js swaps this for the app
      if (error.code === 'email_not_confirmed') {
        sentKind = 'signup';
        return status.set(authMessage(error), { error: true, action: { label: 'Send it again', run: () => go('sent', null, { justSent: false }) } });
      }
      status.set(authMessage(error), { error: true });
      if (error.code === 'invalid_credentials') password.select();
      return;
    }

    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ ...credentials, options: { emailRedirectTo: returnUrl() } });
      busy(card, false);
      if (error) {
        if (error.code === 'user_already_exists' || error.code === 'email_exists') return go('signin', { text: authMessage(error) });
        return status.set(authMessage(error), { error: true });
      }
      // Supabase answers "ok" for an address that already has an account (so
      // nobody can probe which emails exist), but with no identities attached.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        password.value = '';
        return go('signin', { text: 'There is already an account with this email. Sign in, or reset the password if you forgot it.' });
      }
      if (!data.session) {
        sentKind = 'signup';
        password.value = '';
        return go('sent');
      }
      return status.set(''); // signed straight in (email confirmation off)
    }

    // forgot
    const { error } = await supabase.auth.resetPasswordForEmail(emailValue(), { redirectTo: returnUrl() });
    busy(card, false);
    if (error) return status.set(authMessage(error), { error: true });
    sentKind = 'reset';
    go('sent');
  }

  function render() {
    status.set('');
    const signin = mode === 'signin';
    const signup = mode === 'signup';
    password.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
    if (signup) password.setAttribute('minlength', String(PASSWORD_MIN));
    else password.removeAttribute('minlength');

    if (mode === 'sent') {
      title.textContent = 'Check your email';
      sub.replaceChildren(
        sentKind === 'signup' ? 'We sent a confirmation link to ' : 'We sent a password reset link to ',
        h('strong', null, emailValue()),
        sentKind === 'signup' ? '. Open it to finish creating your account.' : '. Open it to choose a new password.'
      );
      body.replaceChildren(
        h('div', { class: 'auth-sent-icon', 'aria-hidden': 'true' }, iconEl('mail', 22)),
        h('p', { class: 'auth-hint auth-sent-tip' }, 'Can’t find it? Look in Spam or Promotions. The link works once and expires after an hour.'),
        resendButton(sentKind === 'signup' ? 'Resend confirmation' : 'Resend reset link'),
        status,
        h('div', { class: 'auth-links' }, linkButton('Use a different email', () => go(sentKind === 'signup' ? 'signup' : 'forgot')), linkButton('Back to sign in', () => go('signin')))
      );
      return;
    }

    title.textContent = signin ? 'Welcome back' : signup ? 'Create your account' : 'Reset your password';
    sub.textContent = signin
      ? 'Sign in to sync your library across devices.'
      : signup
        ? 'One library for every browser and device.'
        : 'Enter the email you signed up with and we’ll send you a link to choose a new password.';

    const form = h(
      'form',
      { class: 'auth-form' },
      field('Email', email),
      mode !== 'forgot' &&
        field(
          'Password',
          passwordWrap,
          signup ? `At least ${PASSWORD_MIN} characters.` : null
        ),
      submitButton(signin ? 'Sign in' : signup ? 'Create account' : 'Send reset link')
    );
    form.addEventListener('submit', onSubmit);

    // Native replaceChildren/append print `false` as text: drop the empty slots first.
    body.replaceChildren(
      ...[
        mode !== 'forgot' && google,
        mode !== 'forgot' && h('div', { class: 'auth-or' }, h('span', null, 'or with email')),
        form,
        status,
      h(
        'div',
        { class: 'auth-links' },
        signin && linkButton('Forgot password?', () => go('forgot')),
        signin && linkButton('Create an account', () => go('signup')),
        signup && linkButton('I already have an account', () => go('signin')),
        mode === 'forgot' && linkButton('Back to sign in', () => go('signin'))
      ),
      ].filter(Boolean)
    );
  }

  card.append(
    ...[
      h('img', { class: 'sb-logo', src: 'icons/favicon-64.png', alt: APP_NAME }),
      title,
      sub,
      body,
      !onPreview && h('p', { class: 'auth-note' }, 'Your bookmarks sync between this app and the extension.'),
    ].filter(Boolean)
  );
  render();
  if (notice) status.set(notice.text, notice);
  mount(card, titleId, { dismissible: Boolean(onPreview) });
}

/** After a reset link: choose the new password. onDone() enters the app. */
export function showRecovery({ supabase, onDone }) {
  const titleId = nextId('title');
  // The new password shows its strength as it is typed; "Suggest one" fills both fields.
  const strength = passwordStrength({ label: 'New password', minLength: PASSWORD_MIN });
  const confirmWrap = passwordInput({ autocomplete: 'new-password', minlength: String(PASSWORD_MIN) });
  const password = strength.input;
  const confirm = confirmWrap.input;
  const status = statusLine();
  const suggest = h('button', { type: 'button', class: 'btn btn-subtle btn-lg' }, 'Suggest one');
  suggest.addEventListener('click', () => {
    confirm.value = strength.suggest();
    password.focus();
  });
  const form = h(
    'form',
    { class: 'auth-form' },
    strength.el,
    field('Confirm new password', confirmWrap),
    h('div', { class: 'auth-recovery-actions' }, suggest, h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, 'Save new password'))
  );
  const card = h(
    'div',
    { class: 'auth-card' },
    h('img', { class: 'sb-logo', src: 'icons/favicon-64.png', alt: APP_NAME }),
    h('h1', { class: 'auth-title', id: titleId }, 'Set a new password'),
    h('p', { class: 'auth-sub' }, 'Choose a new password for your account. Other devices will be signed out.'),
    form,
    status,
    h('div', { class: 'auth-links' }, h('button', { type: 'button', class: 'link-btn', onClick: () => onDone() }, 'Not now'))
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (password.value.length < PASSWORD_MIN) {
      status.set(`Use at least ${PASSWORD_MIN} characters.`, { error: true });
      return password.focus();
    }
    if (password.value !== confirm.value) {
      status.set('The two passwords do not match.', { error: true });
      return confirm.focus();
    }
    busy(card, true);
    status.set('Saving…');
    const { error } = await supabase.auth.updateUser({ password: password.value });
    if (error) {
      busy(card, false);
      return status.set(authMessage(error), { error: true });
    }
    // Whoever had the old password is signed out everywhere else.
    await supabase.auth.signOut({ scope: 'others' }).catch(() => {});
    onDone();
    toast('Password updated. You’re signed in.');
  });

  mount(card, titleId);
}
