async function generateExamQuestions(res, body) {
  const studentClass = Number(body.studentClass);
  const subject = String(body.subject || '').trim().slice(0, 80);
  const topics = Array.isArray(body.topics)
    ? body.topics.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean).slice(0, 8)
    : [];
  const stage = String(body.stage || 'chapter practice').trim().slice(0, 120);
  const recentQuestions = Array.isArray(body.recentQuestions)
    ? body.recentQuestions.filter(x => typeof x === 'string').map(x => x.trim().slice(0, 240)).filter(Boolean).slice(-30)
    : [];
  if (!Number.isInteger(studentClass) || studentClass < 6 || studentClass > 12) return res.status(400).json({ message: 'Choose a class between 6 and 12.' });
  if (!subject || !topics.length) return res.status(400).json({ message: 'Choose a subject and add at least one syllabus topic.' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ message: 'Question generation is not configured on the server yet.' });

  const prompt = [
    'Create exactly three original, solvable school exam questions with answers and worked solutions.',
    'Class: ' + studentClass + '.',
    'Subject: ' + subject + '.',
    'Only use these syllabus topics: ' + topics.join('; ') + '.',
    'Study-session focus: ' + stage + '.',
    'Use age-appropriate language and the expected school level. Do not introduce unrelated topics.',
    'Vary the three tasks: one foundational question, one application or worked problem, and one exam-style question.',
    'For mathematics or science, include actual values, units and enough information to solve numerical problems when suitable.',
    'For humanities or languages, use clear written-response questions with a concise expected answer and explanation.',
    'Independently solve and verify each question before returning it. Check arithmetic, units and factual claims.',
    'Do not copy or lightly reword any question in the recent-question list.',
    'Do not include the answer in the question itself.',
    'Return exactly this JSON shape and no other text:',
    '{"questions":[{"topic":"one supplied topic","question":"...","answer":"...","solution":"...","marks":2}]}',
    'Use exactly three questions. Each answer and solution must be concise but sufficient for a student to check their work.',
    'Recent questions to avoid: ' + JSON.stringify(recentQuestions)
  ].join('\\n');

  const models = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];
  let lastMessage = 'The AI could not create a verified question set.';
  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 22000);
    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: 'You write accurate school exam practice. Return strict JSON only. Never invent ambiguous questions or unsupported facts.' }] },
          generationConfig: { responseMimeType: 'application/json', temperature: 0.75, maxOutputTokens: 1500 }
        })
      });
      clearTimeout(timeout);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastMessage = data?.error?.message || 'The question service returned an error.';
        if ([429, 500, 502, 503, 504].includes(response.status)) continue;
        return res.status(response.status).json({ message: lastMessage });
      }
      const raw = data?.candidates?.[0]?.content?.parts?.map(x => x?.text || '').join('').trim();
      if (!raw) { lastMessage = 'The AI returned an empty question set.'; continue; }
      let parsed;
      try {
        const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
        parsed = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
      } catch { lastMessage = 'The AI response was not valid question data.'; continue; }
      const clean = (Array.isArray(parsed?.questions) ? parsed.questions : []).map(item => {
        if (!item || typeof item !== 'object') return null;
        const topic = String(item.topic || '').trim();
        const question = String(item.question || '').trim();
        const answer = String(item.answer || '').trim();
        const solution = String(item.solution || '').trim();
        const marks = Number(item.marks || 2);
        if (!topics.some(t => t.toLowerCase() === topic.toLowerCase()) ||
          question.length < 12 || question.length > 650 ||
          answer.length < 1 || answer.length > 450 ||
          solution.length < 8 || solution.length > 900 ||
          !Number.isInteger(marks) || marks < 1 || marks > 6) return null;
        return { topic, question, answer, solution, marks };
      }).filter(Boolean);
      const normalize = value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const seen = new Set(recentQuestions.map(normalize));
      const unique = [];
      for (const item of clean) {
        const signature = normalize(item.question);
        if (!signature || seen.has(signature)) continue;
        seen.add(signature);
        unique.push(item);
      }
      if (unique.length < 3) { lastMessage = 'The generated questions repeated earlier questions. Please try again.'; continue; }
      return res.status(200).json({ questions: unique.slice(0, 3), model });
    } catch (error) {
      clearTimeout(timeout);
      lastMessage = error?.name === 'AbortError' ? 'Question generation took too long. Please try again.' : 'The question service is temporarily unavailable.';
    }
  }
  return res.status(503).json({ message: lastMessage });
}


function cleanDiagramSvg(raw) {
  const allowedTags = new Set(['svg','g','rect','circle','ellipse','line','path','polygon','polyline','text','tspan']);
  const allowedAttrs = new Set([
    'xmlns','viewBox','width','height','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry',
    'd','points','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray',
    'font-size','font-family','font-weight','font-style','text-anchor','dominant-baseline',
    'letter-spacing','text-decoration','textLength','lengthAdjust','opacity','transform',
    'fill-rule','clip-rule'
  ]);
  let svg = String(raw || '').replace(/\u0060\u0060\u0060(?:svg|xml)?/gi, '').replace(/\u0060\u0060\u0060/g, '').trim();
  const start = svg.indexOf('<svg'), end = svg.lastIndexOf('</svg>');
  if (start < 0 || end < start) return '';
  svg = svg.slice(start, end + 6);
  if (svg.length > 16000 || /<script|foreignObject|<image|<use|href\s*=|url\s*\(|on\w+\s*=/i.test(svg)) return '';
  svg = svg.replace(/<\/?([a-zA-Z][\w:-]*)\b([^>]*)>/g, (whole, tagName, rawAttrs) => {
    const tag = tagName.toLowerCase();
    if (!allowedTags.has(tag)) return '';
    const closing = whole.startsWith('</');
    if (closing) return '</' + tag + '>';
    const attrs = [];
    const attrPattern = /([a-zA-Z:-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;
    let match;
    while ((match = attrPattern.exec(rawAttrs)) !== null) {
      const name = match[1];
      let value = match[2].replace(/^['"]|['"]$/g, '');
      if (!allowedAttrs.has(name) || /[<>]|javascript:|data:|url\s*\(/i.test(value)) continue;
      value = value.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/gi, '&amp;');
      attrs.push(name + '="' + value.replace(/"/g, '&quot;') + '"');
    }
    return '<' + tag + (attrs.length ? ' ' + attrs.join(' ') : '') + ( /\/\s*$/.test(rawAttrs) ? '/>' : '>');
  });
  if (!/<svg\b/i.test(svg) || !/<\/svg>/i.test(svg)) return '';
  return svg;
}


function escapeDiagramText(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function textDiagramFallback(concept, raw) {
  const plain = String(raw || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\\*\\*/g, '')
    .replace(/\\s+/g, ' ')
    .trim();
  if (plain.length < 12) return '';
  const words = plain.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > 74) {
      if (line) lines.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
    if (lines.length >= 8) break;
  }
  if (line && lines.length < 9) lines.push(line);
  const title = escapeDiagramText(concept.slice(0, 90));
  const palette = [
    { fill: '#e8f4ff', stroke: '#4597e8', dot: '#2878d0' },
    { fill: '#e9fbf4', stroke: '#36b98a', dot: '#15966a' },
    { fill: '#fff3e5', stroke: '#f0a34a', dot: '#d97706' },
    { fill: '#f3edff', stroke: '#9b7bea', dot: '#7952cf' }
  ];
  const rows = lines.map((item, i) => {
    const p = palette[i % palette.length];
    const y = 155 + i * 43;
    return '<circle cx="83" cy="' + (y + 15) + '" r="12" fill="' + p.dot + '"/>' +
      '<text x="83" y="' + (y + 20) + '" text-anchor="middle" font-size="13" font-weight="700" fill="#ffffff">' + (i + 1) + '</text>' +
      '<rect x="108" y="' + y + '" width="700" height="34" rx="12" fill="' + p.fill + '" stroke="' + p.stroke + '" stroke-width="1.5"/>' +
      '<text x="128" y="' + (y + 22) + '" font-size="16" fill="#20334d">' + escapeDiagramText(item) + '</text>';
  }).join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 560" width="900" height="560"><rect width="900" height="560" rx="24" fill="#f8fbff"/><rect x="28" y="25" width="844" height="105" rx="22" fill="#173b70"/><text x="65" y="72" font-size="29" font-weight="700" fill="#ffffff">' + title + '</text><text x="65" y="103" font-size="16" fill="#cfe4ff">A clear, step-by-step visual guide</text>' + rows + '<text x="65" y="530" font-size="13" fill="#64748b">StudyPilot • Learning visual</text></svg>';
}

function basicConceptMap(concept) {
  const title = escapeDiagramText(String(concept || 'Study concept').slice(0, 90));
  const cards = [
    { n: '01', heading: 'CORE IDEA', detail: 'Understand what the concept means.', fill: '#e7f2ff', edge: '#3988df', ink: '#14569b' },
    { n: '02', heading: 'HOW IT WORKS', detail: 'Follow the key steps and connections.', fill: '#e6f8f1', edge: '#32ad82', ink: '#087653' },
    { n: '03', heading: 'KEY TAKEAWAY', detail: 'Connect the idea to a real example.', fill: '#fff1df', edge: '#e99a3b', ink: '#a45a0b' }
  ];
  const cardSvg = cards.map((c, i) => {
    const y = 172 + i * 108;
    return '<rect x="72" y="' + y + '" width="756" height="82" rx="18" fill="' + c.fill + '" stroke="' + c.edge + '" stroke-width="2"/>' +
      '<circle cx="116" cy="' + (y + 41) + '" r="23" fill="' + c.edge + '"/>' +
      '<text x="116" y="' + (y + 46) + '" text-anchor="middle" font-size="13" font-weight="700" fill="#ffffff">' + c.n + '</text>' +
      '<text x="158" y="' + (y + 33) + '" font-size="13" font-weight="700" letter-spacing="1" fill="' + c.ink + '">' + c.heading + '</text>' +
      '<text x="158" y="' + (y + 58) + '" font-size="18" fill="#20334d">' + c.detail + '</text>';
  }).join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 560" width="900" height="560"><rect width="900" height="560" rx="26" fill="#f7faff"/><rect x="28" y="25" width="844" height="116" rx="24" fill="#173b70"/><circle cx="815" cy="57" r="22" fill="#48b7e9"/><circle cx="846" cy="103" r="12" fill="#f6b84b"/><text x="66" y="78" font-size="31" font-weight="700" fill="#ffffff">' + title + '</text><text x="66" y="111" font-size="16" fill="#d4e8ff">A simple visual guide to help you learn</text>' + cardSvg + '<text x="66" y="530" font-size="13" fill="#64748b">StudyPilot • Visual learning</text></svg>';
}


function maleReproductiveSystemDiagram() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 650" width="1000" height="650">' +
    '<defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#ffffff"/><stop offset="1" stop-color="#edf5fc"/></linearGradient><linearGradient id="tissue" x2="1" y2="1"><stop stop-color="#f8d3c4"/><stop offset=".55" stop-color="#e8a99a"/><stop offset="1" stop-color="#c77f78"/></linearGradient><linearGradient id="gold" x2="1" y2="1"><stop stop-color="#f8dfa0"/><stop offset="1" stop-color="#d6a454"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#264766" flood-opacity=".15"/></filter></defs>' +
    '<rect width="1000" height="650" rx="24" fill="url(#bg)"/><rect x="28" y="24" width="944" height="86" rx="18" fill="#173b70"/>' +
    '<text x="58" y="61" font-family="Arial,sans-serif" font-size="29" font-weight="700" fill="#fff">Male reproductive system</text><text x="58" y="88" font-family="Arial,sans-serif" font-size="15" fill="#d8eaff">Detailed school biology illustration · side view · simplified, not to scale</text>' +
    '<rect x="315" y="132" width="370" height="475" rx="22" fill="#fff" stroke="#d8e5f2" filter="url(#shadow)"/>' +
    '<path d="M460 188 C442 153 469 145 500 145 C540 145 560 165 546 198 C537 220 515 231 491 225 C473 221 464 207 460 188Z" fill="url(#gold)" stroke="#bd8c48" stroke-width="3"/>' +
    '<path d="M535 247 C555 224 583 235 585 256 C587 276 563 291 544 279 C531 271 526 257 535 247Z" fill="#c88a99" stroke="#985d75" stroke-width="3"/>' +
    '<path d="M463 284 C480 263 548 264 565 283 C580 301 570 331 548 340 C520 352 480 340 465 322 C455 310 455 296 463 284Z" fill="#c77e83" stroke="#98545e" stroke-width="3"/>' +
    '<path d="M500 225 C501 254 500 278 501 302 C502 333 507 365 540 390 C568 411 612 417 650 402 C669 395 683 408 675 425 C666 446 629 452 592 444 C536 432 490 406 474 366" fill="none" stroke="url(#tissue)" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M500 225 C501 254 500 278 501 302 C502 333 507 365 540 390" fill="none" stroke="#f7e6ac" stroke-width="7" stroke-linecap="round"/>' +
    '<path d="M430 470 C409 439 409 398 425 355 C441 314 455 285 450 250 C447 224 458 211 478 207" fill="none" stroke="#d7a451" stroke-width="10" stroke-linecap="round"/>' +
    '<path d="M390 478 C389 442 414 420 447 427 C479 434 497 465 488 502 C480 538 452 563 421 555 C396 548 385 514 390 478Z" fill="url(#tissue)" stroke="#b87570" stroke-width="3"/>' +
    '<ellipse cx="438" cy="495" rx="25" ry="37" transform="rotate(12 438 495)" fill="url(#gold)" stroke="#b78060" stroke-width="3"/>' +
    '<path d="M462 459 C481 470 480 490 469 506 C460 520 461 536 447 545" fill="none" stroke="#b76e56" stroke-width="8" stroke-linecap="round"/>' +
    '<path d="M682 186 C704 225 698 265 683 300 C671 334 675 366 696 394" fill="none" stroke="#d58f91" stroke-width="17" stroke-linecap="round" opacity=".55"/>' +
    '<g font-family="Arial,sans-serif" font-size="15" fill="#203b5c" stroke="#7890aa" stroke-width="1.7">' +
    '<path d="M465 181 L365 181" fill="none"/><circle cx="465" cy="181" r="4" fill="#347fce" stroke="none"/><text x="354" y="186" text-anchor="end" stroke="none" font-weight="600">Urinary bladder</text>' +
    '<path d="M575 256 L738 256" fill="none"/><circle cx="575" cy="256" r="4" fill="#347fce" stroke="none"/><text x="750" y="261" stroke="none" font-weight="600">Seminal vesicle</text>' +
    '<path d="M450 280 L365 280" fill="none"/><circle cx="450" cy="280" r="4" fill="#347fce" stroke="none"/><text x="354" y="285" text-anchor="end" stroke="none" font-weight="600">Vas deferens</text>' +
    '<path d="M564 311 L738 311" fill="none"/><circle cx="564" cy="311" r="4" fill="#347fce" stroke="none"/><text x="750" y="316" stroke="none" font-weight="600">Prostate gland</text>' +
    '<path d="M503 352 L365 352" fill="none"/><circle cx="503" cy="352" r="4" fill="#347fce" stroke="none"/><text x="354" y="357" text-anchor="end" stroke="none" font-weight="600">Urethra</text>' +
    '<path d="M650 418 L738 418" fill="none"/><circle cx="650" cy="418" r="4" fill="#347fce" stroke="none"/><text x="750" y="423" stroke="none" font-weight="600">Penis</text>' +
    '<path d="M469 485 L365 485" fill="none"/><circle cx="469" cy="485" r="4" fill="#347fce" stroke="none"/><text x="354" y="490" text-anchor="end" stroke="none" font-weight="600">Epididymis</text>' +
    '<path d="M438 505 L365 535" fill="none"/><circle cx="438" cy="505" r="4" fill="#347fce" stroke="none"/><text x="354" y="541" text-anchor="end" stroke="none" font-weight="600">Testis</text>' +
    '<path d="M397 535 L365 572" fill="none"/><circle cx="397" cy="535" r="4" fill="#347fce" stroke="none"/><text x="354" y="578" text-anchor="end" stroke="none" font-weight="600">Scrotum</text>' +
    '<path d="M686 300 L738 350" fill="none"/><circle cx="686" cy="300" r="4" fill="#347fce" stroke="none"/><text x="750" y="357" stroke="none" font-weight="600">Rectum</text></g>' +
    '<text x="500" y="632" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#627991">Illustrative educational anatomy; proportions are simplified.</text></svg>';
  return svg;
}

async function generateConceptDiagram(res, body) {
  const concept = typeof body.concept === 'string' ? body.concept.trim().slice(0, 500) : '';
  if (concept.length < 3) return res.status(400).json({ message: 'Enter a concept to illustrate.' });
  if (/male\s+reproductive|reproductive\s+system\s+in\s+males|human\s+male\s+reproductive|testes|testis|vas\s+deferens/i.test(concept)) {
    return res.status(200).json({ svg: maleReproductiveSystemDiagram(), model: 'StudyPilot educational diagram', fallback: false });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ message: 'AI diagrams are not configured on the server.' });
  const prompt = [
    'Design a polished, colorful, professional educational infographic as a single SVG diagram.',
    'Concept: ' + concept,
    'Identify the correct subject and show the actual parts, stages, components or relationships of this concept. Do not use generic filler labels.',
    'Composition: 900x560 landscape canvas; a neat title area at the top; a central, clearly recognizable diagram or process in the middle; short labels placed beside the correct parts; a compact key takeaway at the bottom.',
    'Use a refined bright palette: deep navy text, vivid blue, teal, coral and warm amber accents on a very pale background. Use rounded cards, consistent spacing, thin connector arrows and small simple vector illustrations made from shapes.',
    'Keep every label readable, aligned and fully inside its card. Avoid overlapping text, clipped objects, excessive decoration and long paragraphs. Put explanations in short, separate callout cards.',
    'Use only these SVG elements: svg, g, rect, circle, ellipse, line, path, polygon, polyline, text, tspan.',
    'Use only basic geometry and text. No CSS, style attributes, scripts, links, images, filters, gradients, animation or external resources.',
    'Return only a complete SVG document with viewBox="0 0 900 560". Include the important parts of the concept, not just a title and three generic boxes.',
    'Keep the diagram scientifically and mathematically accurate. Do not add unsupported facts.'
  ].join('\n');

  const models = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
  let lastMessage = 'The diagram service is temporarily busy. Please try again shortly.';
  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7500);
    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 3000 }
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastMessage = data?.error?.message || 'Gemini is temporarily unavailable.';
        if ([429, 500, 502, 503, 504].includes(response.status)) continue;
        return res.status(response.status).json({ message: lastMessage });
      }
      const candidate = data?.candidates?.[0];
      const raw = candidate?.content?.parts?.map(p => p?.text || '').join('') || '';
      const safeSvg = cleanDiagramSvg(raw);
      const textSvg = safeSvg ? '' : textDiagramFallback(concept, raw);
      const svg = safeSvg || textSvg || basicConceptMap(concept);
      const fallback = !safeSvg;
      if (fallback) console.warn('[StudyPilot Visual] Using safe fallback diagram', {
        model,
        finishReason: candidate?.finishReason || 'NO_CANDIDATE',
        hadText: Boolean(raw && raw.trim())
      });
      return res.status(200).json({ svg, model, fallback, note: fallback ? 'Starter concept map shown because the AI diagram was unavailable.' : undefined });
    } catch (error) {
      lastMessage = error?.name === 'AbortError'
        ? 'The diagram request took too long.'
        : 'Could not connect to the diagram service.';
    } finally {
      clearTimeout(timeout);
    }
  }
  return res.status(503).json({ message: lastMessage + ' Please try again in a little while.' });
}

export const config = { maxDuration: 50 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const requestBody = req.body || {};
    if (requestBody.action === 'concept-diagram') {
      return await generateConceptDiagram(res, requestBody);
    }
    if (requestBody.action === 'exam-questions') {
      return await generateExamQuestions(res, requestBody);
    }
    const { message, history = [] } = requestBody;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ message: 'Message is required.' });
    }

    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      return res.status(503).json({ message: 'AI key is not configured on the server yet.' });
    }

    const contents = Array.isArray(history)
      ? history
          .filter(x => x && (x.role === 'user' || x.role === 'model') && Array.isArray(x.parts))
          .slice(-4)
          .map(x => ({
            role: x.role,
            parts: [{ text: String(x.parts.map(p => p?.text || '').join(' ')).slice(0, 2200) }]
          }))
      : [];

    contents.push({
      role: 'user',
      parts: [{ text: message.slice(0, 5000) }]
    });

    const systemInstruction =
      'You are StudyPilot, a fast and reliable student tutor. ' +
      'StudyPilot is owned and created by Roushan. If anyone asks who owns, created, built, or is the founder of this website or StudyPilot, clearly answer: Roushan is the owner and creator of StudyPilot. Do not name the AI as the owner. ' +
      'Answer directly and clearly using simple language. ' +
      'For math and science, show the essential formula and calculation. ' +
      'For simple questions, keep the answer concise. Never invent facts.';

    // Keep total execution comfortably inside Vercel's function limit.
    // A 404 means a model is unavailable to this API key, so try the next model.
    // Flash-Lite is tuned for low-latency tutoring; keep Flash as a fallback.
    const models = [
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash'
    ];
    let lastMessage = 'The AI service is temporarily busy. Please try again.';

    for (const model of models) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      try {
        const response = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': key
            },
            signal: controller.signal,
            body: JSON.stringify({
              contents,
              systemInstruction: {
                parts: [{ text: systemInstruction }]
              },
              generationConfig: {
                maxOutputTokens: 800,
                temperature: 0.4
              }
            })
          }
        );

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          const answer = data?.candidates?.[0]?.content?.parts
            ?.map(part => part?.text || '')
            ?.join('')
            ?.trim();

          if (answer) return res.status(200).json({ answer, model });
          lastMessage = 'The AI model returned no text' + (data?.candidates?.[0]?.finishReason ? ' (finish reason: ' + data.candidates[0].finishReason + ')' : '') + '. Trying another model.';
          console.error('[StudyPilot AI] Empty model response', { model, finishReason: data?.candidates?.[0]?.finishReason, promptFeedback: data?.promptFeedback?.blockReason });
          continue;
        }

        lastMessage = data?.error?.message || ('Gemini returned HTTP ' + response.status + '.');
        // Model-not-found and temporary capacity errors can be recovered by fallback.
        if ([404, 429, 500, 502, 503, 504].includes(response.status)) continue;

        // Authentication, permission, and request errors need a clear diagnosis.
        return res.status(response.status).json({ message: lastMessage });
      } catch (error) {
        lastMessage = error?.name === 'AbortError'
          ? 'The AI model took too long to respond. Trying another model.'
          : 'Could not connect to the AI service. Trying another model.';
        console.error('[StudyPilot AI] Gemini connection error', { model, name: error?.name, message: String(error?.message || error) });
      } finally {
        clearTimeout(timeout);
      }
    }

    return res.status(503).json({ message: lastMessage });
  } catch (error) {
    return res.status(500).json({
      message: 'Server error while contacting the AI service.'
    });
  }
}
