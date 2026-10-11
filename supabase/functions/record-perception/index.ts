import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import { createSubmissionHandler } from "../_shared/report-submission.mjs";

Deno.serve(createSubmissionHandler(async (id: string) => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("persistence_not_configured");
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("submit_confirmed_report", {p_session_id:id}).abortSignal(AbortSignal.timeout(15000));
  if (error || !data) throw new Error(error?.message ?? "persistence_failed");
  return data;
}));
