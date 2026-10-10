import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';
import { createMonitoringHandler } from '../_shared/classification-monitoring.mjs';

Deno.serve(createMonitoringHandler(async (days: number) => {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('persistence_not_configured');
  const { data, error } = await createClient(url, key, { auth: { persistSession: false } })
    .rpc('classification_monitoring', { p_days: days }).abortSignal(AbortSignal.timeout(10000));
  if (error || !data) throw new Error('monitoring_unavailable');
  return data;
}));
