import { createClient } from '@supabase/supabase-js';

function setSessionCookies(res, session) {
  const base = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000';
  res.setHeader('Set-Cookie', [
    'studypilot_access_token=' + encodeURIComponent(session.access_token) + '; ' + base,
    'studypilot_refresh_token=' + encodeURIComponent(session.refresh_token) + '; ' + base
  ]);
}

function admin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });

    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!process.env.SUPABASE_URL || !key || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({ message: 'Account service is not configured.' });
    }

    const sb = createClient(process.env.SUPABASE_URL, key, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ message: error.message });
    if (!data.session || !data.user) {
      return res.status(401).json({ message: 'Unable to create a login session.' });
    }

    setSessionCookies(res, data.session);

    const db = admin();
    const { data: profile } = await db
      .from('profiles')
      .select('plan, credits')
      .eq('id', data.user.id)
      .maybeSingle();

    res.setHeader('Cache-Control', 'private, no-store');

    return res.status(200).json({
      authenticated: true,
      email: data.user.email,
      plan: profile?.plan || 'free',
      credits: Number(profile?.credits ?? 20)
    });
  } catch (e) {
    return res.status(503).json({ message: 'Account service is not configured.' });
  }
}
