const OpenAI = require("openai")
const { createClient } = require("@supabase/supabase-js")

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
)

module.exports = async function handler(req,res){

/* ================= WEBHOOK VERIFY ================= */

if(req.method==="GET"){

const verify_token = process.env.VERIFY_TOKEN
const mode = req.query["hub.mode"]
const token = req.query["hub.verify_token"]
const challenge = req.query["hub.challenge"]

if(mode && token===verify_token){
return res.status(200).send(challenge)
}

return res.status(403).end()

}

/* ================= RECEBER EVENTO ================= */

if(req.method==="POST"){

const body=req.body

try{

const change = body.entry?.[0]?.changes?.[0]?.value

if(!change) return res.status(200).end()

if(!change.messages) return res.status(200).end()

const msg = change.messages[0]

const cliente = msg.from
const mensagem = msg.text?.body
const message_id = msg.id

if(!mensagem) return res.status(200).end()

/* ================= BLOQUEAR DUPLICIDADE ================= */

const { data: jaProcessada } = await supabase
.from("mensagens_processadas")
.select("*")
.eq("message_id", message_id)
.single()

if(jaProcessada){
return res.status(200).end()
}

await supabase
.from("mensagens_processadas")
.insert({ message_id })

/* ================= IDENTIFICAR LOJA ================= */

const phone_number_id = change.metadata.phone_number_id

const {data:loja} = await supabase
.from("lojas")
.select("*")
.eq("phone_number_id",phone_number_id)
.single()

if(!loja){

console.log("Loja não encontrada")

return res.status(200).end()

}

/* ================= SALVAR MENSAGEM ================= */

await supabase
.from("conversas_whatsapp")
.insert({
telefone:cliente,
loja_id:loja.id,
mensagem:mensagem,
role:"user"
})

/* ================= HISTÓRICO ================= */

const {data:historico} = await supabase
.from("conversas_whatsapp")
.select("*")
.eq("telefone",cliente)
.order("created_at",{ascending:true})
.limit(15)

const mensagens = historico.map(m=>({
role:m.role,
content:m.mensagem
}))

/* ================= BUSCAR PRODUTOS ================= */

const {data:produtos} = await supabase
.from("produtos")
.select("nome,preco")
.limit(20)

let listaProdutos=""

if(produtos){

listaProdutos = produtos.map(p=>`${p.nome} - R$ ${p.preco}`).join("\n")

}

/* ================= OPENAI ================= */

let resposta=""

try{

const completion = await openai.chat.completions.create({

model:"gpt-4.1-mini",

messages:[

{
role:"system",
content:`

Você é o assistente oficial da loja ${loja.nome}.

Endereço:
${loja.endereco}

Horário:
${loja.horario}

Instagram:
${loja.instagram}

PRODUTOS DISPONÍVEIS:
${listaProdutos}

Seu trabalho é:

• responder clientes
• mostrar produtos
• criar agendamentos
• criar pedidos
• gerar pagamento

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

----------------------------------

PAGAMENTO_JSON:

{
pedido_id:"",
valor:""
}

----------------------------------

REGRAS

Nunca gere JSON sem confirmação.

Sempre confirme antes.

`
},

...mensagens

]

})

resposta = completion.choices[0].message.content

}catch(e){

resposta = "Olá 👋 Como posso ajudar?"

}

/* ================= PROCESSAR AGENDAMENTO ================= */

try{

const agendamentoMatch = resposta.match(/AGENDAMENTO_JSON:\s*({[\s\S]*?})/)

if(agendamentoMatch){

const agendamento = JSON.parse(agendamentoMatch[1])

await fetch(process.env.URL_API+"/create-agendamento",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
nome:agendamento.nome,
telefone:cliente,
data:agendamento.data,
hora:agendamento.hora,
servico:agendamento.servico,
loja_id:loja.id
})

})

resposta="✅ Agendamento confirmado!"

}

}catch(e){

console.log("erro agendamento",e)

}

/* ================= PROCESSAR PEDIDO ================= */

try{

const pedidoMatch = resposta.match(/PEDIDO_JSON:\s*({[\s\S]*?})/)

if(pedidoMatch){

const pedido = JSON.parse(pedidoMatch[1])

await fetch(process.env.URL_API+"/handlers/pedido",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
cliente:cliente,
itens:pedido.itens,
loja_id:loja.id
})

})

resposta="🧾 Pedido criado com sucesso!"

}

}catch(e){

console.log("erro pedido",e)

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

text:{
body:resposta
}

})

})

}catch(e){

console.log("erro geral",e)

}

return res.status(200).end()

}

}
