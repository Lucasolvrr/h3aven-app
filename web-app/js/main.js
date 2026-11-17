// Boot: decide between the signed-in library (Supabase) and preview mode
// (this browser only), then hand over to the shell.

import { ALLOW_PREVIEW_MODE } from './config.js';
import { getSupabase } from './data/supabase.js';
import { createCloudDriver } from './data/cloud-driver.js';
import { createLocalDriver, clearLocalLibrary } from './data/local-driver.js';
import { start, reload, state, setUser } from './data/store.js';
import { mountShell } from './ui/shell.js';
import { showAuth, showRecovery, hideAuth, authMessage, hasPassword } from './ui/auth.js';
import { toast, confirmDialog } from './ui/overlay.js';

let supabase = null;
let activeUserId = null;
let signingOut = false; // true while the person signs out on purpose

function enterPreview() {
  activeUserId = null;
  hideAuth();
  return start({ driver: createLocalDriver() });
}

function enterCloud(session) {
  if (activeUserId === session.user.id) return null; // token refresh, same person
  activeUserId = session.user.id;
  hideAuth();
  return start({ driver: createCloudDriver(supabase), user: session.user, supabase });
}

/** options: { mode, email, notice } — see showAuth. */
function signIn(options = {}) {
  if (!supabase) {
    toast('Could not reach the sign-in service. Check your connection and reload.', { type: 'error' });
    return;
  }
  showAuth({ supabase, onPreview: ALLOW_PREVIEW_MODE ? hideAuth : null, ...(options instanceof Event ? {} : options) });
}

// --- links from auth emails (confirm sign-up, reset password, change email) and Google ---

/**
 * What the link that opened this page says. Read before the Supabase client
 * takes the tokens out of the URL. null when the page was opened normally.
 */
function readAuthRedirect() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const error = hash.get('error_code') || hash.get('error') || query.get('error_code') || query.get('error');
  if (!error && !hash.get('access_token')) return null;
  return {
    type: hash.get('type'), // signup | recovery | email_change | magiclink | invite | null (Google)
    error,
    description: (hash.get('error_description') || query.get('error_description') || '').replace(/\+/g, ' '),
  };
}

/** Leaves a clean address behind (the tokens or the error are no use in the URL bar or history). */
function clearAuthRedirect() {
  history.replaceState(null, '', location.pathname + '#/');
}

/** The link didn't work: say so, and offer the way to get a new one. */
function reportBrokenLink(redirect, signedIn) {
  const expired = !redirect.error || redirect.error === 'otp_expired' || /expired|invalid/i.test(redirect.description);
  const text = expired
    ? 'That email link has expired or was already used.'
    : authMessage({ code: redirect.error, message: redirect.description || 'That link did not work.' });
  if (signedIn) {
    toast(text, { type: 'error' });
    return;
  }
  const recovery = redirect.type === 'recovery';
  signIn({
    mode: recovery ? 'forgot' : 'signin',
    notice: { text: recovery ? `${text} Ask for a new one below.` : `${text} Sign in, or use “Forgot password?” to get a new reset link.`, error: true },
  });
}

/** Signed out without asking (session revoked or expired): say so rather than quietly switching to preview. */
function sessionEnded() {
  const wasSignedIn = Boolean(activeUserId);
  signedOut();
  if (wasSignedIn) signIn({ notice: { text: 'Your session ended. Sign in again to keep syncing.', error: true } });
}

const ARRIVAL_TOAST = {
  signup: 'Email confirmed. Welcome to h3aven.',
  email_change: 'Email address updated.',
};

function signedOut() {
  if (ALLOW_PREVIEW_MODE) enterPreview();
  else signIn();
}

const app = {
  signIn,
  reload,
  signOut: async () => {
    signingOut = true;
    await supabase?.auth.signOut();
  },
  /** The name shown in the sidebar and greeting (Google fills it in; email accounts can set it). */
  updateName: async (name) => {
    const clean = name.trim().slice(0, 80);
    const { data, error } = await supabase.auth.updateUser({ data: { full_name: clean, name: clean } });
    if (error) throw new Error(authMessage(error));
    setUser(data.user);
  },
  updateEmail: async (email) => {
    const { error } = await supabase.auth.updateUser({ email: email.trim() }, { emailRedirectTo: location.origin + location.pathname });
    if (error) throw new Error(authMessage(error));
  },
  /** current: required when the account already has a password (not for Google-only accounts). */
  updatePassword: async ({ current, password }) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Your session ended. Sign in again.');
    if (hasPassword(user)) {
      const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: current || '' });
      if (error) throw new Error(error.code === 'invalid_credentials' ? 'Your current password is not right.' : authMessage(error));
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(authMessage(error));
    // Anyone holding the old password is signed out on their devices.
    await supabase.auth.signOut({ scope: 'others' }).catch(() => {});
  },
  // A session of the extension's own (see supabase/functions/extension-token).
  // Never this tab's refresh token: two clients refreshing the same token make
  // Supabase revoke the session, which signed the web app out.
  getSyncToken: async () => {
    if (!supabase) throw new Error('Could not reach the server.');
    const { data, error } = await supabase.functions.invoke('extension-token', { body: {} });
    if (error || !data?.refresh_token) throw new Error(data?.error || 'Could not create a token for the extension. Try again.');
    return data.refresh_token;
  },
  resetLocal: async ({ keepSamples }) => {
    const yes = await confirmDialog({
      title: keepSamples ? 'Load the sample library?' : 'Clear the library?',
      message: 'Everything saved in preview mode on this browser is replaced.',
      confirmLabel: keepSamples ? 'Load samples' : 'Clear all',
    });
    if (!yes || state.mode !== 'local') return;
    clearLocalLibrary({ keepSamples });
    await enterPreview();
    toast(keepSamples ? 'Sample library loaded' : 'Library cleared');
  },
};

async function boot() {
  mountShell(app); // shows the loading state immediately

  supabase = await getSupabase();
  if (!supabase) {
    await enterPreview();
    return;
  }

  const redirect = readAuthRedirect();
  let recovering = false;

  // A reset link signs the person in; the new password comes before the app.
  const recover = (session) => {
    if (recovering) return;
    recovering = true;
    showRecovery({
      supabase,
      onDone: () => {
        recovering = false;
        hideAuth();
        enterCloud(session);
      },
    });
  };

  // First arrival: the session (if any) after Supabase has read the link in the URL.
  const arrive = (session) => {
    if (redirect) clearAuthRedirect();
    if (redirect?.type === 'recovery' && session && !redirect.error) return recover(session);
    if (session) enterCloud(session);
    else signedOut();
    if (!redirect) return;
    if (redirect.error || !session) reportBrokenLink(redirect, Boolean(session));
    else if (ARRIVAL_TOAST[redirect.type]) toast(ARRIVAL_TOAST[redirect.type]);
  };

  // Subscribed straight away, before Supabase finishes reading the URL, so no
  // event is missed (PASSWORD_RECOVERY fires once, right after start-up).
  // Handlers are deferred: Supabase holds a lock while this callback runs, and
  // loading the library makes further auth-aware requests.
  supabase.auth.onAuthStateChange((event, next) => {
    if (event === 'INITIAL_SESSION') setTimeout(() => arrive(next), 0);
    else if (event === 'PASSWORD_RECOVERY') next && setTimeout(() => recover(next), 0);
    else if (event === 'SIGNED_OUT') setTimeout(() => (signingOut ? ((signingOut = false), signedOut()) : sessionEnded()), 0);
    else if (next && (event === 'SIGNED_IN' || event === 'USER_UPDATED') && !recovering) setTimeout(() => enterCloud(next), 0);
  });
}

boot();
