import { createClient } from '@supabase/supabase-js';

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function clearCookies(res) {
  const expired = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
  res.setHeader('Set-Cookie', [
    'studypilot_access_token=; ' + expired,
    'studypilot_refresh_token=; ' + expired
  ]);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const accessToken = getCookie(req, 'studypilot_access_token');
    const refreshToken = getCookie(req, 'studypilot_refresh_token');

    if (accessToken && refreshToken && process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY) {
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
      });

      const { data: sessionData } = await sb.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });

      if (sessionData?.session) {
        await sb.auth.signOut({ scope: 'local' });
      }
    }

    clearCookies(res);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ authenticated: false });
  } catch (e) {
    clearCookies(res);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ authenticated: false });
  }
}
