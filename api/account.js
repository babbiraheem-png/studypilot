import { createClient } from '@supabase/supabase-js';
function admin(){return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}})}
function getBearer(req){const h=req.headers.authorization||'';return h.startsWith('Bearer ')?h.slice(7):null}
export default async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({message:'Method not allowed'});
 const token=getBearer(req); if(!token)return res.status(401).json({authenticated:false});
 try{
  const sb=admin(); const {data:{user},error}=await sb.auth.getUser(token);
  if(error||!user)return res.status(401).json({authenticated:false});
  const {data:profile}=await sb.from('profiles').select('plan,credits,email').eq('id',user.id).single();
  return res.status(200).json({authenticated:true,email:user.email,plan:profile?.plan||'free',credits:profile?.credits??20});
 }catch(e){return res.status(503).json({message:'Account service is not configured.'})}
}