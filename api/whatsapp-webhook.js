import fetch from "node-fetch"

export default async function handler(req, res) {

  if (req.method === "GET") {
    const VERIFY_TOKEN = process.env.VERIFY_TOKEN

    const mode = req.query["hub.mode"]
    const token = req.query["hub.verify_token"]
    const challenge = req.query["hub.challenge"]

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge)
    } else {
      return res.sendStatus(403)
    }
  }

  if (req.method === "POST") {

    const body = req.body

    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]

    if (!message) return res.sendStatus(200)

    const telefone = message.from
    const texto = message.text?.body || ""

    // 🔥 CHAMA SEU AGENTE
    await fetch(`${process.env.APP_URL}/api/whatsapp-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telefone, mensagem: texto })
    })

    return res.sendStatus(200)
  }
}
