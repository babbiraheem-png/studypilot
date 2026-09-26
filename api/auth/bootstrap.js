const SUPABASE_URL = SUPABASE_URL || 'https://mxnhfvhvwqxjfctgfejf.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_UdCozB9L-cEedEJgOq_t9w_Sl4aooYc';
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
    const { access_token, refresh_token } = req.body || {};
    if (!access_token || !refresh_token) {
      return res.status(400).json({ message: 'Authentication callback is incomplete.' });
    }

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      return res.status(503).json({ message: 'Account service is not configured.' });
    }

    const sb = createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
    );

    const { data, error } = await sb.auth.setSession({
      access_token,
      refresh_token
    });

    if (error || !data?.session || !data?.user) {
      return res.status(401).json({ message: error?.message || 'Authentication callback could not be completed.' });
    }

    setSessionCookies(res, data.session);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({
      authenticated: true,
      email: data.user.email || ''
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(503).json({ message: 'Account service is temporarily unavailable.' });
  }
}
