import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

/* ================= UTIL ================= */

function limparNumero(numero){
 if(!numero) return ""
 return numero.replace(/\D/g,"")
}

function obterDataSistema(){

 const agora = new Date()

 const dataAtual = agora.toLocaleDateString("pt-BR",{timeZone:"America/Sao_Paulo"})
 const horaAtual = agora.toLocaleTimeString("pt-BR",{timeZone:"America/Sao_Paulo"})
 const diaSemana = agora.toLocaleDateString("pt-BR",{weekday:"long",timeZone:"America/Sao_Paulo"})
 const dataISO = agora.toISOString().split("T")[0]

 return {dataAtual,horaAtual,diaSemana,dataISO}

}

/* ================= CALCULAR HORARIOS ================= */

function gerarHorariosLivres(intervalos,ocupados,duracao){

 const livres=[]

 intervalos.forEach(intervalo=>{

  let [h,m]=intervalo.inicio.split(":").map(Number)
  const [hf,mf]=intervalo.fim.split(":").map(Number)

  while(h<hf || (h===hf && m<mf)){

   const hora=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`

   if(!ocupados.includes(hora)){
    livres.push(hora)
   }

   m+=duracao

   while(m>=60){
    m-=60
    h++
   }

  }

 })

 return livres
}

/* ================= HANDLER ================= */

export default async function handler(req,res){

/* ================= VERIFY ================= */

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

/* ================= EVENTO WHATSAPP ================= */

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

/* ================= BLOQUEAR DUPLICIDADE ================= */

 const {data:jaProcessada} = await supabase
 .from("mensagens_processadas")
 .select("*")
 .eq("message_id",message_id)
 .maybeSingle()

 if(jaProcessada){
  return res.status(200).end()
 }

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

 if(!loja){
  console.log("Loja não encontrada")
  return res.status(200).end()
 }

/* ================= SALVAR MSG ================= */

 await supabase
 .from("conversas_whatsapp")
 .insert({
  telefone:cliente,
  loja_id:loja.id,
  mensagem:mensagem,
  role:"user"
 })

/* ================= HISTORICO ================= */

 const {data:historico} = await supabase
 .from("conversas_whatsapp")
 .select("*")
 .eq("telefone",cliente)
 .eq("loja_id",loja.id)
 .order("created_at",{ascending:false})
 .limit(15)

 const mensagens = historico
 ? historico.reverse().map(m=>({
   role:m.role,
   content:m.mensagem
  }))
 : []

/* ================= SERVICOS ================= */

 const {data:servicos} = await supabase
 .from("produtos_servicos")
 .select("*")
 .eq("user_id",loja.user_id)
 .eq("ativo",true)

 let listaServicos=""

 if(servicos){

 listaServicos = servicos.map(s=>`

${s.nome}
Preço: R$ ${s.preco}
Duração: ${s.duracao_minutos || 30} min

`).join("\n")

 }

/* ================= DATA ================= */

 const sistema = obterDataSistema()

/* ================= OPENAI ================= */

 let resposta=""

 try{

 const completion = await openai.chat.completions.create({

 model:"gpt-4.1-mini",

 messages:[

 {
 role:"system",
 content:`

Você é o assistente oficial da loja ${loja.negocio}.

Nunca invente informações.
Use apenas dados fornecidos.

Hoje é ${sistema.diaSemana} ${sistema.dataAtual}.

SERVIÇOS:

${listaServicos}

Se cliente pedir agendamento gere:

AGENDAMENTO_JSON:

{
"nome":"",
"telefone":"",
"data":"",
"hora":"",
"servico":""
}

Nunca invente horários.

`
 },

 ...mensagens,

 {
 role:"user",
 content:mensagem
 }

 ]

 })

 resposta = completion.choices[0].message.content

 }catch(e){

 resposta="Olá 👋 Como posso ajudar?"

 }

/* ================= PROCESSAR AGENDAMENTO ================= */

 try{

 const match = resposta.match(/AGENDAMENTO_JSON:\s*({[\s\S]*?})/)

 if(match){

 const agendamento = JSON.parse(match[1])

 const servico = servicos.find(
 s=>s.nome.toLowerCase()===agendamento.servico.toLowerCase()
 )

 if(!servico){

 resposta="Esse serviço não existe na loja."

 }else{

 const {data:agenda} = await supabase
 .from("agenda_loja")
 .select("*")
 .eq("user_id",loja.user_id)
 .eq("data",agendamento.data)
 .maybeSingle()

 if(!agenda){

 resposta="Não há agenda para esse dia."

 }else{

 if(agenda.fechado){

 resposta="A loja estará fechada nesse dia."

 }else{

 const intervalos = JSON.parse(agenda.horarios)

 const {data:ocupados} = await supabase
 .from("agendamentos")
 .select("hora")
 .eq("loja_id",loja.id)
 .eq("data",agendamento.data)

 const horasOcupadas = ocupados?.map(o=>o.hora) || []

 const horariosLivres = gerarHorariosLivres(
 intervalos,
 horasOcupadas,
 servico.duracao_minutos || 30
 )

 if(!horariosLivres.includes(agendamento.hora)){

 resposta=`Esse horário não está disponível.

Horários livres:

${horariosLivres.slice(0,6).join("\n")}`

 }else{

 await supabase
 .from("agendamentos")
 .insert({

 loja_id:loja.id,
 nome:agendamento.nome,
 telefone:cliente,
 data:agendamento.data,
 hora:agendamento.hora,
 servico:servico.nome

 })

 resposta="✅ Agendamento confirmado!"

 }

 }

 }

 }

 }

 }catch(e){

 console.log("Erro agenda",e)

 }

/* ================= SALVAR RESPOSTA ================= */

 await supabase
 .from("conversas_whatsapp")
 .insert({
 telefone:cliente,
 loja_id:loja.id,
 mensagem:resposta,
 role:"assistant"
 })

/* ================= ENVIAR WHATSAPP ================= */

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
 text:{body:resposta}

 })

 })

 }catch(e){

 console.log("Erro geral",e)

 }

 return res.status(200).end()

}

}
