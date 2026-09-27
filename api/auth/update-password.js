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
    if (password.length < 8) {
      return res.status(400).json({ message: 'Your new password must be at least 8 characters.' });
    }

    const accessToken = getCookie(req, 'studypilot_access_token');
    if (!accessToken) {
      return res.status(401).json({ message: 'Password reset session has expired. Request a new reset email.' });
    }

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      return res.status(503).json({ message: 'Account service is not configured.' });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } }
    });

    const { error } = await sb.auth.updateUser({ password });
    if (error) return res.status(400).json({ message: error.message });

    return res.status(200).json({ message: 'Password updated successfully.' });
  } catch (e) {
    return res.status(503).json({ message: 'Account service is temporarily unavailable.' });
  }
}
