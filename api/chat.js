export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const { message, history = [] } = req.body || {};
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
          .slice(-10)
          .map(x => ({
            role: x.role,
            parts: x.parts.map(p => ({ text: String(p?.text || '').slice(0, 6000) }))
          }))
      : [];

    contents.push({
      role: 'user',
      parts: [{ text: message.slice(0, 10000) }]
    });

    const systemText =
      'You are StudyPilot, a patient expert tutor for school and college students. ' +
      'Answer the student question directly. Show reasoning step by step when useful, ' +
      'use simple language, and never invent an answer. For math and physics, show formulas ' +
      'and calculations. For study requests, teach the student rather than only giving the final answer.';

    // Use a fast, stable model first, then automatically fall back if Google reports
    // temporary overload / quota pressure. All listed models are current stable Gemini models.
    const models = [
      'gemini-3.5-flash-lite',
      'gemini-3.6-flash',
      'gemini-2.5-flash-lite'
    ];

    let lastMessage = 'The AI service is temporarily busy. Please try again in a moment.';

    for (const model of models) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 18000);

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
                parts: [{ text: systemText }]
              },
              generationConfig: {
                maxOutputTokens: 900
              }
            })
          }
        );

        clearTimeout(timeout);
        const data = await response.json();

        if (response.ok) {
          const answer = data?.candidates?.[0]?.content?.parts
            ?.map(part => part?.text || '')
            ?.join('')
            ?.trim();

          if (answer) {
            return res.status(200).json({ answer, model });
          }
          lastMessage = 'The AI returned an empty answer. Please try again.';
          continue;
        }

        lastMessage = data?.error?.message || ('Gemini request failed on ' + model + '.');

        // Fall through to the next model only for temporary capacity/rate-limit errors.
        if (response.status === 429 || response.status === 500 || response.status === 502 || response.status === 503 || response.status === 504) {
          continue;
        }

        // Authentication/configuration errors should not be hidden by fallback.
        return res.status(response.status).json({ message: lastMessage });
      } catch (error) {
        clearTimeout(timeout);
        if (error?.name === 'AbortError') {
          lastMessage = 'The AI model timed out. Trying a faster backup model…';
          continue;
        }
        lastMessage = 'Temporary AI connection problem. Trying a backup model…';
        continue;
      }
    }

    return res.status(503).json({
      message: 'Google is currently busy on the available free-tier models. StudyPilot tried multiple backup models automatically. Please try again shortly.'
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Server error while contacting the AI service.'
    });
  }
}