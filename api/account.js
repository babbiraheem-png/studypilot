// StudyPilot account session endpoint
// Deployment trigger after Supabase Production environment variables were configured.
import { createClient } from '@supabase/supabase-js';

function client() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
  );
}

function admin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
  );
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function getBearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function setSessionCookies(res, session) {
  const base = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000';
  res.setHeader('Set-Cookie', [
    `studypilot_access_token=${encodeURIComponent(session.access_token)}; ${base}`,
    `studypilot_refresh_token=${encodeURIComponent(session.refresh_token)}; ${base}`
  ]);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const accessToken = getCookie(req, 'studypilot_access_token') || getBearer(req);
    const refreshToken = getCookie(req, 'studypilot_refresh_token');

    if (!accessToken) {
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(401).json({ authenticated: false });
    }

    const sb = client();
    let session = null;
    let user = null;

    if (refreshToken) {
      const result = await sb.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
      session = result.data?.session || null;
      user = result.data?.user || null;
    } else {
      const result = await sb.auth.getUser(accessToken);
      user = result.data?.user || null;
    }

    if (!user) {
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(401).json({ authenticated: false });
    }

    if (session) setSessionCookies(res, session);

    const db = admin();
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('plan, credits, email')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      return res.status(500).json({ message: 'Account profile could not be loaded.' });
    }

    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({
      authenticated: true,
      email: user.email,
      plan: profile?.plan || 'free',
      credits: Number(profile?.credits ?? 20)
    });
  } catch (e) {
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(503).json({ message: 'Account service is not configured.' });
  }
}
