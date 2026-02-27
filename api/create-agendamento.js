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

    /* ================= EXTRAI DADOS ================= */
    const {
      loja_id,
      servicos,
      valor_total,
      duracao_total,
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
      !Array.isArray(servicos) ||
      servicos.length === 0 ||
      !data ||
      !hora_inicio ||
      !hora_fim ||
      !cliente_nome ||
      !cliente_whatsapp
    ) {
      return res.status(400).json({
        error: "Dados obrigatórios ausentes ou inválidos"
      });
    }

    /* ================= SALVA AGENDAMENTO ================= */
    const { error: insertError } = await supabase
      .from("agendamentos")
      .insert({
        user_id: loja_id,
        loja_id,

        servicos,          // jsonb
        valor_total,
        duracao_total,

        data,
        hora_inicio,
        hora_fim,

        cliente_nome,
        cliente_whatsapp,
        cliente_email: cliente_email || null,
        cliente_id: cliente_id || null
      });

    if (insertError) {
      console.error("❌ ERRO AO INSERIR AGENDAMENTO:", insertError);
      return res.status(500).json({
        error: "Erro ao salvar agendamento",
        detail: insertError.message
      });
    }

    console.log("✅ Agendamento salvo com sucesso");

    /* ================= BUSCA EMAIL DA LOJA ================= */
    const { data: loja } = await supabase
      .from("user_profile")
      .select("email_contato, negocio")
      .eq("user_id", loja_id)
      .single();

    /* ================= ENVIA EMAIL ================= */
    if (loja?.email_contato) {
      try {
        const listaServicos = servicos.map(s => s.nome).join(", ");

        await enviarEmail({
          to: loja.email_contato,
          subject: "📅 Novo agendamento realizado",
          html: `
            <h2>Novo agendamento</h2>
            <p><strong>Negócio:</strong> ${loja.negocio}</p>
            <p><strong>Cliente:</strong> ${cliente_nome}</p>
            <p><strong>WhatsApp:</strong> ${cliente_whatsapp}</p>

            <p><strong>Serviços:</strong> ${listaServicos}</p>
            <p><strong>Valor total:</strong> R$ ${valor_total}</p>
            <p><strong>Duração:</strong> ${duracao_total} min</p>

            <p><strong>Data:</strong> ${data}</p>
            <p><strong>Horário:</strong> ${hora_inicio} - ${hora_fim}</p>
          `
        });

        console.log("✅ Email enviado com sucesso");

      } catch (emailError) {
        console.error("❌ ERRO AO ENVIAR EMAIL:", emailError);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Agendamento criado com sucesso"
    });

  } catch (err) {
    console.error("🔥 ERRO GERAL NA API:", err);
    return res.status(500).json({
      error: "Erro interno no servidor",
      detail: err.message
    });
  }
}
