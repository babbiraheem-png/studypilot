export default async function handler(req, res) {
  return res.status(200).json({ ok: true, aiConfigured: Boolean(process.env.GEMINI_API_KEY) });
}