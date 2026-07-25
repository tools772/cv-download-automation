import { createClient, SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { supabaseUrl, supabaseServiceKey } from "../config.js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    // Electron's Node (ELECTRON_RUN_AS_NODE) has no global WebSocket.
    // supabase-js Realtime requires one even when we only use REST.
    client = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
    });
  }
  return client;
}
