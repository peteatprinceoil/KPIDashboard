import { createClient } from "@supabase/supabase-js";

// Read-only connection to the TaigaAI Supabase — the live data source.
// Keep this server-side only (no NEXT_PUBLIC_ prefix).
export function getTaigaSupabaseClient() {
  const url = process.env.TAIGA_SUPABASE_URL;
  const key = process.env.TAIGA_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "TAIGA_SUPABASE_URL and TAIGA_SUPABASE_SERVICE_ROLE_KEY must be set"
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
