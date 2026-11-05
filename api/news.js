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
  if(/personal finance|entrepreneurship/.test(t)&&/class 9/.test(t))return cls==='9'?3:2;
  if(/class 10 textbooks/.test(t))return cls==='9'||cls==='10'?3:2;
  if(/aicte|national science seminar|nasa|stem day|energy future/.test(t))return 2;
  if(/classes? x|class xii|class 10|class 12|loc|board examination|sample question paper|admit card|result|supplementary/i.test(t))return cls==='10'||cls==='12'?3:2;
  if(/scholarship|inspire|nielit|career|cyber|competition|quiz|skill|webinar|national education|textbook|curriculum|student/i.test(t))return 2;
  return 1;
}
function whyItMatters(title,cls){
  const t=title.toLowerCase();
  if(/personal finance|entrepreneurship/.test(t))return 'Class 9 students can explore budgeting, saving, financial concepts and the basics of planning a business.';
  if(/class 10 textbooks/.test(t))return 'A report says revised Class 10 textbooks are planned ahead of the 2027 session; check NCERT for the final release and syllabus.';
  if(/aicte|idea lab|modrobs|margdarshan/.test(t))return 'AICTE announced support for practical labs, infrastructure upgrades and institutional mentoring. These are schemes for institutions, not direct student grants.';
  if(/national science seminar/.test(t))return 'Students from across India discussed the country’s future energy needs, sustainability and energy security.';
  if(/nasa|stem day|astronaut/.test(t))return 'A student-focused NASA programme connected spaceflight with science, engineering and career exploration.';
  if(/loc|list of candidates/.test(t))return 'Important for Class '+cls+' exam registration and school-side candidate submission.';
  if(/sample question paper/.test(t))return 'Useful for Class '+cls+' exam preparation and understanding the current paper pattern.';
  if(/scholarship|inspire|nielit|career/.test(t))return 'May help students discover scholarships, courses, careers, or learning opportunities.';
  if(/cyber/.test(t))return 'Useful practical guidance for staying safer online while studying and using digital services.';
  if(/competition|quiz|expo|olympiad/.test(t))return 'May offer a student competition, activity, or enrichment opportunity.';
  if(/curriculum|textbook|syllabus/.test(t))return 'Helps students track curriculum or textbook changes for the current session.';
  return 'A current education update that may be useful to students or schools.';
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
    // Hand-curated recent education and science stories complement the live CBSE notices above.
    const featured=[
      {
        title:'NCERT adds personal finance and entrepreneurship chapters to the Class 9 textbook',
        date:'4 Nov 2026',
        link:'https://www.ndtv.com/education/ncert-adds-personal-finance-entrepreneurship-chapters-to-class-9-social-science-textbook-12282323',
        source:'NDTV Education',
        kind:'Education',
        featured:true
      },
      {
        title:'AICTE announces four schemes to strengthen technical education in 2026–27',
        date:'1 Nov 2026',
        link:'https://indianexpress.com/article/education/aicte-launches-four-schemes-2026-27-idea-lab-modrobs-margdarshan-details-10945006/',
        source:'The Indian Express',
        kind:'Science & Tech',
        featured:true
      },
      {
        title:'National Science Seminar 2026 celebrates student ideas on India’s energy future',
        date:'3 Nov 2026',
        link:'https://ncsm.gov.in/media/press-release/soumyashree-thanapati-from-odisha-was-declared-winner-of-the-national-science-seminar-2026',
        source:'National Council of Science Museums',
        kind:'Science & Tech',
        featured:true
      },
      {
        title:'NASA connects students with an astronaut aboard the International Space Station for STEM Day',
        date:'3 Nov 2026',
        link:'https://www.nasa.gov/learning-resources/nasa-astronaut-stem-creator-connect-with-students-for-stem-day/',
        source:'NASA',
        kind:'Science & Tech',
        featured:true
      },
      {
        title:'NCERT plans to release new Class 10 textbooks ahead of the 2027 academic session',
        date:'1 Nov 2026',
        link:'https://www.ndtv.com/education/ncert-to-introduce-new-class-10-textbooks-three-months-before-2027-session-12265861',
        source:'NDTV Education',
        kind:'Education',
        featured:true
      }
    ];
    const seen=new Set();
    const items=[...featured,...collected]
      .filter(x=>x.link&&!seen.has(x.link)&&seen.add(x.link))
      .map(x=>({...x,score:relevance(x,cls),why:whyItMatters(x.title,cls)}))
      .sort((a,b)=>Number(Boolean(b.featured))-Number(Boolean(a.featured))||b.score-a.score)
      .slice(0,32);
    res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=900');
    return res.status(200).json({class:cls,updatedAt:new Date().toISOString(),items});
  }catch(e){
    return res.status(503).json({message:'News service temporarily unavailable.'});
  }
}