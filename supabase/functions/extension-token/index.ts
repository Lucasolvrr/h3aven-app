// Supabase Edge Function: extension-token
//
// Gives the browser extension a session of its own.
//
// Why: Supabase rotates the refresh token on every refresh, and a refresh
// token used twice makes it revoke the whole session. When the extension was
// handed the web app's own refresh token, the two took turns refreshing the
// same chain and Supabase signed both of them out.
//
// How: the caller proves who they are with their access token (verify_jwt is
// on). We create a one-time magic-link token for that same account WITHOUT
// sending an email, and redeem it straight away. That opens a brand-new
// session, and its refresh token goes back to the web app, which shows it so
// it can be pasted into the extension.

import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Sign in first.' }, 401);

  const admin = createClient(url, serviceKey, options);
  const { data: who, error: whoError } = await admin.auth.getUser(jwt);
  const email = who?.user?.email;
  if (whoError || !email) return json({ error: 'Your session ended. Sign in again.' }, 401);

  // A one-time token for this account; generateLink never sends the email.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) return json({ error: 'Could not create a session for the extension.' }, 500);

  const anon = createClient(url, anonKey, options);
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  if (verifyError || !verified?.session?.refresh_token) return json({ error: 'Could not create a session for the extension.' }, 500);
  if (verified.session.user?.id !== who.user.id) return json({ error: 'Account mismatch.' }, 500);

  return json({ refresh_token: verified.session.refresh_token });
});
