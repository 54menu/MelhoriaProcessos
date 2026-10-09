import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createCurationHandler } from '../_shared/curated-examples.mjs';
import { loadDictionary } from '../_shared/knowledge-context.mjs';

Deno.serve(async request=>{
  const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const rpc=async(name:string,args:Record<string,unknown>={})=>{
    const {data,error}=await client.rpc(name,args).abortSignal(AbortSignal.timeout(10000));
    if(error) throw new Error('curation_unavailable'); return data;
  };
  return createCurationHandler({
    model:Deno.env.get('CLASSIFICATION_MODEL')||Deno.env.get('GEMINI_MODEL')||'gemini-3.5-flash-lite',
    list:async(status:string,offset:number)=>{
      const {data,error}=await client.from('correction_curations').select('*,perception_reviews(changes,proposed_summary,final_summary,final_classification,perceptions(original_text))').eq('status',status).order('created_at').order('id').range(offset,offset+49).abortSignal(AbortSignal.timeout(10000));
      if(error) throw new Error('curation_unavailable');return {items:data??[],offset,has_more:data?.length===50};
    },
    snapshot:async()=>{
      const [snapshot,dictionary]=await Promise.all([rpc('curated_example_snapshot'),loadDictionary(client,AbortSignal.timeout(10000))]);
      if(!dictionary.complete)throw new Error('incomplete_dictionary');
      return {...snapshot,dictionary};
    },
    review:args=>rpc('review_correction_example',args),
    publish:args=>rpc('publish_curated_examples',args),
    retire:args=>rpc('retire_curated_example',args),
  })(request);
});
