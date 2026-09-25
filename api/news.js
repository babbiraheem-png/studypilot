function decodeEntities(s=''){
  return s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
function clean(s=''){
  return decodeEntities(s.replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
}
function abs(base,href=''){
  if(!href)return '';
  try{return new URL(href,base).href}catch{return '';}
}
function rowsFromHtml(html,base,source,kind){
  const out=[];
  const rows=[...html.matchAll(/<tr[\\s\\S]*?<\\/tr>/gi)].map(m=>m[0]);
  for(const row of rows){
    const cells=[...row.matchAll(/<t[dh][^>]*>([\\s\\S]*?)<\\/t[dh]>/gi)].map(m=>m[1]);
    if(cells.length<2)continue;
    const date=clean(cells[0]);
    const title=clean(cells.find(x=>clean(x).length>12)||cells[1]);
    if(!title||!/[A-Za-z]/.test(title))continue;
    const links=[...row.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi)];
    const link=links.length?abs(base,links[links.length-1][1]):base;
    out.push({title,date,link,source,kind});
  }
  return out;
}
function fallbackLinks(html,base,source,kind){
  const out=[];
  const links=[...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/gi)];
  for(const m of links){
    const title=clean(m[2]);
    if(title.length<15||!/^[^]*[A-Za-z]/.test(title))continue;
    if(/home|login|contact|privacy|disclaimer|download|click here/i.test(title))continue;
    out.push({title,date:'',link:abs(base,m[1]),source,kind});
  }
  return out;
}
function relevance(item,cls){
  const t=(item.title||'').toLowerCase();
  if(/classes? x|class xii|class 10|class 12|loc|board examination|sample question paper|admit card|result|supplementary/i.test(t))return cls==='10'||cls==='12'?3:2;
  if(/scholarship|inspire|nielit|career|cyber|competition|quiz|skill|webinar|national education|textbook|curriculum|student/i.test(t))return 2;
  return 1;
}
function whyItMatters(title,cls){
  const t=title.toLowerCase();
  if(/loc|list of candidates/.test(t))return 'Important for Class '+cls+' exam registration and school-side candidate submission.';
  if(/sample question paper/.test(t))return 'Useful for Class '+cls+' exam preparation and understanding the current paper pattern.';
  if(/scholarship|inspire|nielit|career/.test(t))return 'May help students discover scholarships, courses, careers, or learning opportunities.';
  if(/cyber/.test(t))return 'Useful practical guidance for staying safer online while studying and using digital services.';
  if(/competition|quiz|expo|olympiad/.test(t))return 'May offer a student competition, activity, or enrichment opportunity.';
  if(/curriculum|textbook|syllabus/.test(t))return 'Helps students track curriculum or textbook changes for the current session.';
  return 'A current official education update that may be useful to students or schools.';
}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({message:'Method not allowed'});
  const cls=String(req.query?.class||'11');
  const sources=[
    ['https://cbseacademic.nic.in/circulars.html','CBSE Academics','Academic'],
    ['https://www.cbse.gov.in/cbsenew/examination_Circular.html','CBSE Examinations','Exam'],
    ['https://www.cbse.gov.in/cbsenew/misc.html','CBSE Notices','Student notice']
  ];
  try{
    const collected=[];
    for(const [url,source,kind] of sources){
      try{
        const r=await fetch(url,{headers:{'user-agent':'StudyPilot News/1.0'}});
        if(!r.ok)continue;
        const html=await r.text();
        let items=rowsFromHtml(html,url,source,kind);
        if(items.length<3)items=fallbackLinks(html,url,source,kind);
        collected.push(...items.slice(0,30));
      }catch{}
    }
    const seen=new Set();
    const items=collected
      .filter(x=>x.link&&!seen.has(x.link)&&seen.add(x.link))
      .map(x=>({...x,score:relevance(x,cls),why:whyItMatters(x.title,cls)}))
      .sort((a,b)=>b.score-a.score)
      .slice(0,24);
    res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=900');
    return res.status(200).json({class:cls,updatedAt:new Date().toISOString(),items});
  }catch(e){
    return res.status(503).json({message:'News service temporarily unavailable.'});
  }
}