import { createClient } from "@supabase/supabase-js"
import fetch from "node-fetch"

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
)

/* ================= UTILS (IGUAL SEU INDEX) ================= */
const toMin = h => {
  const [a,b] = h.split(":").map(Number)
  return a*60 + b
}

const toHour = m => {
  const hh = String(Math.floor(m/60)).padStart(2,"0")
  const mm = String(m%60).padStart(2,"0")
  return `${hh}:${mm}`
}

function getDuracaoTotal(servicos){
  return servicos.reduce((s,x)=> s + Number(x.duracao_minutos || x.duracao || 0),0)
}

function formatarDataBRparaISO(data){
  const [d,m] = data.split("/")
  const y = new Date().getFullYear()
  return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`
}

/* ================= MAIN ================= */

export default async function handler(req,res){

  const { telefone, mensagem, phone_number_id } = req.body

  /* ================= IDENTIFICAR LOJA ================= */

  const { data: cred } = await sb
    .from("whatsapp_credenciais")
    .select("*")
    .eq("phone_number_id", phone_number_id)
    .eq("ativo", true)
    .single()

  if(!cred){
    console.log("❌ Número não cadastrado")
    return res.sendStatus(200)
  }

  const loja_id = cred.loja_id

  /* ================= ESTADO ================= */

  let { data: estado } = await sb
    .from("estado_conversa")
    .select("*")
    .eq("telefone", telefone)
    .single()

  if(!estado){
    await atualizar(telefone, loja_id, "inicio")
    estado = { etapa:"inicio", loja_id }
  }

  /* ================= FLUXO ================= */

  // INICIO
  if(estado.etapa === "inicio"){
    await atualizar(telefone, loja_id, "servico")
    return responder(cred, telefone, "👋 Olá! Qual serviço deseja?")
  }

  // LISTAR SERVIÇOS
  if(estado.etapa === "servico"){

    const { data: servicos } = await sb
      .from("produtos_servicos")
      .select("*")
      .eq("user_id", loja_id)
      .eq("tipo","SERVICO")
      .eq("ativo", true)

    let lista = "💼 Serviços disponíveis:\n\n"

    servicos.forEach((s,i)=>{
      lista += `${i+1} - ${s.nome} (R$ ${s.preco})\n`
    })

    await atualizar(telefone, loja_id, "selecionar_servico", {
      lista_servicos: servicos
    })

    return responder(cred, telefone, lista)
  }

  // ESCOLHER SERVIÇO
  if(estado.etapa === "selecionar_servico"){

    const index = Number(mensagem) - 1
    const servico = estado.lista_servicos[index]

    if(!servico){
      return responder(cred, telefone, "Escolha um número válido.")
    }

    await atualizar(telefone, loja_id, "data", {
      servicos: [servico]
    })

    return responder(cred, telefone, "📅 Qual data? (ex: 25/04)")
  }

  // DATA
  if(estado.etapa === "data"){

    const dataISO = formatarDataBRparaISO(mensagem)

    const { data: agenda } = await sb
      .from("agenda_loja")
      .select("*")
      .eq("user_id", loja_id)
      .eq("data", dataISO)
      .eq("fechado", false)
      .single()

    if(!agenda){
      return responder(cred, telefone, "❌ Loja fechada nessa data.")
    }

    // horários ocupados
    const { data: ags } = await sb
      .from("agendamentos")
      .select("hora_inicio,hora_fim")
      .eq("user_id", loja_id)
      .eq("data", dataISO)

    const ocupados = (ags||[]).map(a=>[
      toMin(a.hora_inicio),
      toMin(a.hora_fim)
    ])

    const blocos = typeof agenda.horarios === "string"
      ? JSON.parse(agenda.horarios)
      : agenda.horarios

    const duracao = getDuracaoTotal(estado.servicos)

    let slots = []

    blocos.forEach(b=>{
      let inicio = toMin(b.inicio)
      let fim = toMin(b.fim)

      while(inicio + duracao <= fim){

        const conflito = ocupados.some(o =>
          !(inicio + duracao <= o[0] || inicio >= o[1])
        )

        if(!conflito){
          slots.push(toHour(inicio))
        }

        inicio += duracao
      }
    })

    if(!slots.length){
      return responder(cred, telefone, "❌ Sem horários disponíveis.")
    }

    let txt = "⏰ Horários disponíveis:\n\n"
    slots.forEach((h,i)=> txt += `${i+1} - ${h}\n`)

    await atualizar(telefone, loja_id, "hora", {
      data: dataISO,
      horarios: slots
    })

    return responder(cred, telefone, txt)
  }

  // HORÁRIO
  if(estado.etapa === "hora"){

    const index = Number(mensagem)-1
    const horario = estado.horarios[index]

    if(!horario){
      return responder(cred, telefone, "Escolha um horário válido.")
    }

    const fim = toHour(
      toMin(horario) + getDuracaoTotal(estado.servicos)
    )

    // 🔥 CHAMA SUA API REAL
    await fetch(process.env.APP_URL + "/api/create-agendamento", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        loja_id,
        data: estado.data,
        hora_inicio: horario,
        hora_fim: fim,
        servicos: estado.servicos,
        cliente_nome: "Cliente WhatsApp",
        cliente_whatsapp: telefone
      })
    })

    await sb.from("estado_conversa").delete().eq("telefone", telefone)

    return responder(cred, telefone,
`✅ Agendamento confirmado!

📅 ${estado.data}
⏰ ${horario}`
    )
  }

  res.sendStatus(200)
}

/* ================= FUNÇÕES ================= */

async function atualizar(telefone, loja_id, etapa, extra = {}){
  await sb.from("estado_conversa").upsert({
    telefone,
    loja_id,
    etapa,
    ...extra
  })
}

async function responder(cred, telefone, texto){
  await fetch(`https://graph.facebook.com/v19.0/${cred.phone_number_id}/messages`, {
    method:"POST",
    headers:{
      Authorization:`Bearer ${cred.access_token}`,
      "Content-Type":"application/json"
    },
    body: JSON.stringify({
      messaging_product:"whatsapp",
      to: telefone,
      type:"text",
      text:{ body:texto }
    })
  })
}
