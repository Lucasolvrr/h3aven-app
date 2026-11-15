// Boot: decide between the signed-in library (Supabase) and preview mode
// (this browser only), then hand over to the shell.

import { ALLOW_PREVIEW_MODE } from './config.js';
import { getSupabase } from './data/supabase.js';
import { createCloudDriver } from './data/cloud-driver.js';
import { createLocalDriver, clearLocalLibrary } from './data/local-driver.js';
import { start, reload, state } from './data/store.js';
import { mountShell } from './ui/shell.js';
import { showAuth, showRecovery, hideAuth } from './ui/auth.js';
import { toast, confirmDialog } from './ui/overlay.js';

let supabase = null;
let activeUserId = null;

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

function signIn() {
  if (!supabase) {
    toast('Could not reach the sign-in service. Check your connection and reload.', { type: 'error' });
    return;
  }
  showAuth({ supabase, onPreview: ALLOW_PREVIEW_MODE ? hideAuth : null });
}

function signedOut() {
  if (ALLOW_PREVIEW_MODE) enterPreview();
  else signIn();
}

const app = {
  signIn,
  reload,
  signOut: async () => {
    await supabase?.auth.signOut();
  },
  updateEmail: async (email) => {
    const { error } = await supabase.auth.updateUser({ email: email.trim() });
    if (error) throw new Error(error.message);
  },
  updatePassword: async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
  },
  // The extension authenticates with the session's refresh token.
  getSyncToken: async () => (await supabase?.auth.getSession())?.data.session?.refresh_token || '',
  resetLocal: async ({ keepSamples }) => {
    const yes = await confirmDialog({
      title: keepSamples ? 'Restore the sample library?' : 'Start with an empty library?',
      message: 'Everything saved in preview mode on this browser is replaced.',
      confirmLabel: keepSamples ? 'Restore samples' : 'Start empty',
    });
    if (!yes || state.mode !== 'local') return;
    clearLocalLibrary({ keepSamples });
    await enterPreview();
    toast(keepSamples ? 'Sample library restored' : 'Library cleared');
  },
};

async function boot() {
  mountShell(app); // shows the loading state immediately

  supabase = await getSupabase();
  if (!supabase) {
    await enterPreview();
    return;
  }

  const recovering = new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
  const {
    data: { session },
  } = await supabase.auth.getSession();

  supabase.auth.onAuthStateChange((event, next) => {
    if (event === 'PASSWORD_RECOVERY') {
      showRecovery({ supabase, onDone: () => (next ? enterCloud(next) : signedOut()) });
    } else if (event === 'SIGNED_OUT') {
      signedOut();
    } else if (next && (event === 'SIGNED_IN' || event === 'USER_UPDATED')) {
      // Deferred: Supabase holds a lock while this callback runs, and loading
      // the library makes further auth-aware requests.
      setTimeout(() => enterCloud(next), 0);
    }
  });

  if (recovering) return; // the PASSWORD_RECOVERY event takes it from here
  if (session) await enterCloud(session);
  else signedOut();
}

boot();
