import { createClient } from "@supabase/supabase-js";
import { enviarEmail } from "../lib/email.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body;

    console.log("📩 PAYLOAD:", body);

    const {
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

    // 1️⃣ SALVA AGENDAMENTO
    const { error: insertError } = await supabase
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
        cliente_id
      });

    if (insertError) {
      console.error("❌ ERRO INSERT:", insertError);
      throw insertError;
    }

    // 2️⃣ BUSCA EMAIL DA LOJA
    const { data: loja, error: lojaError } = await supabase
      .from("user_profile")
      .select("email_contato, negocio")
      .eq("user_id", loja_id)
      .single();

    if (lojaError) {
      console.warn("⚠️ Loja sem email:", lojaError.message);
    }

    // 3️⃣ ENVIA EMAIL
    if (loja?.email_contato) {
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
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("❌ ERRO GERAL:", err);
    return res.status(500).json({
      error: err.message || "Erro interno"
    });
  }
}
