import { createClient } from "@supabase/supabase-js"
import fetch from "node-fetch"

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
)

export default async function handler(req, res){

  const { telefone, mensagem, loja_id } = req.body

  let { data: estado } = await sb
    .from("estado_conversa")
    .select("*")
    .eq("telefone", telefone)
    .single()

  if(!estado){
    await sb.from("estado_conversa").insert({
      telefone,
      etapa: "inicio",
      loja_id
    })
    estado = { etapa: "inicio", loja_id }
  }

  /* ================= INICIO ================= */

  if(estado.etapa === "inicio"){
    await atualizar(telefone, "servico")
    return responder(telefone, "Qual serviço deseja?")
  }

  /* ================= SERVIÇOS ================= */

  if(estado.etapa === "servico"){

    const { data: servicos } = await sb
      .from("produtos_servicos")
      .select("*")
      .eq("user_id", loja_id)
      .eq("tipo", "SERVICO")
      .eq("ativo", true)

    let lista = "Escolha um serviço:\n\n"

    servicos.forEach((s,i)=>{
      lista += `${i+1} - ${s.nome} (R$ ${s.preco})\n`
    })

    await atualizar(telefone, "selecionar_servico", {
      lista_servicos: servicos
    })

    return responder(telefone, lista)
  }

  /* ================= ESCOLHA SERVIÇO ================= */

  if(estado.etapa === "selecionar_servico"){

    const index = Number(mensagem) - 1
    const servico = estado.lista_servicos[index]

    if(!servico){
      return responder(telefone, "Escolha um número válido.")
    }

    await atualizar(telefone, "data", {
      servicos: [servico]
    })

    return responder(telefone, "Qual data? (ex: 25/04)")
  }

  /* ================= DATA ================= */

  if(estado.etapa === "data"){

    const dataISO = formatarData(estado.data || mensagem)

    const { data: agenda } = await sb
      .from("agenda_loja")
      .select("*")
      .eq("user_id", loja_id)
      .eq("data", dataISO)
      .eq("fechado", false)
      .single()

    if(!agenda){
      return responder(telefone, "Loja fechada nessa data.")
    }

    const horarios = gerarHorarios(agenda, estado.servicos, loja_id, dataISO)

    await atualizar(telefone, "hora", {
      data: dataISO,
      horarios
    })

    return responder(telefone, formatarHorarios(horarios))
  }

  /* ================= HORA ================= */

  if(estado.etapa === "hora"){

    const horario = estado.horarios[Number(mensagem)-1]

    if(!horario){
      return responder(telefone, "Escolha um horário válido.")
    }

    const cliente = {
      nome: "Cliente WhatsApp",
      whatsapp: telefone
    }

    // 🔥 CHAMA SUA API REAL
    await fetch(process.env.APP_URL + "/api/create-agendamento", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({
        loja_id,
        data: estado.data,
        hora_inicio: horario,
        servicos: estado.servicos,
        cliente_nome: cliente.nome,
        cliente_whatsapp: cliente.whatsapp
      })
    })

    await sb.from("estado_conversa").delete().eq("telefone", telefone)

    return responder(telefone, "✅ Agendamento confirmado!")
  }

  res.status(200).end()
}

/* ================= FUNÇÕES ================= */

async function atualizar(telefone, etapa, extra = {}){
  await sb.from("estado_conversa").upsert({
    telefone,
    etapa,
    ...extra
  })
}

function formatarData(dataBR){
  const [d,m] = dataBR.split("/")
  const y = new Date().getFullYear()
  return `${y}-${m}-${d}`
}

function gerarHorarios(agenda, servicos, loja_id, data){
  // versão simplificada (posso fazer igual 100% ao seu depois)
  return ["09:00","10:00","11:00"]
}

function formatarHorarios(horarios){
  let txt = "Escolha um horário:\n\n"
  horarios.forEach((h,i)=>{
    txt += `${i+1} - ${h}\n`
  })
  return txt
}

async function responder(telefone, texto){
  await fetch(`https://graph.facebook.com/v19.0/${process.env.PHONE_ID}/messages`, {
    method:"POST",
    headers:{
      Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type":"application/json"
    },
    body: JSON.stringify({
      messaging_product:"whatsapp",
      to:telefone,
      type:"text",
      text:{ body:texto }
    })
  })
}
