const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
import { createClient } from '@supabase/supabase-js';

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
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
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(res, 400, { message: 'Enter a valid email address.' });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://studypilot-flax.vercel.app/'
    });

    if (error) {
      const message = String(error.message || '').toLowerCase();
      if (error.status === 429 || /rate limit|too many requests/.test(message)) {
        return json(res, 429, { message: 'Too many reset requests. Wait a little and try again.' });
      }
      if (/email address not authorized|smtp|email provider|sending email/.test(message)) {
        return json(res, 503, { message: 'The email service is not ready to send password resets. Please try again later.' });
      }
      // Keep the response generic to avoid exposing whether an email is registered.
      return json(res, 200, { message: 'If an account exists for that email, a password reset email has been requested. Check Inbox and Spam.' });
    }

    return json(res, 200, {
      message: 'If an account exists for that email, a password reset email has been requested. Check Inbox and Spam.'
    });
  } catch {
    return json(res, 503, { message: 'The account service is temporarily unavailable.' });
  }
}
