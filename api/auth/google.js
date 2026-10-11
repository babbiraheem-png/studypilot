import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SITE_URL = 'https://studypilot-flax.vercel.app';

function redirectToLogin(res, reason) {
  const target = new URL('/login.html', SITE_URL);
  target.searchParams.set('google_error', reason);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', target.toString());
  return res.status(302).end();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ message: 'Method not allowed.' });
  }

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return redirectToLogin(res, 'service');
  }

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
        flowType: 'implicit'
      }
    });

    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${SITE_URL}/oauth-callback.html`,
        scopes: 'openid email profile',
        queryParams: { prompt: 'select_account' },
        skipBrowserRedirect: true
      }
    });

    if (error || !data?.url) {
      const detail = String(error?.message || '').toLowerCase();
      const reason = /provider.*(not enabled|disabled|unsupported)|unsupported provider|provider is not enabled/.test(detail)
        ? 'not_configured'
        : 'start';
      return redirectToLogin(res, reason);
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', data.url);
    return res.status(302).end();
  } catch {
    return redirectToLogin(res, 'start');
  }
}
