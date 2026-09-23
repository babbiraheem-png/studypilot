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
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });

    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!process.env.SUPABASE_URL || !key) {
      return res.status(503).json({ message: 'Account service is not configured.' });
    }

    const sb = createClient(process.env.SUPABASE_URL, key, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) return res.status(400).json({ message: error.message });

    setSessionCookies(res, data.session);

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
