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

    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!process.env.SUPABASE_URL || !key) {
      return res.status(503).json({ message: 'Account service is not configured.' });
    }

    const sb = createClient(process.env.SUPABASE_URL, key, {
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

    if (data.session) setSessionCookies(res, data.session);

    const alreadyConfirmed = Boolean(data.user?.email_confirmed_at);
    return res.status(200).json({
      message: data.session
        ? 'Account created and signed in.'
        : alreadyConfirmed
          ? 'This account is already confirmed. Use Sign in with your email and password.'
          : 'Account created. Check your email to confirm.',
      email: data.user?.email || loginEmail,
      authenticated: Boolean(data.session),
      alreadyConfirmed,
      needsConfirmation: !data.session && !alreadyConfirmed
    });
  } catch (e) {
    return res.status(503).json({ message: 'Account service is not configured.' });
  }
}
