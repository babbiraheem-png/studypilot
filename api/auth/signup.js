import { createClient } from '@supabase/supabase-js';

function setSessionCookies(res, session) {
  if (!session) return;
  const base = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000';
  res.setHeader('Set-Cookie', [
    `studypilot_access_token=${encodeURIComponent(session.access_token)}; ${base}`,
    `studypilot_refresh_token=${encodeURIComponent(session.refresh_token)}; ${base}`
  ]);
}

function normalizePhone(value) {
  return String(value || '').replace(/[\s()-]/g, '');
}

function looksLikePhone(value) {
  const phone = normalizePhone(value);
  return /^\+?[1-9]\d{7,14}$/.test(phone) && !phone.includes('@');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const { identifier, email: legacyEmail, phone: extraPhone, password } = req.body || {};
    const loginIdentifier = String(identifier || legacyEmail || '').trim();
    const passwordValue = String(password || '');
    const normalizedExtraPhone = normalizePhone(extraPhone);
    const isPhoneSignup = looksLikePhone(loginIdentifier);
    const email = isPhoneSignup ? null : loginIdentifier;
    const phone = isPhoneSignup ? normalizePhone(loginIdentifier) : normalizedExtraPhone || null;

    if ((!email && !phone) || passwordValue.length < 8) {
      return res.status(400).json({ message: 'Enter an email address or phone number and an 8+ character password.' });
    }
    if (email && !email.includes('@')) {
      return res.status(400).json({ message: 'Enter a valid email address or phone number.' });
    }
    if (phone && !/^\+?[1-9]\d{7,14}$/.test(phone)) {
      return res.status(400).json({ message: 'Enter a valid phone number with country code, for example +919876543210.' });
    }

    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!process.env.SUPABASE_URL || !key) {
      return res.status(503).json({ message: 'Account service is not configured.' });
    }

    const sb = createClient(process.env.SUPABASE_URL, key, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });

    const signupPayload = phone
      ? {
          phone,
          password: passwordValue,
          options: { data: { phone } }
        }
      : {
          email,
          password: passwordValue,
          options: { data: phone ? { phone } : {} }
        };

    const { data, error } = await sb.auth.signUp(signupPayload);
    if (error) return res.status(400).json({ message: error.message });

    if (data.session) setSessionCookies(res, data.session);

    return res.status(200).json({
      message: data.session
        ? 'Account created and signed in.'
        : phone
          ? 'Account created. Check your phone for the verification code.'
          : 'Account created. Check your email to confirm.',
      email: data.user?.email || email || '',
      phone: data.user?.phone || phone || '',
      authenticated: Boolean(data.session),
      needsPhoneVerification: Boolean(phone && !data.session)
    });
  } catch (e) {
    return res.status(503).json({ message: 'Account service is not configured.' });
  }
}
