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


function maleReproductiveSystemDiagram() { return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1200 760\" width=\"1200\" height=\"760\">\n<defs>\n <linearGradient id=\"canvas\" x2=\"0\" y2=\"1\"><stop stop-color=\"#ffffff\"/><stop offset=\"1\" stop-color=\"#f0f6fc\"/></linearGradient>\n <linearGradient id=\"softTissue\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop stop-color=\"#f8d8ca\"/><stop offset=\".48\" stop-color=\"#e9b0a1\"/><stop offset=\"1\" stop-color=\"#c9827c\"/></linearGradient>\n <linearGradient id=\"bladderFill\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop stop-color=\"#ffe7ae\"/><stop offset=\".55\" stop-color=\"#edc77e\"/><stop offset=\"1\" stop-color=\"#d49b55\"/></linearGradient>\n <linearGradient id=\"glandFill\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop stop-color=\"#e9a8a6\"/><stop offset=\"1\" stop-color=\"#bd6f7a\"/></linearGradient>\n <linearGradient id=\"testisFill\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop stop-color=\"#f9e0b8\"/><stop offset=\"1\" stop-color=\"#d9a27d\"/></linearGradient>\n <filter id=\"cardShadow\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feDropShadow dx=\"0\" dy=\"5\" stdDeviation=\"8\" flood-color=\"#24476a\" flood-opacity=\".12\"/></filter>\n</defs>\n<rect width=\"1200\" height=\"760\" rx=\"28\" fill=\"url(#canvas)\"/>\n<rect x=\"30\" y=\"26\" width=\"1140\" height=\"100\" rx=\"22\" fill=\"#153a69\"/>\n<text x=\"66\" y=\"69\" font-family=\"Arial,sans-serif\" font-size=\"32\" font-weight=\"700\" fill=\"#ffffff\">Male reproductive system</text>\n<text x=\"66\" y=\"99\" font-family=\"Arial,sans-serif\" font-size=\"16\" fill=\"#dcecff\">Medical-textbook style side view • educational schematic • not to scale</text>\n<rect x=\"45\" y=\"150\" width=\"1110\" height=\"550\" rx=\"24\" fill=\"#ffffff\" stroke=\"#dce8f4\" filter=\"url(#cardShadow)\"/>\n<!-- Main sagittal anatomy, anterior to left and posterior to right -->\n<g stroke-linecap=\"round\" stroke-linejoin=\"round\">\n <!-- rectum, posterior -->\n <path d=\"M844 256 C879 294 881 335 865 376 C850 414 855 456 882 491\" fill=\"none\" stroke=\"#d99191\" stroke-width=\"42\" opacity=\".58\"/>\n <path d=\"M844 256 C879 294 881 335 865 376 C850 414 855 456 882 491\" fill=\"none\" stroke=\"#f6c9c2\" stroke-width=\"13\" opacity=\".8\"/>\n <!-- urinary bladder -->\n <path d=\"M538 228 C507 197 519 164 559 157 C600 149 662 157 681 188 C699 217 681 253 654 270 C622 290 572 279 548 257 C541 249 537 239 538 228Z\" fill=\"url(#bladderFill)\" stroke=\"#bd8b4c\" stroke-width=\"4\"/>\n <path d=\"M554 187 C578 168 632 169 656 190\" fill=\"none\" stroke=\"#fff4d7\" stroke-width=\"8\" opacity=\".8\"/>\n <!-- vas deferens, rising from epididymis and looping toward seminal vesicle -->\n <path d=\"M445 542 C426 504 431 466 451 429 C475 385 496 353 494 317 C492 282 507 258 536 247\" fill=\"none\" stroke=\"#d5a04d\" stroke-width=\"13\"/>\n <path d=\"M445 542 C426 504 431 466 451 429 C475 385 496 353 494 317 C492 282 507 258 536 247\" fill=\"none\" stroke=\"#fff0c5\" stroke-width=\"4\"/>\n <!-- seminal vesicle, behind bladder -->\n <path d=\"M697 277 C715 255 745 259 752 281 C759 302 740 324 717 320 C697 317 685 296 697 277Z\" fill=\"#c98698\" stroke=\"#985a76\" stroke-width=\"3.5\"/>\n <path d=\"M703 282 C718 270 737 277 742 289 M701 296 C716 286 735 293 741 304\" fill=\"none\" stroke=\"#f7dbe3\" stroke-width=\"4\"/>\n <!-- ejaculatory duct joining urethra -->\n <path d=\"M711 317 C693 337 668 344 642 346\" fill=\"none\" stroke=\"#c98698\" stroke-width=\"7\"/>\n <!-- prostate below bladder -->\n <path d=\"M568 300 C586 280 645 280 668 302 C687 321 679 354 656 371 C631 389 588 382 567 360 C551 344 553 317 568 300Z\" fill=\"url(#glandFill)\" stroke=\"#995c68\" stroke-width=\"4\"/>\n <path d=\"M581 310 C603 294 644 297 661 314\" fill=\"none\" stroke=\"#f5c9c5\" stroke-width=\"5\"/>\n <!-- urethra from bladder through prostate, then along penis -->\n <path d=\"M608 266 C608 286 608 301 608 321 C608 347 606 370 590 393 C565 425 519 438 473 444\" fill=\"none\" stroke=\"#f6e6b1\" stroke-width=\"12\"/>\n <path d=\"M608 266 C608 286 608 301 608 321 C608 347 606 370 590 393 C565 425 519 438 473 444\" fill=\"none\" stroke=\"#a47a3e\" stroke-width=\"2.5\"/>\n <!-- penis: external organ, anterior -->\n <path d=\"M473 416 C430 398 379 398 333 410 C310 416 296 432 304 450 C312 468 338 474 365 471 C409 467 449 460 482 451 C496 447 498 425 473 416Z\" fill=\"url(#softTissue)\" stroke=\"#b87870\" stroke-width=\"4\"/>\n <path d=\"M329 424 C367 411 420 414 458 427\" fill=\"none\" stroke=\"#ffe7dc\" stroke-width=\"6\" opacity=\".85\"/>\n <!-- scrotum -->\n <path d=\"M394 543 C392 502 416 477 452 482 C489 487 512 519 501 560 C492 598 464 624 430 614 C405 607 391 578 394 543Z\" fill=\"url(#softTissue)\" stroke=\"#b87870\" stroke-width=\"4\"/>\n <path d=\"M449 489 C440 519 440 572 452 603\" fill=\"none\" stroke=\"#b87570\" stroke-width=\"2.5\" opacity=\".65\"/>\n <!-- testis -->\n <ellipse cx=\"440\" cy=\"553\" rx=\"27\" ry=\"39\" transform=\"rotate(10 440 553)\" fill=\"url(#testisFill)\" stroke=\"#b27b5e\" stroke-width=\"3.5\"/>\n <path d=\"M425 529 C439 517 455 535 458 551\" fill=\"none\" stroke=\"#fff0d8\" stroke-width=\"5\"/>\n <!-- epididymis along back edge of testis -->\n <path d=\"M464 519 C483 531 482 550 471 566 C464 578 462 589 450 596\" fill=\"none\" stroke=\"#b86e58\" stroke-width=\"9\"/>\n <path d=\"M464 519 C483 531 482 550 471 566 C464 578 462 589 450 596\" fill=\"none\" stroke=\"#f2c2a9\" stroke-width=\"3\"/>\n</g>\n<!-- Label callouts: carefully separated left and right columns -->\n<g font-family=\"Arial,sans-serif\" font-size=\"17\" fill=\"#203b5c\" stroke=\"#7790aa\" stroke-width=\"2\">\n <path d=\"M538 208 L390 208 L360 208\" fill=\"none\"/><circle cx=\"538\" cy=\"208\" r=\"4.5\" fill=\"#347fce\" stroke=\"none\"/><text x=\"348\" y=\"214\" text-anchor=\"end\" stroke=\"none\" font-weight=\"600\">Urinary bladder</text>\n <path d=\"M494 322 L390 322 L360 322\" fill=\"none\"/><circle cx=\"494\" cy=\"322\" r=\"4.5\" fill=\"#347fce\" stroke=\"none\"/><text x=\"348\" y=\"328\" text-anchor=\"end\" stroke=\"none\" font-weight=\"600\">Vas deferens</text>\n <path d=\"M589 344 L390 390 L360 390\" fill=\"none\"/><circle cx=\"589\" cy=\"344\" r=\"4.5\" fill=\"#347fce\" stroke=\"none\"/><text x=\"348\" y=\"396\" text-anchor=\"end\" stroke=\"none\" font-weight=\"600\">Prostate gland</text>\n <path d=\"M590 400 L390 455 L360 455\" fill=\"none\"/><circle cx=\"590\" cy=\"400\" r=\"4.5\" fill=\"#347fce\" stroke=\"none\"/><text x=\"348\" y=\"461\" text-anchor=\"end\" stroke=\"none\" font-weight=\"600\">Urethra</text>\n <path d=\"M333 439 L255 439\" fill=\"none\"/><circle cx=\"333\" cy=\"439\" r=\"4.5\" fill=\"#347fce\" stroke=\"none\"/><text x=\"243\" y=\"445\" text-anchor=\"end\" stroke=\"none\" font-weight=\"600\">Penis</text>\n <path d=\"M717 288 L840 245 L870 245\" fill=\"none\"/><circle cx=\"717\" cy=\"288\" r=\"4.5\" fill=\"#347fce\" stroke=\"none\"/><text x=\"882\" y=\"251\" stroke=\"none\" font-weight=\"600\">Seminal vesicle</text>\n <path d=\"M865 375 L870 375\" fill=\"none\"/><circle cx=\"865\" cy=\"375\" r=\"4.5\" fill=\"#347fce\" stroke=\"none\"/><text x=\"882\" y=\"381\" stroke=\"none\" font-weight=\"600\">Rectum</text>\n <path d=\"M472 551 L840 520 L870 520\" fill=\"none\"/><circle cx=\"472\" cy=\"551\" r=\"4.5\" fill=\"#347fce\" stroke=\"none\"/><text x=\"882\" y=\"526\" stroke=\"none\" font-weight=\"600\">Epididymis</text>\n <path d=\"M440 553 L840 570 L870 570\" fill=\"none\"/><circle cx=\"440\" cy=\"553\" r=\"4.5\" fill=\"#347fce\" stroke=\"none\"/><text x=\"882\" y=\"576\" stroke=\"none\" font-weight=\"600\">Testis</text>\n <path d=\"M399 576 L840 620 L870 620\" fill=\"none\"/><circle cx=\"399\" cy=\"576\" r=\"4.5\" fill=\"#347fce\" stroke=\"none\"/><text x=\"882\" y=\"626\" stroke=\"none\" font-weight=\"600\">Scrotum</text>\n</g>\n<rect x=\"80\" y=\"660\" width=\"1040\" height=\"24\" rx=\"10\" fill=\"#eaf3fc\"/>\n<text x=\"600\" y=\"677\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" font-size=\"13\" fill=\"#526b84\">Educational schematic: structures are simplified and not drawn to exact anatomical scale.</text>\n</svg>"; }

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
    'Composition: 900x560 landscape canvas with fixed safe margins. Put the title in a top band, ONE main illustration or connected diagram in the center, and a short takeaway in a bottom band.',
    'ALIGNMENT IS CRITICAL: arrange related parts together as one coherent, correctly proportioned composition. Keep the main subject centered and large. Align labels in tidy left/right columns or a consistent grid. Use equal spacing, consistent baselines and straight, non-crossing leader lines that end at the exact part being named.',
    'Do not scatter components around the canvas. Do not place labels far from their parts. Do not let labels, leader lines, arrows, cards or illustrations overlap. Keep every element fully inside the viewBox with generous margins.',
    'Choose the correct layout for the subject: anatomy uses one unified front/side/cross-section view with organs in their correct relative positions and labels around the outside; a process uses one connected, evenly spaced sequence; a cycle uses a balanced circular arrangement; a comparison uses aligned columns; a graph uses correctly aligned axes and plotted data; a geography concept uses one coherent map.',
    'Use a refined bright palette: deep navy text, vivid blue, teal, coral and warm amber accents on a very pale background. Keep colors consistent by category and use short labels, not paragraphs.',
    'Use only these SVG elements: svg, g, rect, circle, ellipse, line, path, polygon, polyline, text, tspan.',
    'Use only basic geometry and text. No CSS, style attributes, scripts, links, images, filters, gradients, animation or external resources.',
    'Return only a complete SVG document with viewBox="0 0 900 560". Include the actual important parts of the concept, not generic filler cards or a text-only explanation.',
    'Keep the diagram scientifically and mathematically accurate. Do not add unsupported facts.'
  ].join('\n');

  const models = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
  let lastMessage = 'The diagram service is temporarily busy. Please try again shortly.';
  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 11000);
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
      // Never turn a failed image request into a wall of sentences.
      // Keep the fallback as a clean, aligned visual layout instead.
      const svg = safeSvg || basicConceptMap(concept);
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
