import { createClient } from '@supabase/supabase-js';
export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({message:'Method not allowed'});
 try{
  const {email,password}=req.body||{}; const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY);
  const {data,error}=await sb.auth.signUp({email,password});
  if(error)return res.status(400).json({message:error.message});
  return res.status(200).json({message:data.session?'Account created and signed in.':'Account created. Check your email to confirm.',email});
 }catch(e){return res.status(503).json({message:'Account service is not configured.'})}
}