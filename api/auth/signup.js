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
    const { email, password, phone } = req.body || {};
    const normalizedPhone = String(phone || '').replace(/[\s()-]/g, '');
    if (!email || !password || !normalizedPhone) {
      return res.status(400).json({ message: 'Email, phone number, and password are required.' });
    }
    if (!/^\+?[1-9]\d{7,14}$/.test(normalizedPhone)) {
      return res.status(400).json({ message: 'Enter a valid phone number with country code, for example +919876543210.' });
    }

    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!process.env.SUPABASE_URL || !key) {
      return res.status(503).json({ message: 'Account service is not configured.' });
    }

    const sb = createClient(process.env.SUPABASE_URL, key, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });

    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { phone: normalizedPhone }
      }
    });
    if (error) return res.status(400).json({ message: error.message });

    if (data.session) setSessionCookies(res, data.session);

    return res.status(200).json({
      message: data.session
        ? 'Account created and signed in.'
        : 'Account created. Check your email to confirm.',
      email: data.user?.email || email,
      authenticated: Boolean(data.session)
    });
  } catch (e) {
    return res.status(503).json({ message: 'Account service is not configured.' });
  }
}
