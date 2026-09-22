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
      ? history.filter(x => x && (x.role === 'user' || x.role === 'model') && Array.isArray(x.parts))
      : [];
    contents.push({ role: 'user', parts: [{ text: message.slice(0, 10000) }] });

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key
        },
        body: JSON.stringify({
          contents,
          systemInstruction: {
            parts: [{
              text: 'You are StudyPilot, a patient expert tutor for school and college students. Answer the student question directly. Show reasoning step by step when useful, use simple language, and never invent an answer. For math and physics, show formulas and calculations. For study requests, teach the student rather than only giving the final answer.'
            }]
          },
          generationConfig: {
            temperature: 0.25,
            maxOutputTokens: 1400
          }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        message: data?.error?.message || 'Gemini request failed.'
      });
    }

    const answer = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    if (!answer) return res.status(502).json({ message: 'Gemini returned an empty answer.' });

    return res.status(200).json({ answer });
  } catch (error) {
    return res.status(500).json({ message: 'Server error. Please try again.' });
  }
}