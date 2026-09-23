import { createClient } from '@supabase/supabase-js';
export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({message:'Method not allowed'});
 try{
  const {email,password}=req.body||{}; const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY);
  const {data,error}=await sb.auth.signInWithPassword({email,password});
  if(error)return res.status(401).json({message:error.message});
  const user=data.user; return res.status(200).json({email:user.email,access_token:data.session?.access_token||null,plan:'free',credits:20});
 }catch(e){return res.status(503).json({message:'Account service is not configured.'})}
}