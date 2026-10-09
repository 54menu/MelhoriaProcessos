import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createRecordHandler } from "../_shared/review-confirmation.mjs";

Deno.serve(createRecordHandler(async (args: Record<string, unknown>) => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("persistence_not_configured");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("persist_reviewed_perception", args).abortSignal(AbortSignal.timeout(15000));
  if (error || !data) throw new Error(error?.message ?? "persistence_failed");
  return data;
}));
