import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

// Loaded lazily and defensively: if the CDN is unreachable the app still
// opens in preview mode instead of showing a blank page.
let clientPromise;

export function getSupabase() {
  if (!clientPromise) {
    clientPromise = import('https://esm.sh/@supabase/supabase-js@2')
      .then(({ createClient }) =>
        createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
        })
      )
      .catch((error) => {
        console.warn('Supabase client unavailable — cloud sync is off.', error);
        return null;
      });
  }
  return clientPromise;
}
