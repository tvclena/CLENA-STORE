import { createClient } from "@supabase/supabase-js";
import { enviarEmail } from "../lib/email.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export default async function handler(req, res) {

  /* ================= CORS ================= */
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
    /* ================= PAYLOAD ================= */
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    console.log("📩 PAYLOAD RECEBIDO:", body);

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

    /* ================= VALIDAÇÃO ================= */
    if (
      !loja_id ||
      !servico_id ||
      !data ||
      !hora_inicio ||
      !hora_fim ||
      !cliente_nome ||
      !cliente_whatsapp
    ) {
      return res.status(400).json({
        error: "Dados obrigatórios ausentes"
      });
    }

    /* ================= NORMALIZA VALOR ================= */
    const valorFinal = Number(valor_servico);
    if (isNaN(valorFinal)) {
      return res.status(400).json({
        error: "Valor do serviço inválido"
      });
    }

    /* ================= INSERÇÃO ================= */
    const { error: insertError } = await supabase
      .from("agendamentos")
      .insert({
        user_id: loja_id,
        loja_id,
        servico_id,
        servico_nome,
        valor_servico: valorFinal,
        data,
        hora_inicio,
        hora_fim,
        cliente_nome,
        cliente_whatsapp,
        cliente_email: cliente_email || null,
        cliente_id: cliente_id || null,
        status: "CONFIRMADO"
      });

    if (insertError) {
      console.error("❌ ERRO AO INSERIR:", insertError);
      return res.status(500).json({
        error: "Erro ao salvar agendamento",
        detail: insertError.message
      });
    }

    console.log("✅ Agendamento salvo com sucesso");

    /* ================= EMAIL DA LOJA ================= */
    const { data: loja, error: lojaError } = await supabase
      .from("user_profile")
      .select("email_contato, negocio")
      .eq("user_id", loja_id)
      .single();

    if (lojaError) {
      console.warn("⚠️ Erro ao buscar loja:", lojaError.message);
    }

    /* ================= ENVIO DE EMAIL ================= */
    if (loja?.email_contato) {
      try {
        await enviarEmail({
          to: loja.email_contato,
          subject: "📅 Novo agendamento realizado",
          html: `
            <h2>Novo agendamento</h2>
            <p><strong>Negócio:</strong> ${loja.negocio}</p>
            <p><strong>Cliente:</strong> ${cliente_nome}</p>
            <p><strong>WhatsApp:</strong> ${cliente_whatsapp}</p>
            <p><strong>Serviço:</strong> ${servico_nome}</p>
            <p><strong>Valor:</strong> R$ ${valorFinal.toFixed(2)}</p>
            <p><strong>Data:</strong> ${data}</p>
            <p><strong>Horário:</strong> ${hora_inicio} - ${hora_fim}</p>
          `
        });

        console.log("📧 Email enviado com sucesso");

      } catch (emailError) {
        console.warn("⚠️ Falha ao enviar email:", emailError.message);
      }
    }

    /* ================= RESPOSTA ================= */
    return res.status(200).json({
      success: true,
      message: "Agendamento criado com sucesso"
    });

  } catch (err) {
    console.error("🔥 ERRO GERAL:", err);
    return res.status(500).json({
      error: "Erro interno no servidor",
      detail: err.message
    });
  }
}
