import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SITE_ORIGIN = 'https://studypilot-flax.vercel.app';

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(body);
}

function setSessionCookies(res, session) {
  const base = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000';
  res.setHeader('Set-Cookie', [
    `studypilot_access_token=${encodeURIComponent(session.access_token)}; ${base}`,
    `studypilot_refresh_token=${encodeURIComponent(session.refresh_token)}; ${base}`
  ]);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { message: 'Method not allowed.' });
  }

  const origin = req.headers.origin;
  if (origin && origin !== SITE_ORIGIN) {
    return json(res, 403, { message: 'This sign-in request was not accepted.' });
  }

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return json(res, 503, { message: 'The account service is not configured.' });
  }

  const accessToken = typeof req.body?.access_token === 'string' ? req.body.access_token : '';
  const refreshToken = typeof req.body?.refresh_token === 'string' ? req.body.refresh_token : '';
  if (!accessToken || !refreshToken || accessToken.length > 8192 || refreshToken.length > 8192) {
    return json(res, 400, { message: 'Google sign-in could not be completed. Please try again.' });
  }

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });

    const { data, error } = await sb.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    if (error || !data?.session) {
      return json(res, 401, { message: 'Your Google sign-in session could not be verified. Please try again.' });
    }

    const verified = await sb.auth.getUser(data.session.access_token);
    if (verified.error || !verified.data?.user) {
      return json(res, 401, { message: 'Your Google sign-in session could not be verified. Please try again.' });
    }

    setSessionCookies(res, data.session);
    return json(res, 200, {
      authenticated: true,
      email: verified.data.user.email || null
    });
  } catch {
    return json(res, 503, { message: 'The account service is temporarily unavailable. Please try again.' });
  }
}
