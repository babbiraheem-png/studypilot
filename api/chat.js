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
  const allowedAttrs = new Set(['xmlns','viewBox','width','height','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','d','points','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','font-size','font-family','font-weight','text-anchor','dominant-baseline','opacity','transform']);
  let svg = String(raw || '').replace(/```(?:svg|xml)?/gi, '').replace(/```/g, '').trim();
  const start = svg.indexOf('<svg'), end = svg.lastIndexOf('</svg>');
  if (start < 0 || end < start) return '';
  svg = svg.slice(start, end + 6);
  if (svg.length > 12000 || /<script|foreignObject|image|use\\s|href\\s*=|url\\s*\\(|on\\w+\\s*=/i.test(svg)) return '';
  const tags = svg.match(/<\\/?[a-zA-Z][^>]*>/g) || [];
  if (!tags.length || tags.some(tag => !allowedTags.has((tag.match(/^<\\/?([a-zA-Z]+)/)||[])[1]))) return '';
  const attrs = [...svg.matchAll(/\\s([a-zA-Z:-]+)\\s*=/g)].map(m => m[1]);
  if (attrs.some(a => !allowedAttrs.has(a))) return '';
  return svg;
}
async function generateConceptDiagram(res, body) {
  const concept = typeof body.concept === 'string' ? body.concept.trim().slice(0, 500) : '';
  if (concept.length < 3) return res.status(400).json({ message: 'Enter a concept to illustrate.' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ message: 'AI diagrams are not configured on the server.' });
  const prompt = [
    'Create one clear, accurate, student-friendly educational vector diagram as SVG.',
    'Concept: ' + concept,
    'Infer the school subject and explain the concept visually. Use simple labels, arrows and shapes where useful.',
    'Use a clean white background, dark readable labels and a few blue accents. Keep all content inside a 900 by 560 canvas.',
    'Use only these SVG elements: svg, g, rect, circle, ellipse, line, path, polygon, polyline, text, tspan.',
    'Use only basic geometry and text. No CSS, style attributes, scripts, links, images, filters, gradients, animation or external resources.',
    'Return only a complete SVG document with viewBox="0 0 900 560". Make labels concise and readable.',
    'Keep the diagram scientifically and mathematically accurate. Do not add unsupported facts.'
  ].join('\\n');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 26000);
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      signal: controller.signal,
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 3000 } })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json({ message: data?.error?.message || 'The diagram service is temporarily unavailable.' });
    const raw = data?.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join('') || '';
    const svg = cleanDiagramSvg(raw);
    if (!svg) return res.status(502).json({ message: 'The AI could not create a safe diagram this time. Please try a shorter concept.' });
    return res.status(200).json({ svg, model: 'gemini-3.5-flash-lite' });
  } catch (error) {
    return res.status(503).json({ message: error?.name === 'AbortError' ? 'Diagram creation took too long. Please try again.' : 'Could not connect to the diagram service.' });
  } finally {
    clearTimeout(timeout);
  }
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
      const timeout = setTimeout(() => controller.abort(), 12000);

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
