export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false });
  }

  const { senha } = req.body;

  if (!senha) {
    return res.status(400).json({ ok: false });
  }

  if (senha === process.env.ADMIN_CLEAR_CACHE_PASSWORD) {
    return res.status(200).json({ ok: true });
  }

  return res.status(401).json({ ok: false });
}
