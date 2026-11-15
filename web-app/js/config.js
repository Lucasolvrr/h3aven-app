// Project settings (Supabase dashboard > Settings > API).
// The publishable key is public by design — row level security is what
// protects the data, not this key.
export const SUPABASE_URL = 'https://kxoegfliihryqfwensva.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_C_WACPTJGzfSCf-BtB8QlQ_Jm8EJwmn';

// When nobody is signed in, open the app in preview mode instead of forcing
// the login screen. Preview mode keeps the library in this browser only
// (localStorage) and never talks to the database. Set to false to require
// sign-in.
export const ALLOW_PREVIEW_MODE = true;

export const APP_NAME = 'h3aven';

// Keys used in localStorage. One place, so nothing collides.
export const STORAGE = {
  sidebar: 'h3aven.sidebar',
  expanded: 'h3aven.sidebar.expanded',
  sort: 'h3aven.sort',
  recentSearches: 'h3aven.search.recent',
  recentCommands: 'h3aven.palette.recent',
  aspect: 'h3aven.thumb.aspect',
  localLibrary: 'h3aven.local.v1',
};
