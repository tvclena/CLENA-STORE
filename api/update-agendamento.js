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
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    console.log("📩 UPDATE PAYLOAD:", body);

    const {
      agendamento_id,
      loja_id,
      novo_status,

      data,
      hora_inicio,
      hora_fim,
      servico_id,
      servico_nome,
      valor_servico,

      motivo
    } = body;

    /* ================= VALIDAÇÃO ================= */
    if (!agendamento_id || !loja_id || !novo_status) {
      return res.status(400).json({
        error: "Parâmetros obrigatórios ausentes"
      });
    }

    /* ================= MONTA UPDATE ================= */
    const updatePayload = {
      status: novo_status
    };

    if (data) updatePayload.data = data;
    if (hora_inicio) updatePayload.hora_inicio = hora_inicio;
    if (hora_fim) updatePayload.hora_fim = hora_fim;
    if (servico_id) updatePayload.servico_id = servico_id;
    if (servico_nome) updatePayload.servico_nome = servico_nome;
    if (valor_servico !== undefined) updatePayload.valor_servico = valor_servico;

    /* ================= UPDATE AGENDAMENTO ================= */
    const { error: updateError } = await supabase
      .from("agendamentos")
      .update(updatePayload)
      .eq("id", agendamento_id);

    if (updateError) {
      console.error("❌ ERRO UPDATE:", updateError);
      throw updateError;
    }

    console.log("✅ Agendamento atualizado com sucesso");

    /* ================= BUSCA AGENDAMENTO ================= */
    const { data: ag } = await supabase
      .from("agendamentos")
      .select("data,hora_inicio,hora_fim,cliente_nome")
      .eq("id", agendamento_id)
      .single();

    /* ================= BUSCA LOJA ================= */
    const { data: loja } = await supabase
      .from("user_profile")
      .select("email_contato, negocio")
      .eq("user_id", loja_id)
      .single();

    /* ================= EMAIL ================= */
    if (loja?.email_contato) {
      try {
        const titulo =
          novo_status === "CANCELADO"
            ? "❌ Agendamento cancelado"
            : "🔄 Agendamento alterado";

        await enviarEmail({
          to: loja.email_contato,
          subject: titulo,
          html: `
            <h2>${titulo}</h2>
            <p><strong>Negócio:</strong> ${loja.negocio}</p>
            <p><strong>Cliente:</strong> ${ag?.cliente_nome || "-"}</p>
            <p><strong>Data:</strong> ${ag?.data}</p>
            <p><strong>Horário:</strong> ${ag?.hora_inicio} - ${ag?.hora_fim}</p>
            <p><strong>Status:</strong> ${novo_status}</p>
            <p><strong>Motivo:</strong> ${motivo || "Atualização pelo cliente"}</p>
          `
        });

        console.log("📧 Email enviado com sucesso");
      } catch (mailErr) {
        console.error("❌ ERRO EMAIL:", mailErr);
      }
    }

    /* ================= SUCESSO ================= */
    return res.status(200).json({
      success: true
    });

  } catch (err) {
    console.error("🔥 ERRO UPDATE AGENDAMENTO:", err);
    return res.status(500).json({
      error: "Erro ao atualizar agendamento",
      detail: err.message
    });
  }
}
