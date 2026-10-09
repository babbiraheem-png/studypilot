const MODEL = 'veo-3.1-lite-generate-preview';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_PROMPT_LENGTH = 1800;

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(body);
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const item = raw.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  if (!item) return null;
  try { return decodeURIComponent(item.slice(name.length + 1)); } catch { return null; }
}

function operationIsValid(value) {
  return typeof value === 'string' &&
    value.length < 300 &&
    /^(?:models\/veo-3\.1-lite-generate-preview\/)?operations\/[A-Za-z0-9_-]+$/.test(value);
}

function configState() {
  return {
    enabled: process.env.VIDEO_GENERATION_ENABLED === 'true' &&
      Boolean(process.env.VIDEO_GEMINI_API_KEY) &&
      Boolean(process.env.SUPABASE_URL) &&
      Boolean(process.env.SUPABASE_PUBLISHABLE_KEY) &&
      Boolean(process.env.VIDEO_ALLOWED_EMAILS)
  };
}

async function authorizedUser(req) {
  const state = configState();
  if (!state.enabled) return { ok: false, status: 503, message: 'Video generation is disabled until the owner configures and enables the paid video API.' };

  const accessToken = getCookie(req, 'studypilot_access_token');
  const bearer = (req.headers.authorization || '').startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = accessToken || bearer;
  if (!token) return { ok: false, status: 401, message: 'Sign in to an approved StudyPilot account to generate videos.' };

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });
    const result = await sb.auth.getUser(token);
    const email = result.data?.user?.email?.trim().toLowerCase();
    if (result.error || !email) return { ok: false, status: 401, message: 'Your session is invalid or expired. Please sign in again.' };

    const allowlist = process.env.VIDEO_ALLOWED_EMAILS.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    if (!allowlist.includes(email)) return { ok: false, status: 403, message: 'Video generation is currently restricted to the owner-approved test accounts.' };
    return { ok: true, email };
  } catch {
    return { ok: false, status: 503, message: 'Video account verification is temporarily unavailable.' };
  }
}

async function googleFetch(path, options = {}) {
  const key = process.env.VIDEO_GEMINI_API_KEY;
  return fetch(API_BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': key,
      ...(options.headers || {})
    }
  });
}

export default async function handler(req, res) {
  const action = req.method === 'GET' ? String(req.query?.action || 'health') : String(req.body?.action || '');
  const configured = configState().enabled;

  if (req.method === 'GET' && action === 'health') {
    return json(res, 200, {
      enabled: configured,
      model: 'Veo 3.1 Lite · 720p',
      message: configured
        ? 'Paid video generation is enabled for approved accounts.'
        : 'Video generation is safely disabled. Owner configuration and explicit enablement are required.'
    });
  }

  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { message: 'Method not allowed.' });
  }

  const auth = await authorizedUser(req);
  if (!auth.ok) return json(res, auth.status, { message: auth.message });

  try {
    if (req.method === 'POST' && action === 'start') {
      const { prompt, topic } = req.body || {};
      if (typeof topic !== 'string' || topic.trim().length < 3 || topic.trim().length > 120) {
        return json(res, 400, { message: 'Enter a topic between 3 and 120 characters.' });
      }
      if (typeof prompt !== 'string' || prompt.trim().length < 20 || prompt.trim().length > MAX_PROMPT_LENGTH) {
        return json(res, 400, { message: 'The scene prompt is invalid.' });
      }

      const safePrompt = [
        'Create one short, child-safe, educational animated explainer clip for a school lesson.',
        'Visual style: polished 2D/3D educational animation, clear simple shapes, friendly colors, smooth camera movement, scientifically accurate visuals, 16:9 landscape, 720p.',
        'Avoid legible on-screen text, logos, watermarks, frightening imagery, or unsupported scientific claims. Leave space for captions to be added by the learning app.',
        'Topic: ' + topic.trim(),
        'Scene direction: ' + prompt.trim()
      ].join('\n');

      const response = await googleFetch('/models/' + MODEL + ':predictLongRunning', {
        method: 'POST',
        body: JSON.stringify({
          instances: [{ prompt: safePrompt }],
          parameters: { aspectRatio: '16:9', resolution: '720p', sampleCount: 1 }
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const status = response.status === 429 ? 429 : response.status >= 500 ? 503 : 502;
        return json(res, status, {
          message: response.status === 429
            ? 'The video provider rate limit was reached. No clip was started; please wait before trying again.'
            : 'The video provider could not start this clip. Check the video API project, billing, and model access.',
          providerStatus: response.status
        });
      }
      const operation = data?.name;
      if (!operationIsValid(operation)) return json(res, 502, { message: 'The video provider returned an unexpected job identifier.' });
      return json(res, 202, { operation, status: 'processing' });
    }

    if (req.method === 'GET' && action === 'status') {
      const operation = String(req.query?.operation || '');
      if (!operationIsValid(operation)) return json(res, 400, { message: 'Invalid video job identifier.' });
      const response = await googleFetch('/' + operation, { method: 'GET', headers: {} });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return json(res, response.status === 404 ? 404 : 503, { message: 'Could not check the video job status.' });
      if (!data.done) return json(res, 200, { done: false, status: 'processing' });
      if (data.error) return json(res, 200, { done: true, error: 'The video provider could not complete this scene.' });
      const sample = data?.response?.generateVideoResponse?.generatedSamples?.[0];
      if (!sample?.video?.uri) return json(res, 200, { done: true, error: 'The provider finished but did not return a playable clip.' });
      return json(res, 200, { done: true, status: 'completed', videoUrl: '/api/video?action=download&operation=' + encodeURIComponent(operation) });
    }

    if (req.method === 'GET' && action === 'download') {
      const operation = String(req.query?.operation || '');
      if (!operationIsValid(operation)) return json(res, 400, { message: 'Invalid video job identifier.' });
      const statusResponse = await googleFetch('/' + operation, { method: 'GET', headers: {} });
      const statusData = await statusResponse.json().catch(() => ({}));
      const uri = statusData?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!statusResponse.ok || !statusData.done || !uri) return json(res, 409, { message: 'This video clip is not ready to play yet.' });

      // The provider URL is obtained from Google's trusted operation response, never from client input.
      const videoResponse = await fetch(uri, { headers: { 'x-goog-api-key': process.env.VIDEO_GEMINI_API_KEY } });
      if (!videoResponse.ok || !videoResponse.body) return json(res, 502, { message: 'The generated clip could not be retrieved from the provider.' });
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', videoResponse.headers.get('content-type') || 'video/mp4');
      res.setHeader('Content-Disposition', 'inline; filename="studypilot-scene.mp4"');
      if (videoResponse.headers.get('content-length')) res.setHeader('Content-Length', videoResponse.headers.get('content-length'));
      if (typeof videoResponse.body.pipe === 'function') return videoResponse.body.pipe(res);
      const bytes = Buffer.from(await videoResponse.arrayBuffer());
      return res.status(200).send(bytes);
    }

    return json(res, 400, { message: 'Unknown video action.' });
  } catch {
    return json(res, 503, { message: 'The video service is temporarily unavailable. No API key or provider details were exposed.' });
  }
}
