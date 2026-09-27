const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const email = String(req.body?.email || '').trim();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      return res.status(503).json({ message: 'Account service is not configured.' });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });

    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://studypilot-flax.vercel.app/'
    });

    if (error) return res.status(400).json({ message: error.message });

    return res.status(200).json({
      message: 'If an account exists for that email, a password reset email has been sent. Check your Inbox and Spam.'
    });
  } catch (e) {
    return res.status(503).json({ message: 'Account service is temporarily unavailable.' });
  }
}
