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
          .slice(-6)
          .map(x => ({
            role: x.role,
            parts: [{ text: String(x.parts.map(p => p?.text || '').join(' ')).slice(0, 3500) }]
          }))
      : [];

    contents.push({
      role: 'user',
      parts: [{ text: message.slice(0, 8000) }]
    });

    const systemInstruction =
      'You are StudyPilot, a fast and reliable student tutor. ' +
      'Answer directly and clearly using simple language. ' +
      'For math and science, show the essential formula and calculation. ' +
      'For simple questions, keep the answer concise. Never invent facts.';

    // Fast, current Gemini models. Try one backup only when capacity is temporary.
    const models = ['gemini-3.1-flash-lite', 'gemini-3.5-flash'];

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
                thinkingConfig: {
                  thinkingLevel: 'minimal'
                },
                maxOutputTokens: 700
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

          continue;
        }

        const googleMessage = data?.error?.message || 'Gemini request failed.';

        // Retry only temporary service pressure.
        if ([429, 500, 502, 503, 504].includes(response.status)) {
          continue;
        }

        return res.status(response.status).json({ message: googleMessage });
      } catch (error) {
        clearTimeout(timeout);
        if (error?.name === 'AbortError') continue;
        return res.status(502).json({ message: 'Temporary connection problem with the AI service.' });
      }
    }

    return res.status(503).json({
      message: 'The AI service is temporarily busy. Please try again.'
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Server error while contacting the AI service.'
    });
  }
}