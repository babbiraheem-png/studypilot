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

    const prior = Array.isArray(history)
      ? history
          .filter(x => x && (x.role === 'user' || x.role === 'model') && Array.isArray(x.parts))
          .slice(-10)
          .map(x => {
            const who = x.role === 'user' ? 'Student' : 'Tutor';
            const txt = x.parts.map(p => p?.text || '').join(' ').slice(0, 6000);
            return who + ': ' + txt;
          })
          .join('\n')
      : '';

    const input = (prior ? 'Conversation so far:\n' + prior + '\n\n' : '') +
      'Student: ' + message.slice(0, 10000);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'models/gemini-3.6-flash',
          system_instruction:
            'You are StudyPilot, a patient expert tutor for school and college students. ' +
            'Answer the student question directly. Show reasoning step by step when useful, ' +
            'use simple language, and never invent an answer. For math and physics, show formulas ' +
            'and calculations. For study requests, teach the student rather than only giving the final answer.',
          input,
          generation_config: {
            thinking_level: 'minimal',
            max_output_tokens: 1200
          }
        })
      }
    );

    clearTimeout(timeout);
    const data = await response.json();

    if (!response.ok) {
      const googleMessage = data?.error?.message || 'Gemini request failed.';
      if (data?.error?.details?.some?.(d => d?.reason === 'API_KEY_INVALID')) {
        return res.status(502).json({
          message: 'Google rejected the Gemini API key. Please create a fresh AI Studio key and replace GEMINI_API_KEY in Vercel.'
        });
      }
      return res.status(response.status).json({ message: googleMessage });
    }

    const answer = data?.steps
      ?.filter(step => step?.type === 'model_output')
      ?.flatMap(step => step?.content || [])
      ?.filter(block => block?.type === 'text')
      ?.map(block => block.text || '')
      ?.join('')
      ?.trim();

    if (!answer) {
      return res.status(502).json({ message: 'Gemini returned an empty answer.' });
    }

    return res.status(200).json({ answer });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.status(504).json({ message: 'The AI took too long to respond. Please try again.' });
    }
    return res.status(500).json({ message: 'Server error while contacting Gemini.' });
  }
}