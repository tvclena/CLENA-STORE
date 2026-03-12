import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

/* ================= CONFIG ================= */

const openai = new OpenAI({
 apiKey:process.env.OPENAI_API_KEY
})

const supabase = createClient(
 process.env.SUPABASE_URL,
 process.env.SUPABASE_SERVICE_ROLE
)

/* ================= UTIL ================= */

function limparNumero(n){
 return n.replace(/\D/g,"")
}

function hoje(){
 return new Date().toISOString().split("T")[0]
}

function somarMinutos(hora,duracao){

 const [h,m] = hora.split(":").map(Number)

 let total = h*60 + m + duracao

 const nh = Math.floor(total/60)
 const nm = total % 60

 return `${String(nh).padStart(2,"0")}:${String(nm).padStart(2,"0")}:00`
}

/* ================= GERAR HORÁRIOS ================= */

function gerarHorarios(intervalos,ocupados,duracao){

const livres=[]

intervalos.forEach(i=>{

 let [h,m] = i.inicio.split(":").map(Number)
 const [hf,mf] = i.fim.split(":").map(Number)

 while(h<hf || (h===hf && m<mf)){

  const hora=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`

  if(!ocupados.includes(hora)){
   livres.push(hora)
  }

  m += duracao

  while(m>=60){
   m -= 60
   h++
  }

 }

})

return livres
}

/* ================= HANDLER ================= */

export default async function handler(req,res){

/* ===== VERIFY TOKEN ===== */

if(req.method==="GET"){

 const mode=req.query["hub.mode"]
 const token=req.query["hub.verify_token"]
 const challenge=req.query["hub.challenge"]

 if(mode==="subscribe" && token===process.env.VERIFY_TOKEN){
  return res.status(200).send(challenge)
 }

 return res.status(403).send("erro")
}

/* ===== RECEBER EVENTO ===== */

if(req.method==="POST"){

try{

const body=req.body

const change = body.entry?.[0]?.changes?.[0]?.value

if(!change?.messages) return res.status(200).end()

const msg = change.messages[0]

const texto = msg.text?.body
const telefone = limparNumero(msg.from)
const phone_number_id = change.metadata.phone_number_id

/* ================= IDENTIFICAR LOJA ================= */

const {data:loja} = await supabase
.from("user_profile")
.select("*")
.eq("phone_number_id",phone_number_id)
.single()

if(!loja) return res.status(200).end()

/* ================= SERVIÇOS ================= */

const {data:servicos} = await supabase
.from("produtos_servicos")
.select("*")
.eq("user_id",loja.user_id)
.eq("ativo",true)

/* ================= MEMÓRIA CLIENTE ================= */

const {data:memoria} = await supabase
.from("agendamentos")
.select("cliente_nome")
.eq("cliente_whatsapp",telefone)
.eq("loja_id",loja.id)
.order("created_at",{ascending:false})
.limit(1)
.maybeSingle()

const nomeCliente = memoria?.cliente_nome || null

/* ================= AGENDA ================= */

const data = hoje()

const {data:agenda} = await supabase
.from("agenda_loja")
.select("*")
.eq("user_id",loja.user_id)
.eq("data",data)
.single()

let horariosLivres=[]

if(agenda){

 const intervalos = typeof agenda.horarios==="string"
  ? JSON.parse(agenda.horarios)
  : agenda.horarios

 const {data:agendados} = await supabase
 .from("agendamentos")
 .select("hora_inicio")
 .eq("loja_id",loja.id)
 .eq("data",data)
 .eq("status","CONFIRMADO")

 const ocupados = agendados?.map(a=>
  a.hora_inicio.substring(0,5)
 ) || []

 horariosLivres = gerarHorarios(
  intervalos,
  ocupados,
  30
 )

}

/* ================= LISTA SERVIÇOS ================= */

const listaServicos = servicos.map(s=>
`${s.nome} — R$${s.preco}`
).join("\n")

const listaHorarios = horariosLivres.join("\n")

/* ================= IA ================= */

const completion = await openai.chat.completions.create({

model:"gpt-4.1-mini",

messages:[

{
role:"system",
content:`

Você é atendente da ${loja.negocio}.

Serviços:

${listaServicos}

Horários disponíveis hoje:

${listaHorarios}

Regras:

• responda natural
• não invente horários
• não invente serviços
• confirme antes de agendar

Se cliente quiser agendar use:

AGENDAR_JSON

{
"servico":"",
"hora":"",
"nome":""
}

`
},

{
role:"user",
content:texto
}

]

})

let resposta = completion.choices[0].message.content

/* ================= DETECTAR AGENDAMENTO ================= */

try{

const match = resposta.match(/AGENDAR_JSON:\s*({[\s\S]*?})/)

if(match){

const dados = JSON.parse(match[1])

const servico = servicos.find(s=>
s.nome.toLowerCase() === dados.servico.toLowerCase()
)

const hora = dados.hora

if(!horariosLivres.includes(hora)){

resposta=`Esse horário já foi ocupado.

Horários livres:

${listaHorarios}`

}else{

const hora_inicio=`${hora}:00`

const hora_fim = somarMinutos(hora,servico.duracao_minutos)

await supabase
.from("agendamentos")
.insert({

loja_id:loja.id,
user_id:loja.user_id,

servico_id:servico.id,

data:data,

hora_inicio:hora_inicio,
hora_fim:hora_fim,

cliente_nome:dados.nome || nomeCliente,
cliente_whatsapp:telefone,

status:"CONFIRMADO",

valor_servico:servico.preco,
servico_nome:servico.nome,

servicos:JSON.stringify([{
id:servico.id,
nome:servico.nome,
preco:servico.preco,
duracao:servico.duracao_minutos
}]),

valor_total:servico.preco,
duracao_total:servico.duracao_minutos

})

resposta=`

✅ Agendamento confirmado

Serviço: ${servico.nome}
Data: ${data}
Horário: ${hora}

Te esperamos 👍
`

}

}

}catch(e){}

/* ================= ENVIAR WHATSAPP ================= */

await fetch(`https://graph.facebook.com/v19.0/${phone_number_id}/messages`,{

method:"POST",

headers:{
Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`,
"Content-Type":"application/json"
},

body:JSON.stringify({

messaging_product:"whatsapp",

to:telefone,

type:"text",

text:{body:resposta}

})

})

}catch(e){

console.log(e)

}

return res.status(200).end()

}

}
