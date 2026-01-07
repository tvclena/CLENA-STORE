export default async function handler(req, res) {
  console.log("🔥 WEBHOOK ASSINATURA ATINGIDO");
  console.log("METHOD:", req.method);
  console.log("HEADERS:", req.headers);
  console.log("BODY:", req.body);

  return res.status(200).json({ ok: true });
}
