const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
import { createClient } from '@supabase/supabase-js';

function setSessionCookies(res, session) {
  const base = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000';
  res.setHeader('Set-Cookie', [
    `studypilot_access_token=${encodeURIComponent(session.access_token)}; ${base}`,
    `studypilot_refresh_token=${encodeURIComponent(session.refresh_token)}; ${base}`
  ]);
}



export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const { identifier, email, password } = req.body || {};
    const loginEmail = String(email || identifier || '').trim();
    if (!loginEmail || !loginEmail.includes('@') || !password) {
      return res.status(400).json({ message: 'Email address and password are required.' });
    }

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      return res.status(503).json({ message: 'Account service is not configured.' });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });

    const { data, error } = await sb.auth.signInWithPassword({ email: loginEmail, password });
    if (error) return res.status(401).json({ message: error.message });
    if (!data.session || !data.user) {
      return res.status(401).json({ message: 'Unable to create a login session.' });
    }

    setSessionCookies(res, data.session);

    const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } }
    });
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('plan, credits')
      .eq('id', data.user.id)
      .maybeSingle();

    if (profileError) {
      return res.status(500).json({ message: 'Signed in, but the account profile could not be loaded.' });
    }

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
