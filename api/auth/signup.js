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

function explainSignupError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (error?.status === 429 || /rate limit|too many requests|email.*rate|over_email_send_rate_limit/.test(message)) {
    return { status: 429, message: 'Too many signup or email requests were made. Wait a little and try again.' };
  }
  if (/already registered|already been registered|user exists/.test(message)) {
    return { status: 409, message: 'This email may already have a StudyPilot account. Try Log in or Forgot password instead.' };
  }
  if (/email address not authorized|smtp|email provider|sending email/.test(message)) {
    return { status: 503, message: 'The account was not completed because the email service is not ready. Please try again later.' };
  }
  if (/password/.test(message) && /weak|short|characters/.test(message)) {
    return { status: 400, message: 'Choose a stronger password with at least 8 characters.' };
  }
  return { status: 400, message: error?.message || 'Account creation failed. Please check the details and try again.' };
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
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(res, 400, { message: 'Enter a valid email address.' });
    }
    if (password.length < 8 || password.length > 128) {
      return json(res, 400, { message: 'Choose a password between 8 and 128 characters.' });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });

    const siteUrl = 'https://studypilot-flax.vercel.app/';
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: siteUrl }
    });

    if (error) {
      const mapped = explainSignupError(error);
      return json(res, mapped.status, { message: mapped.message });
    }

    if (data.session && data.user) {
      setSessionCookies(res, data.session);
      return json(res, 200, {
        authenticated: true,
        email: data.user.email || email,
        message: 'Your StudyPilot account is ready.'
      });
    }

    // Supabase may intentionally obscure whether an address is already registered.
    // Do not attempt an implicit sign-in from the signup endpoint.
    return json(res, 200, {
      authenticated: false,
      needsConfirmation: true,
      message: 'If this email can be registered, a confirmation email has been requested. Check Inbox and Spam. If you already have an account, use Log in or Forgot password.'
    });
  } catch {
    return json(res, 503, { message: 'The account service is temporarily unavailable. Please try again shortly.' });
  }
}
