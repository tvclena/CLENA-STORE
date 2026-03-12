import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

/* ================= UTIL ================= */

function limparNumero(numero) {
  if (!numero) return ""
  return numero.replace(/\D/g, "")
}

/* ================= HANDLER ================= */

export default async function handler(req, res) {

  /* ================= WEBHOOK VERIFY ================= */

  if (req.method === "GET") {

    const verify_token = process.env.VERIFY_TOKEN

    const mode = req.query["hub.mode"]
    const token = req.query["hub.verify_token"]
    const challenge = req.query["hub.challenge"]

    if (mode === "subscribe" && token === verify_token) {
      return res.status(200).send(challenge)
    }

    return res.status(403).send("Erro de verificação")
  }

  /* ================= RECEBER EVENTO ================= */

  if (req.method === "POST") {

    try {

      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      })

      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE
      )

      const body = req.body

      console.log("Webhook recebido:", JSON.stringify(body))

      const change = body.entry?.[0]?.changes?.[0]?.value

      if (!change) return res.status(200).end()

      if (!change.messages) return res.status(200).end()

      const msg = change.messages[0]

      const cliente = limparNumero(msg.from)
      const mensagem = msg.text?.body
      const message_id = msg.id

      if (!mensagem) return res.status(200).end()

      /* ================= BLOQUEAR DUPLICIDADE ================= */

      const { data: jaProcessada } = await supabase
        .from("mensagens_processadas")
        .select("*")
        .eq("message_id", message_id)
        .maybeSingle()

      if (jaProcessada) {
        console.log("Mensagem duplicada ignorada")
        return res.status(200).end()
      }

      await supabase
        .from("mensagens_processadas")
        .insert({ message_id })

      /* ================= IDENTIFICAR LOJA ================= */

      const phone_number_id = change.metadata.phone_number_id

      console.log("PHONE NUMBER ID:", phone_number_id)

      const { data: loja, error } = await supabase
        .from("user_profile")
        .select("*")
        .eq("phone_number_id", phone_number_id)
        .maybeSingle()

      if (error) {
        console.log("Erro ao buscar loja:", error)
      }

      if (!loja) {
        console.log("Loja não encontrada para:", phone_number_id)
        return res.status(200).end()
      }

      console.log("Loja encontrada:", loja.negocio)

      /* ================= SALVAR MENSAGEM ================= */

      await supabase
        .from("conversas_whatsapp")
        .insert({
          telefone: cliente,
          loja_id: loja.id,
          mensagem: mensagem,
          role: "user"
        })

      /* ================= HISTÓRICO ================= */

      const { data: historico } = await supabase
        .from("conversas_whatsapp")
        .select("*")
        .eq("telefone", cliente)
        .order("created_at", { ascending: true })
        .limit(10)

      const mensagens = historico?.map(m => ({
        role: m.role,
        content: m.mensagem
      })) || []

      /* ================= PRODUTOS ================= */

      const { data: produtos } = await supabase
        .from("produtos")
        .select("nome,preco")
        .limit(20)

      let listaProdutos = ""

      if (produtos) {
        listaProdutos = produtos
          .map(p => `${p.nome} - R$ ${p.preco}`)
          .join("\n")
      }

      /* ================= OPENAI ================= */

      let resposta = ""

      try {

        const completion = await openai.chat.completions.create({

          model: "gpt-4.1-mini",

          messages: [

            {
              role: "system",
              content: `
Você é o assistente oficial da loja ${loja.negocio}.

Cidade: ${loja.cidade}
Tipo de negócio: ${loja.tipo}

Endereço:
${loja.rua || ""} ${loja.numero || ""} ${loja.bairro || ""}

Instagram:
${loja.instagram || ""}

Descrição:
${loja.bio || ""}

PRODUTOS DISPONÍVEIS:
${listaProdutos}

Seu trabalho é:

• responder clientes
• mostrar produtos
• ajudar clientes
• criar agendamentos
• criar pedidos

----------------------------------

AGENDAMENTO_JSON:

{
nome:"",
telefone:"",
data:"",
hora:"",
servico:""
}

----------------------------------

PEDIDO_JSON:

{
cliente:"",
itens:[
{
produto:"",
quantidade:1
}
]
}

Nunca gere JSON sem confirmação do cliente.
`
            },

            ...mensagens,

            {
              role: "user",
              content: mensagem
            }

          ]

        })

        resposta = completion.choices[0].message.content

      } catch (e) {

        console.log("Erro OpenAI:", e)

        resposta = "Olá 👋 Como posso ajudar?"

      }

      /* ================= PROCESSAR AGENDAMENTO ================= */

      try {

        const match = resposta.match(/AGENDAMENTO_JSON:\s*({[\s\S]*?})/)

        if (match) {

          const agendamento = JSON.parse(match[1])

          await fetch(process.env.URL_API + "/create-agendamento", {

            method: "POST",

            headers: {
              "Content-Type": "application/json"
            },

            body: JSON.stringify({
              nome: agendamento.nome,
              telefone: cliente,
              data: agendamento.data,
              hora: agendamento.hora,
              servico: agendamento.servico,
              loja_id: loja.id
            })

          })

          resposta = "✅ Agendamento confirmado!"

        }

      } catch (e) {

        console.log("Erro ao processar agendamento:", e)

      }

      /* ================= SALVAR RESPOSTA ================= */

      await supabase
        .from("conversas_whatsapp")
        .insert({
          telefone: cliente,
          loja_id: loja.id,
          mensagem: resposta,
          role: "assistant"
        })

      /* ================= ENVIAR WHATSAPP ================= */

      const url = `https://graph.facebook.com/v19.0/${phone_number_id}/messages`

      await fetch(url, {

        method: "POST",

        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        },

        body: JSON.stringify({

          messaging_product: "whatsapp",

          to: cliente,

          type: "text",

          text: {
            body: resposta
          }

        })

      })

    } catch (e) {

      console.log("Erro geral:", e)

    }

    return res.status(200).end()

  }

}
