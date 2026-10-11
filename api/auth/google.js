import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SITE_URL = 'https://studypilot-flax.vercel.app';

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(body);
}

function redirectToLogin(res, reason) {
  const target = new URL('/login.html', SITE_URL);
  target.searchParams.set('google_error', reason);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', target.toString());
  return res.status(302).end();
}

function setSessionCookies(res, session) {
  const base = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000';
  res.setHeader('Set-Cookie', [
    `studypilot_access_token=${encodeURIComponent(session.access_token)}; ${base}`,
    `studypilot_refresh_token=${encodeURIComponent(session.refresh_token)}; ${base}`
  ]);
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    if (req.method === 'GET') return redirectToLogin(res, 'service');
    return json(res, 503, { message: 'The account service is not configured.' });
  }

  // POST completes either the Google login callback or Supabase's existing
  // email/password recovery callback. Tokens are exchanged for HttpOnly cookies.
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin && origin !== SITE_URL) {
      return json(res, 403, { message: 'This sign-in request was not accepted.' });
    }

    const accessToken = typeof req.body?.access_token === 'string' ? req.body.access_token : '';
    const refreshToken = typeof req.body?.refresh_token === 'string' ? req.body.refresh_token : '';
    if (!accessToken || !refreshToken || accessToken.length > 8192 || refreshToken.length > 8192) {
      return json(res, 400, { message: 'Sign-in could not be completed. Please try again.' });
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
        return json(res, 401, { message: 'Your sign-in session could not be verified. Please try again.' });
      }

      const verified = await sb.auth.getUser(data.session.access_token);
      if (verified.error || !verified.data?.user) {
        return json(res, 401, { message: 'Your sign-in session could not be verified. Please try again.' });
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

  // GET starts the Google OAuth flow.
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { message: 'Method not allowed.' });
  }

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
        flowType: 'implicit'
      }
    });

    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${SITE_URL}/oauth-callback.html`,
        scopes: 'openid email profile',
        queryParams: { prompt: 'select_account' },
        skipBrowserRedirect: true
      }
    });

    if (error || !data?.url) {
      const detail = String(error?.message || '').toLowerCase();
      const reason = /provider.*(not enabled|disabled|unsupported)|unsupported provider|provider is not enabled/.test(detail)
        ? 'not_configured'
        : 'start';
      return redirectToLogin(res, reason);
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', data.url);
    return res.status(302).end();
  } catch {
    return redirectToLogin(res, 'start');
  }
}
