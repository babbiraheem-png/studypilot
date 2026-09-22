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
            const txt = x.parts.map(p => String(p?.text || '')).join(' ').slice(0, 6000);
            return who + ': ' + txt;
          })
          .join('\n')
      : '';

    const input = (prior ? 'Conversation so far:\n' + prior + '\n\n' : '') +
      'Student: ' + message.slice(0, 10000);

    const models = [
      'models/gemini-3.1-flash-lite',
      'models/gemini-3.5-flash-lite',
      'models/gemini-3.6-flash',
      'models/gemini-3.5-flash'
    ];

    const systemInstruction =
      'You are StudyPilot, a patient expert tutor for school and college students. ' +
      'Answer the student question directly. Show reasoning step by step when useful, ' +
      'use simple language, and never invent an answer. For math and physics, show formulas ' +
      'and calculations. For study requests, teach the student rather than only giving the final answer.';

    let lastError = 'The AI service is temporarily busy.';

    for (const model of models) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
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
              model,
              input,
              system_instruction: systemInstruction,
              store: false,
              generation_config: {
                thinking_level: 'minimal',
                max_output_tokens: 900
              }
            })
          }
        );

        clearTimeout(timeout);
        const data = await response.json();

        if (response.ok) {
          const answer = data?.steps
            ?.filter(step => step?.type === 'model_output')
            ?.flatMap(step => step?.content || [])
            ?.filter(block => block?.type === 'text')
            ?.map(block => block.text || '')
            ?.join('')
            ?.trim();

          if (answer) {
            return res.status(200).json({ answer, model });
          }

          lastError = 'The AI returned an empty answer.';
          continue;
        }

        lastError = data?.error?.message || ('Gemini request failed on ' + model + '.');

        // Retry another model for temporary capacity/rate-limit/server errors.
        if ([429, 500, 502, 503, 504].includes(response.status)) {
          continue;
        }

        // Do not hide auth/configuration errors.
        return res.status(response.status).json({ message: lastError });
      } catch (error) {
        clearTimeout(timeout);
        lastError = error?.name === 'AbortError'
          ? 'The model timed out; trying a backup model.'
          : 'Temporary AI connection problem; trying a backup model.';
        continue;
      }
    }

    return res.status(503).json({
      message: lastError || 'Google is currently busy on the available Gemini models.'
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Server error while contacting the AI service.'
    });
  }
}