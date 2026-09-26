import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const { email } = req.body || {};
    const loginEmail = String(email || '').trim();

    if (!loginEmail || !loginEmail.includes('@')) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
      return res.status(503).json({ message: 'Account service is not configured.' });
    }

    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_PUBLISHABLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
    );

    const { error } = await sb.auth.resend({
      type: 'signup',
      email: loginEmail,
      options: {
        emailRedirectTo: 'https://studypilot-flax.vercel.app/'
      }
    });

    if (error) return res.status(400).json({ message: error.message });

    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({
      sent: true,
      message: 'A fresh confirmation email was requested. Check Inbox and Spam.'
    });
  } catch (e) {
    return res.status(503).json({ message: 'Unable to request the confirmation email right now.' });
  }
}
