import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
)

export default async function handler(req, res){

  const { telefone, mensagem } = req.body

  // 🔥 BUSCA ESTADO DO CLIENTE
  let { data: estado } = await supabase
    .from("estado_conversa")
    .select("*")
    .eq("telefone", telefone)
    .single()

  if(!estado){
    await supabase.from("estado_conversa").insert({
      telefone,
      etapa: "inicio"
    })
    estado = { etapa: "inicio" }
  }

  /* ================= FLUXO ================= */

  // INICIO
  if(estado.etapa === "inicio"){
    await atualizarEstado(telefone, "nome")

    return responder(telefone, "Qual seu nome?")
  }

  // NOME
  if(estado.etapa === "nome"){
    await atualizarEstado(telefone, "servico", { nome: mensagem })

    return responder(telefone, "Qual serviço deseja?")
  }

  // SERVIÇO
  if(estado.etapa === "servico"){
    await atualizarEstado(telefone, "data", { servico: mensagem })

    return responder(telefone, "Qual data? (ex: 25/04)")
  }

  // DATA
  if(estado.etapa === "data"){
    await atualizarEstado(telefone, "hora", { data: mensagem })

    return responder(telefone, "Qual horário?")
  }

  // HORA FINAL
  if(estado.etapa === "hora"){

    const dados = {
      telefone,
      nome: estado.nome,
      servico: estado.servico,
      data: estado.data,
      hora: mensagem
    }

    // 🔥 SALVA NO BANCO
    await supabase.from("agendamentos").insert(dados)

    // 🔥 LIMPA ESTADO
    await supabase.from("estado_conversa").delete().eq("telefone", telefone)

    return responder(
      telefone,
      `Agendamento confirmado!\n\n📅 ${dados.data}\n⏰ ${dados.hora}`
    )
  }

  res.status(200).end()
}

/* ================= FUNÇÕES ================= */

async function atualizarEstado(telefone, etapa, extra = {}){
  await supabase.from("estado_conversa").upsert({
    telefone,
    etapa,
    ...extra
  })
}

async function responder(telefone, texto){
  await fetch(`https://graph.facebook.com/v19.0/${process.env.PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: telefone,
      type: "text",
      text: { body: texto }
    })
  })
}
