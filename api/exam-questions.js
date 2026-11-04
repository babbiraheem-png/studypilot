export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const body = req.body || {};
    const studentClass = Number(body.studentClass);
    const subject = String(body.subject || '').trim().slice(0, 80);
    const topics = Array.isArray(body.topics)
      ? body.topics.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean).slice(0, 8)
      : [];
    const stage = String(body.stage || 'chapter practice').trim().slice(0, 120);
    const recentQuestions = Array.isArray(body.recentQuestions)
      ? body.recentQuestions.filter(x => typeof x === 'string').map(x => x.trim().slice(0, 240)).filter(Boolean).slice(-30)
      : [];

    if (!Number.isInteger(studentClass) || studentClass < 6 || studentClass > 12) {
      return res.status(400).json({ message: 'Choose a class between 6 and 12.' });
    }
    if (!subject || !topics.length) {
      return res.status(400).json({ message: 'Choose a subject and add at least one syllabus topic.' });
    }

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
    ].join('\n');

    const models = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];
    let lastMessage = 'The AI could not create a verified question set.';

    for (const model of models) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 18000);

      try {
        const response = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              systemInstruction: {
                parts: [{ text: 'You write accurate school exam practice. Return strict JSON only. Never invent ambiguous questions or unsupported facts.' }]
              },
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.75,
                maxOutputTokens: 1500
              }
            })
          }
        );

        clearTimeout(timeout);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          lastMessage = data?.error?.message || 'The question service returned an error.';
          if ([429, 500, 502, 503, 504].includes(response.status)) continue;
          return res.status(response.status).json({ message: lastMessage });
        }

        const raw = data?.candidates?.[0]?.content?.parts?.map(x => x?.text || '').join('').trim();
        if (!raw) {
          lastMessage = 'The AI returned an empty question set.';
          continue;
        }

        let parsed;
        try {
          const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
          parsed = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
        } catch {
          lastMessage = 'The AI response was not valid question data.';
          continue;
        }

        const source = Array.isArray(parsed?.questions) ? parsed.questions : [];
        const clean = source.map(item => {
          if (!item || typeof item !== 'object') return null;
          const topic = String(item.topic || '').trim();
          const question = String(item.question || '').trim();
          const answer = String(item.answer || '').trim();
          const solution = String(item.solution || '').trim();
          const marks = Number(item.marks || 2);
          if (
            !topics.some(t => t.toLowerCase() === topic.toLowerCase()) ||
            question.length < 12 || question.length > 650 ||
            answer.length < 1 || answer.length > 450 ||
            solution.length < 8 || solution.length > 900 ||
            !Number.isInteger(marks) || marks < 1 || marks > 6
          ) return null;
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

        if (unique.length < 3) {
          lastMessage = 'The generated questions repeated earlier questions. Please try again.';
          continue;
        }

        return res.status(200).json({ questions: unique.slice(0, 3), model });
      } catch (error) {
        clearTimeout(timeout);
        lastMessage = error?.name === 'AbortError'
          ? 'Question generation took too long. Please try again.'
          : 'The question service is temporarily unavailable.';
      }
    }

    return res.status(503).json({ message: lastMessage });
  } catch (error) {
    return res.status(500).json({ message: 'Server error while generating exam questions.' });
  }
}
