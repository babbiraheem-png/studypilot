const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
import { createClient } from '@supabase/supabase-js';

function setSessionCookies(res, session) {
  if (!session) return;
  const base = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000';
  res.setHeader('Set-Cookie', [
    `studypilot_access_token=${encodeURIComponent(session.access_token)}; ${base}`,
    `studypilot_refresh_token=${encodeURIComponent(session.refresh_token)}; ${base}`
  ]);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const { email, identifier, password } = req.body || {};
    const loginEmail = String(email || identifier || '').trim();
    const passwordValue = String(password || '');

    if (!loginEmail || !loginEmail.includes('@') || passwordValue.length < 8) {
      return res.status(400).json({ message: 'Enter a valid email address and an 8+ character password.' });
    }

    
    const sb = createClient(SUPABASE_URL, key, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });

    const siteUrl = 'https://studypilot-flax.vercel.app/';

    const { data, error } = await sb.auth.signUp({
      email: loginEmail,
      password: passwordValue,
      options: {
        emailRedirectTo: siteUrl
      }
    });

    if (error) return res.status(400).json({ message: error.message });

    if (data.session) {
      setSessionCookies(res, data.session);
      return res.status(200).json({
        message: 'Account created and signed in.',
        email: data.user?.email || loginEmail,
        authenticated: true
      });
    }

    // If Supabase reports an existing confirmed account, make the Create
    // account button useful too: sign in with the same credentials.
    const existingLogin = await sb.auth.signInWithPassword({
      email: loginEmail,
      password: passwordValue
    });

    if (existingLogin.data?.session && existingLogin.data?.user) {
      setSessionCookies(res, existingLogin.data.session);
      return res.status(200).json({
        message: 'Welcome back — you are signed in.',
        email: existingLogin.data.user.email || loginEmail,
        authenticated: true
      });
    }

    const alreadyConfirmed = Boolean(data.user?.email_confirmed_at);
    return res.status(200).json({
      message: alreadyConfirmed
        ? 'This account is already confirmed. Use Sign in with your email and password.'
        : 'Account created. Check your email to confirm.',
      email: data.user?.email || loginEmail,
      authenticated: false,
      alreadyConfirmed,
      needsConfirmation: !alreadyConfirmed
    });
  } catch (e) {
    return res.status(503).json({ message: 'Account service is not configured.' });
  }
}
