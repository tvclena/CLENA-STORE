export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: "Senha não informada" });
  }

  if (password !== process.env.IMPORTADOR_PASSWORD) {
    return res.status(401).json({ error: "Senha incorreta" });
  }

  return res.status(200).json({ ok: true });
}
