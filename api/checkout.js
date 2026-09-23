import crypto from 'crypto';
export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({message:'Method not allowed'});
 const {plan}=req.body||{}; const map={plus:process.env.RAZORPAY_PLUS_PLAN_ID,pro:process.env.RAZORPAY_PRO_PLAN_ID};
 const planId=map[plan]; if(!planId)return res.status(503).json({message:'Payment plans are not configured yet. Connect Razorpay and add the plan IDs in Vercel.'});
 try{
  const key=process.env.RAZORPAY_KEY_ID,secret=process.env.RAZORPAY_KEY_SECRET;
  const auth=Buffer.from(key+':'+secret).toString('base64');
  const response=await fetch('https://api.razorpay.com/v1/subscriptions',{method:'POST',headers:{Authorization:'Basic '+auth,'Content-Type':'application/json'},body:JSON.stringify({plan_id:planId,total_count:12,customer_notify:1,notes:{product:'StudyPilot',plan}})});
  const data=await response.json(); if(!response.ok)return res.status(response.status).json({message:data?.error?.description||'Razorpay checkout could not be created.'});
  return res.status(200).json({subscription_id:data.id});
 }catch(e){return res.status(500).json({message:'Payment service unavailable.'})}
}