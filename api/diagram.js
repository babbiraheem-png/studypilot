const ALLOWED_TAGS = new Set(['svg','g','rect','circle','ellipse','line','path','polygon','polyline','text','tspan']);
const ALLOWED_ATTRS = new Set(['xmlns','viewBox','width','height','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','d','points','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','font-size','font-family','font-weight','text-anchor','dominant-baseline','opacity','transform']);
function cleanSvg(raw) {
  let svg = String(raw || '').replace(/```(?:svg|xml)?/gi, '').replace(/```/g, '').trim();
  const start = svg.indexOf('<svg'), end = svg.lastIndexOf('</svg>');
  if (start < 0 || end < start) return '';
  svg = svg.slice(start, end + 6);
  if (svg.length > 12000 || /<script|foreignObject|image|use\s|href\s*=|url\s*\(|on\w+\s*=/i.test(svg)) return '';
  const tags = svg.match(/<\/?[a-zA-Z][^>]*>/g) || [];
  if (!tags.length || tags.some(tag => !ALLOWED_TAGS.has((tag.match(/^<\/?([a-zA-Z]+)/)||[])[1]))) return '';
  const attrs = [...svg.matchAll(/\s([a-zA-Z:-]+)\s*=/g)].map(m => m[1]);
  if (attrs.some(a => !ALLOWED_ATTRS.has(a))) return '';
  return svg;
}
export const config = { maxDuration: 35 };
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });
  const concept = typeof req.body?.concept === 'string' ? req.body.concept.trim().slice(0, 500) : '';
  if (concept.length < 3) return res.status(400).json({ message: 'Enter a concept to illustrate.' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ message: 'AI image diagrams are not configured on the server.' });
  const prompt = [
    'Create one clear, accurate, student-friendly educational vector diagram as SVG.',
    'Concept: ' + concept,
    'Infer the school subject and explain the concept visually. Use simple labels, arrows and shapes where useful.',
    'Use a clean white background, dark readable labels and a few blue accents. Keep all content inside a 900 by 560 canvas.',
    'Use only these SVG elements: svg, g, rect, circle, ellipse, line, path, polygon, polyline, text, tspan.',
    'Use only basic geometry and text. No CSS, style attributes, scripts, links, images, filters, gradients, animation or external resources.',
    'Return only a complete SVG document with viewBox="0 0 900 560". Make labels concise and readable.',
    'Keep the diagram scientifically and mathematically accurate. Do not add unsupported facts.'
  ].join('\n');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 26000);
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 3000 }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json({ message: data?.error?.message || 'The diagram service is temporarily unavailable.' });
    const raw = data?.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join('') || '';
    const svg = cleanSvg(raw);
    if (!svg) return res.status(502).json({ message: 'The AI could not create a safe diagram this time. Please try a shorter concept.' });
    return res.status(200).json({ svg, model: 'gemini-3.5-flash-lite' });
  } catch (error) {
    return res.status(503).json({ message: error?.name === 'AbortError' ? 'Diagram creation took too long. Please try again.' : 'Could not connect to the diagram service.' });
  } finally {
    clearTimeout(timeout);
  }
}
