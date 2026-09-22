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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
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
            parts: [{
              text:
                'You are StudyPilot, a patient expert tutor for school and college students. ' +
                'Answer the student question directly. Show reasoning step by step when useful, ' +
                'use simple language, and never invent an answer. For math and physics, show formulas ' +
                'and calculations. For study requests, teach the student rather than only giving the final answer.'
            }]
          },
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1000
          }
        })
      }
    );

    clearTimeout(timeout);

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        message: data?.error?.message || 'Gemini request failed.'
      });
    }

    const answer = data?.candidates?.[0]?.content?.parts
      ?.map(part => part?.text || '')
      ?.join('')
      ?.trim();

    if (!answer) {
      return res.status(502).json({ message: 'Gemini returned an empty answer.' });
    }

    return res.status(200).json({ answer });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({
        message: 'The AI service took too long to answer. Please try again.'
      });
    }
    return res.status(500).json({
      message: 'Server error while contacting Gemini.'
    });
  }
}