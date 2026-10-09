const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
import { createClient } from '@supabase/supabase-js';

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const password = String(req.body?.password || '');
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ message: 'Choose a new password between 8 and 128 characters.' });
    }

    const accessToken = getCookie(req, 'studypilot_access_token');
    const refreshToken = getCookie(req, 'studypilot_refresh_token');
    if (!accessToken || !refreshToken) {
      return res.status(401).json({ message: 'Password reset session has expired. Request a new reset email.' });
    }

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      return res.status(503).json({ message: 'Account service is not configured.' });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });

    // Re-establish the recovery session on this server-side client before
    // calling updateUser. Supabase requires an active auth session here.
    const { data: sessionData, error: sessionError } = await sb.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });
    if (sessionError || !sessionData?.session) {
      return res.status(401).json({
        message: sessionError?.message || 'Password reset session has expired. Request a new reset email.'
      });
    }

    const { error } = await sb.auth.updateUser({ password });
    if (error) return res.status(400).json({ message: error.message });

    // Keep the refreshed session in the browser cookies.
    const base = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000';
    res.setHeader('Set-Cookie', [
      `studypilot_access_token=${encodeURIComponent(sessionData.session.access_token)}; ${base}`,
      `studypilot_refresh_token=${encodeURIComponent(sessionData.session.refresh_token)}; ${base}`
    ]);

    return res.status(200).json({ message: 'Password updated successfully.' });
  } catch (e) {
    return res.status(503).json({ message: 'Account service is temporarily unavailable.' });
  }
}
