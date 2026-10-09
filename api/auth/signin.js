const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
import { createClient } from '@supabase/supabase-js';

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

function loginMessage(error) {
  const message = String(error?.message || '').toLowerCase();
  if (/email not confirmed/.test(message)) {
    return 'Please confirm your email first. Check Inbox and Spam, or use “Resend email” on the account page.';
  }
  if (/invalid login credentials|invalid credentials/.test(message)) {
    return 'Email or password is incorrect. If you are new, choose Create account; if you forgot your password, use Forgot password.';
  }
  if (/rate limit|too many requests/.test(message)) {
    return 'Too many login attempts. Wait a little and try again.';
  }
  return error?.message || 'Log in failed. Please try again.';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { message: 'Method not allowed.' });
  }

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return json(res, 503, { message: 'Account service is not configured on the server.' });
  }

  try {
    const email = String(req.body?.email || req.body?.identifier || '').trim().toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 128) {
      return json(res, 400, { message: 'Enter a valid email address and password.' });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      const message = loginMessage(error);
      const status = /rate limit|too many requests/i.test(String(error.message || '')) ? 429 : 401;
      return json(res, status, { message });
    }
    if (!data.session || !data.user) {
      return json(res, 401, { message: 'Unable to create a login session. Please try again.' });
    }

    // Profiles are supplementary app data. A missing profile row/table must not
    // turn a valid authentication into an apparent invalid-credentials failure.
    let profile = null;
    try {
      const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
      });
      const result = await db.from('profiles').select('plan, credits').eq('id', data.user.id).maybeSingle();
      if (!result.error) profile = result.data;
    } catch {
      // Authentication remains valid even if optional profile data is unavailable.
    }

    setSessionCookies(res, data.session);
    return json(res, 200, {
      authenticated: true,
      email: data.user.email,
      plan: profile?.plan || 'free',
      credits: Number(profile?.credits ?? 20)
    });
  } catch {
    return json(res, 503, { message: 'The account service is temporarily unavailable. Please try again shortly.' });
  }
}
