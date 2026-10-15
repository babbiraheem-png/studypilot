const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
import { createClient } from '@supabase/supabase-js';

function client() {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  if (!match) return null;
  try { return decodeURIComponent(match.slice(name.length + 1)); } catch { return null; }
}

function getBearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function setSessionCookies(res, session) {
  const base = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000';
  res.setHeader('Set-Cookie', [
    `studypilot_access_token=${encodeURIComponent(session.access_token)}; ${base}`,
    `studypilot_refresh_token=${encodeURIComponent(session.refresh_token)}; ${base}`
  ]);
}

function clearSessionCookies(res) {
  const expired = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
  res.setHeader('Set-Cookie', [
    'studypilot_access_token=; ' + expired,
    'studypilot_refresh_token=; ' + expired
  ]);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  // Email confirmation and password-reset links return short-lived Supabase
  // tokens to the site. Verify them server-side and keep them in HttpOnly cookies.
  if (req.method === 'POST') {
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      return res.status(503).json({ authenticated: false, message: 'Account service is not configured.' });
    }

    const origin = req.headers.origin;
    if (origin && origin !== 'https://studypilot-flax.vercel.app') {
      return res.status(403).json({ authenticated: false, message: 'This sign-in request was not accepted.' });
    }

    const accessToken = typeof req.body?.access_token === 'string' ? req.body.access_token : '';
    const refreshToken = typeof req.body?.refresh_token === 'string' ? req.body.refresh_token : '';
    if (!accessToken || !refreshToken || accessToken.length > 8192 || refreshToken.length > 8192) {
      return res.status(400).json({ authenticated: false, message: 'Sign-in could not be completed. Please try again.' });
    }

    try {
      const sb = client();
      const { data, error } = await sb.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      if (error || !data?.session) {
        return res.status(401).json({ authenticated: false, message: 'Your sign-in session could not be verified. Please try again.' });
      }

      const verified = await sb.auth.getUser(data.session.access_token);
      if (verified.error || !verified.data?.user) {
        return res.status(401).json({ authenticated: false, message: 'Your sign-in session could not be verified. Please try again.' });
      }

      setSessionCookies(res, data.session);
      return res.status(200).json({ authenticated: true, email: verified.data.user.email || null });
    } catch {
      return res.status(503).json({ authenticated: false, message: 'The account service is temporarily unavailable. Please try again.' });
    }
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ message: 'Method not allowed.' });
  }
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return res.status(503).json({ authenticated: false, message: 'Account service is not configured.' });
  }

  try {
    const accessToken = getCookie(req, 'studypilot_access_token') || getBearer(req);
    const refreshToken = getCookie(req, 'studypilot_refresh_token');
    if (!accessToken) return res.status(401).json({ authenticated: false });

    const sb = client();
    const direct = await sb.auth.getUser(accessToken);
    let user = direct.data?.user || null;
    let activeAccessToken = accessToken;

    if (!user && refreshToken) {
      const refreshed = await sb.auth.refreshSession({ refresh_token: refreshToken });
      if (refreshed.data?.session && refreshed.data?.user) {
        user = refreshed.data.user;
        activeAccessToken = refreshed.data.session.access_token;
        setSessionCookies(res, refreshed.data.session);
      }
    }

    if (!user) {
      clearSessionCookies(res);
      return res.status(401).json({ authenticated: false });
    }

    let profile = null;
    try {
      const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${activeAccessToken}` } }
      });
      const result = await db.from('profiles').select('plan, credits, email').eq('id', user.id).maybeSingle();
      if (!result.error) profile = result.data;
    } catch {
      // Profiles do not hold authentication credentials. Keep a valid session usable.
    }

    return res.status(200).json({
      authenticated: true,
      email: user.email,
      plan: profile?.plan || 'free',
      credits: Number(profile?.credits ?? 20)
    });
  } catch {
    return res.status(503).json({ authenticated: false, message: 'Account service is temporarily unavailable.' });
  }
}
