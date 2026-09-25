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
    const { phone, token } = req.body || {};
    const normalizedPhone = String(phone || '').replace(/[\s()-]/g, '');
    const otp = String(token || '').trim();

    if (!/^\+?[1-9]\d{7,14}$/.test(normalizedPhone) || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: 'Enter the 6-digit verification code sent to your phone.' });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
      return res.status(503).json({ message: 'Account service is not configured.' });
    }

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });

    const { data, error } = await sb.auth.verifyOtp({
      phone: normalizedPhone,
      token: otp,
      type: 'sms'
    });

    if (error) return res.status(400).json({ message: error.message });
    if (!data.session) return res.status(400).json({ message: 'Phone verification completed, but no login session was created.' });

    setSessionCookies(res, data.session);

    return res.status(200).json({
      authenticated: true,
      phone: data.user?.phone || normalizedPhone,
      email: data.user?.email || ''
    });
  } catch (e) {
    return res.status(503).json({ message: 'Account service is temporarily unavailable.' });
  }
}
