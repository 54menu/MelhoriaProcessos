import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3';
import { createManagementHandler } from '../_shared/management-review.mjs';
const client=()=>createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
Deno.serve(createManagementHandler({
  list:async(offset:number)=>{
    const {data,error}=await client().from('report_submissions')
      .select('analysis_session_id,submitted_at,analysis_sessions(original_text,proposed_interpretation,model,prompt_version)')
      .eq('status','pending').order('submitted_at').order('analysis_session_id').range(offset,offset+49).abortSignal(AbortSignal.timeout(10000));
    if(error)throw error;return data;
  },
  review:async(args:Record<string,unknown>)=>{
    const {data,error}=await client().rpc('review_submitted_report',args).abortSignal(AbortSignal.timeout(15000));
    if(error)throw new Error(error.message);return data;
  }
}));
