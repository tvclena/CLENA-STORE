import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

/* ================= UTIL ================= */

function limparNumero(numero){
 if(!numero) return ""
 return numero.replace(/\D/g,"")
}

function dataHoje(){
 return new Date().toISOString().split("T")[0]
}

function somarMinutos(hora,duracao){

 const [h,m] = hora.split(":").map(Number)

 let minutos = h*60 + m + duracao

 const nh = Math.floor(minutos/60)
 const nm = minutos % 60

 return `${String(nh).padStart(2,"0")}:${String(nm).padStart(2,"0")}:00`
}

/* ================= HORARIOS LIVRES ================= */

function gerarHorariosLivres(intervalos,ocupados,duracao){

 const livres=[]

 intervalos.forEach(intervalo=>{

  let [h,m] = intervalo.inicio.split(":").map(Number)
  const [hf,mf] = intervalo.fim.split(":").map(Number)

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

if(req.method==="GET"){

 const verify_token = process.env.VERIFY_TOKEN

 const mode = req.query["hub.mode"]
 const token = req.query["hub.verify_token"]
 const challenge = req.query["hub.challenge"]

 if(mode==="subscribe" && token===verify_token){
  return res.status(200).send(challenge)
 }

 return res.status(403).send("Erro verificação")
}

if(req.method==="POST"){

try{

const openai = new OpenAI({
 apiKey:process.env.OPENAI_API_KEY
})

const supabase = createClient(
 process.env.SUPABASE_URL,
 process.env.SUPABASE_SERVICE_ROLE
)

const body=req.body

const change = body.entry?.[0]?.changes?.[0]?.value

if(!change) return res.status(200).end()
if(!change.messages) return res.status(200).end()

const msg = change.messages[0]

const cliente = limparNumero(msg.from)
const mensagem = msg.text?.body
const message_id = msg.id

if(!mensagem) return res.status(200).end()

/* ================= DUPLICIDADE ================= */

const {data:jaProcessada} = await supabase
.from("mensagens_processadas")
.select("*")
.eq("message_id",message_id)
.maybeSingle()

if(jaProcessada) return res.status(200).end()

await supabase
.from("mensagens_processadas")
.insert({message_id})

/* ================= IDENTIFICAR LOJA ================= */

const phone_number_id = change.metadata.phone_number_id

const {data:loja} = await supabase
.from("user_profile")
.select("*")
.eq("phone_number_id",phone_number_id)
.maybeSingle()

if(!loja) return res.status(200).end()

/* ================= MEMÓRIA DO CLIENTE ================= */

const {data:ultimoCliente} = await supabase
.from("agendamentos")
.select("cliente_nome")
.eq("cliente_whatsapp",cliente)
.eq("loja_id",loja.id)
.order("created_at",{ascending:false})
.limit(1)
.maybeSingle()

let nomeCliente = ultimoCliente?.cliente_nome || null

/* ================= SERVIÇOS ================= */

const {data:servicos} = await supabase
.from("produtos_servicos")
.select("*")
.eq("user_id",loja.user_id)
.eq("ativo",true)

/* ================= INTERPRETAR MENSAGEM ================= */

let interpretacao={}

try{

const completion = await openai.chat.completions.create({

model:"gpt-4.1-mini",

response_format:{type:"json_object"},

messages:[

{
role:"system",
content:`
Extraia da mensagem:

servico
hora
nome

{
"servico":"",
"hora":"",
"nome":""
}
`
},

{
role:"user",
content:mensagem
}

]

})

interpretacao = JSON.parse(completion.choices[0].message.content)

}catch(e){}

/* ================= SERVIÇO ================= */

const servico = servicos?.find(s=>
 interpretacao.servico?.toLowerCase().includes(s.nome.toLowerCase())
)

if(!servico){

const lista = servicos.map(s=>`• ${s.nome}`).join("\n")

await enviar(cliente,phone_number_id,
`Qual serviço deseja?

${lista}`)

return res.status(200).end()

}

/* ================= HORA ================= */

const hora = interpretacao.hora

if(!hora){

await enviar(cliente,phone_number_id,
`Qual horário deseja para ${servico.nome}?`)

return res.status(200).end()

}

/* ================= DATA ================= */

const data = dataHoje()

/* ================= AGENDA ================= */

const {data:agenda} = await supabase
.from("agenda_loja")
.select("*")
.eq("user_id",loja.user_id)
.eq("data",data)
.maybeSingle()

if(!agenda){

await enviar(cliente,phone_number_id,
"A agenda não está cadastrada para hoje.")

return res.status(200).end()

}

const intervalos = JSON.parse(agenda.horarios)

/* ================= AGENDAMENTOS ================= */

const {data:ocupados} = await supabase
.from("agendamentos")
.select("hora_inicio")
.eq("loja_id",loja.id)
.eq("data",data)

const horasOcupadas = ocupados?.map(o=>o.hora_inicio.substring(0,5)) || []

const horariosLivres = gerarHorariosLivres(
 intervalos,
 horasOcupadas,
 servico.duracao_minutos || 30
)

/* ================= OCUPADO ================= */

if(!horariosLivres.includes(hora)){

await enviar(cliente,phone_number_id,

`Esse horário não está disponível.

Horários livres:

${horariosLivres.slice(0,6).join("\n")}`)

return res.status(200).end()

}

/* ================= NOME ================= */

if(!nomeCliente){

nomeCliente = interpretacao.nome

if(!nomeCliente){

await enviar(cliente,phone_number_id,
"Qual seu nome para confirmar o agendamento?")

return res.status(200).end()

}

}

/* ================= CONFIRMAÇÃO ================= */

const hora_inicio=`${hora}:00`
const hora_fim = somarMinutos(hora,servico.duracao_minutos || 30)

await enviar(cliente,phone_number_id,

`Confirma seu agendamento?

Serviço: ${servico.nome}
Data: ${data}
Horário: ${hora}

Digite CONFIRMAR para concluir.`)

if(mensagem.toLowerCase()==="confirmar"){

await supabase
.from("agendamentos")
.insert({

loja_id:loja.id,
user_id:loja.user_id,

servico_id:servico.id,

data:data,

hora_inicio:hora_inicio,
hora_fim:hora_fim,

cliente_nome:nomeCliente,
cliente_whatsapp:cliente,

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

await enviar(cliente,phone_number_id,

`✅ Agendamento confirmado!

Serviço: ${servico.nome}
Data: ${data}
Horário: ${hora}

Até breve.`)

}

}catch(e){

console.log(e)

}

return res.status(200).end()

}

}

/* ================= ENVIAR WHATSAPP ================= */

async function enviar(cliente,phone_number_id,texto){

const url=`https://graph.facebook.com/v19.0/${phone_number_id}/messages`

await fetch(url,{

method:"POST",

headers:{
Authorization:`Bearer ${process.env.WHATSAPP_TOKEN}`,
"Content-Type":"application/json"
},

body:JSON.stringify({

messaging_product:"whatsapp",
to:cliente,
type:"text",
text:{body:texto}

})

})

}
