import { createClient } from "@supabase/supabase-js";
import { enviarEmail } from "../lib/email.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export default async function handler(req, res) {

  // 🔓 CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    console.log("📩 PAYLOAD RECEBIDO:", body);

const {
  agendamento_id, // 🔥 NOVO
  loja_id,
  servico_id,
  servico_nome,
  valor_servico,
  data,
  hora_inicio,
  hora_fim,
  cliente_nome,
  cliente_whatsapp,
  cliente_email,
  cliente_id
} = body;


if (!loja_id || !data || !hora_inicio || !hora_fim) {
  return res.status(400).json({
    error: "Dados obrigatórios ausentes"
  });
}


  let dbError;

if (agendamento_id) {
  // ✏️ ALTERAÇÃO DE AGENDAMENTO
const { data: atualizado, error } = await supabase
  .from("agendamentos")
  .update({
    data,
    hora_inicio,
    hora_fim
  })
  .eq("id", agendamento_id)
  .eq("loja_id", loja_id)
  .eq("status", "CONFIRMADO")
  .select()
  .single();

if (!atualizado) {
  return res.status(404).json({
    error: "Agendamento não encontrado ou não pertence à loja"
  });
}

dbError = error;

} else {
  // ➕ CRIAÇÃO DE AGENDAMENTO
  const { error } = await supabase
    .from("agendamentos")
    .insert({
      user_id: loja_id,
      loja_id,
      servico_id,
      valor_servico,
      data,
      hora_inicio,
      hora_fim,
      cliente_nome,
      cliente_whatsapp,
      cliente_email,
      cliente_id
    });

  dbError = error;
}

if (dbError) {
  console.error("❌ ERRO AO SALVAR AGENDAMENTO:", dbError);
  return res.status(500).json({
    error: "Erro ao salvar agendamento",
    detail: dbError.message
  });
}


    console.log("✅ Agendamento salvo com sucesso");

    // 2️⃣ BUSCA EMAIL DA LOJA (CORRETO)
    const { data: loja, error: lojaError } = await supabase
      .from("user_profile")
      .select("email_contato, negocio")
      .eq("user_id", loja_id)
      .single();

    if (lojaError) {
      console.warn("⚠️ Erro ao buscar loja:", lojaError.message);
    }

    // 3️⃣ ENVIA EMAIL (SEM QUEBRAR A API)
if (!agendamento_id && loja?.email_contato) {
      try {
        console.log("📧 Enviando email para:", loja.email_contato);

        await enviarEmail({
          to: loja.email_contato,
          subject: "📅 Novo agendamento realizado",
          html: `
            <h2>Novo agendamento</h2>
            <p><strong>Negócio:</strong> ${loja.negocio}</p>
            <p><strong>Cliente:</strong> ${cliente_nome}</p>
            <p><strong>WhatsApp:</strong> ${cliente_whatsapp}</p>
            <p><strong>Serviço:</strong> ${servico_nome}</p>
            <p><strong>Data:</strong> ${data}</p>
            <p><strong>Horário:</strong> ${hora_inicio} - ${hora_fim}</p>
          `
        });

        console.log("✅ Email enviado com sucesso");

      } catch (emailError) {
        console.error("❌ ERRO AO ENVIAR EMAIL:", emailError);
        // ⚠️ NÃO quebra a API
      }
    } else {
      console.warn("⚠️ Loja não possui email_contato cadastrado");
    }

return res.status(200).json({
  success: true,
  message: agendamento_id
    ? "Agendamento alterado com sucesso"
    : "Agendamento criado com sucesso"
});

  } catch (err) {
    console.error("🔥 ERRO GERAL NA API:", err);
    return res.status(500).json({
      error: "Erro interno no servidor",
      detail: err.message
    });
  }
}
