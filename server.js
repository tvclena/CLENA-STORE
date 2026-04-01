const express = require("express")
const cors = require("cors")
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys")
const QRCode = require("qrcode")
const path = require("path")

const app = express()
app.use(express.json())
app.use(cors())

/* ================= SESSÕES ================= */

let sessions = {}

/* ================= CRIAR SESSÃO ================= */

async function criarSessao(loja_id){

  const pasta = path.join(__dirname, "sessions", loja_id)

  const { state, saveCreds } = await useMultiFileAuthState(pasta)

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  })

  sessions[loja_id] = {
    sock,
    qr: null,
    conectado: false
  }

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {

    if(qr){
      const qrBase64 = await QRCode.toDataURL(qr)
      sessions[loja_id].qr = qrBase64
    }

    if(connection === "open"){
      console.log("✅ Conectado:", loja_id)
      sessions[loja_id].conectado = true
      sessions[loja_id].qr = null
    }

    if(connection === "close"){
      sessions[loja_id].conectado = false

      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut

      console.log("❌ Desconectado:", loja_id)

      if(shouldReconnect){
        console.log("🔁 Reconectando...")
        criarSessao(loja_id)
      }
    }
  })

  /* ================= RECEBER MENSAGENS ================= */

  sock.ev.on("messages.upsert", async ({ messages }) => {

    const msg = messages[0]

    if(!msg.message) return

    const telefone = msg.key.remoteJid?.replace("@s.whatsapp.net","")

    const texto =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ""

    console.log("📩", loja_id, telefone, texto)

    // 🔥 RESPOSTA SIMPLES (TESTE)
    await sock.sendMessage(
      telefone + "@s.whatsapp.net",
      { text: "🤖 Bot conectado com sucesso!" }
    )
  })
}

/* ================= API ================= */

// criar sessão
app.post("/criar-sessao", async (req,res)=>{

  const { loja_id } = req.body

  if(!loja_id){
    return res.status(400).json({ erro: "loja_id obrigatório" })
  }

  if(sessions[loja_id]){
    return res.json({ ok:true })
  }

  await criarSessao(loja_id)

  res.json({ ok:true })
})

// pegar QR
app.get("/qr/:loja_id",(req,res)=>{
  const s = sessions[req.params.loja_id]
  res.json({
    qr: s?.qr || null
  })
})

// status
app.get("/status/:loja_id",(req,res)=>{
  const s = sessions[req.params.loja_id]
  res.json({
    conectado: s?.conectado || false
  })
})

/* ================= FRONT ================= */

app.use(express.static(path.join(__dirname, "public")))

/* ================= START ================= */

app.listen(3000, ()=>{
  console.log("🚀 Servidor rodando em http://localhost:3000")
})
