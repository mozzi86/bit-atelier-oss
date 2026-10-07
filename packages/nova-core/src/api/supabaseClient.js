// supabaseClient.js — the ONE browser client for the cloud data path (57-02).
//
// Singleton: supabase-js keeps auth sessions/timers on the instance, a second
// createClient would duplicate them. Configuration comes from the Vite build
// environment (both values are PUBLIC by design — RLS protects the data; the
// service_role key never reaches this file, see supabase/README.md).
//
// This module is imported dynamically (bitApi.js supabase branch) so it — and
// with it @supabase/supabase-js — tree-shakes out of the demo and lokal builds.

import { createClient } from '@supabase/supabase-js';

/** @type {import('@supabase/supabase-js').SupabaseClient|null} */
let instanz = null;

/**
 * Returns the singleton Supabase client.
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 * @throws {Error} plain-text error when the build has DATENQUELLE 'supabase'
 *   but the environment variables are missing (never a silent fallback —
 *   project rule: errors in plain text).
 */
export function supabaseClient() {
  if (instanz) return instanz;
  const url = import.meta.env?.VITE_SUPABASE_URL;
  const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Supabase-Konfiguration fehlt: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  }
  instanz = createClient(url, anonKey, {
    auth: {
      persistSession: true,      // reload keeps the user logged in
      autoRefreshToken: true,    // session survives long work sessions
      // No detectSessionInUrl override — the password-recovery flow needs the
      // default (it reads the token from the redirect URL).
    },
  });
  return instanz;
}
