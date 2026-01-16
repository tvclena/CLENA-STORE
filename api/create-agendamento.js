import { createClient } from "@supabase/supabase-js";
import { enviarEmail } from "../lib/email.js";
import { firebaseAdmin } from "../lib/firebaseAdmin.js";

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
    const body = typeof req.body === "string"
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
      return res.status(400).json({ error: "Dados obrigatórios ausentes" });
    }

    /* ================= NORMALIZA VALOR ================= */
    const valorFinal = Number(valor_servico);
    if (isNaN(valorFinal)) {
      return res.status(400).json({ error: "Valor inválido" });
    }

    /* ================= SALVA AGENDAMENTO ================= */
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
      return res.status(500).json({ error: "Erro ao salvar agendamento" });
    }

    console.log("✅ Agendamento salvo");

    /* ================= DADOS DA LOJA ================= */
    const { data: loja } = await supabase
      .from("user_profile")
      .select("email_contato, negocio")
      .eq("user_id", loja_id)
      .single();

    /* ================= EMAIL ================= */
    if (loja?.email_contato) {
      try {
        await enviarEmail({
          to: loja.email_contato,
          subject: "📅 Novo agendamento",
          html: `
            <h2>Novo agendamento</h2>
            <p><strong>Cliente:</strong> ${cliente_nome}</p>
            <p><strong>WhatsApp:</strong> ${cliente_whatsapp}</p>
            <p><strong>Serviço:</strong> ${servico_nome}</p>
            <p><strong>Valor:</strong> R$ ${valorFinal.toFixed(2)}</p>
            <p><strong>Data:</strong> ${data}</p>
            <p><strong>Horário:</strong> ${hora_inicio} - ${hora_fim}</p>
          `
        });
        console.log("📧 Email enviado");
      } catch (e) {
        console.warn("⚠️ Falha no email:", e.message);
      }
    }

    /* ================= PUSH NOTIFICATION ================= */
    const { data: tokens } = await supabase
      .from("notificacoes_tokens")
      .select("token")
      .eq("user_id", loja_id);

    if (tokens?.length) {

      const mensagem = {
        tokens: tokens.map(t => t.token),

        notification: {
          title: "📅 Novo agendamento",
          body: `${cliente_nome} agendou ${servico_nome} às ${hora_inicio}`
        },

        android: {
          priority: "high",
          notification: {
            channelId: "agendamentos",
            sound: "default",
            visibility: "public"
          }
        },

        data: {
          tipo: "AGENDAMENTO",
          loja_id: String(loja_id),
          data: String(data),
          hora_inicio: String(hora_inicio)
        }
      };

      try {
        const resp = await firebaseAdmin
          .messaging()
          .sendEachForMulticast(mensagem);

        console.log("🔔 PUSH:", resp.successCount, "enviados");
      } catch (err) {
        console.error("❌ ERRO PUSH:", err);
      }
    }

    /* ================= RESPOSTA ================= */
    return res.status(200).json({
      success: true,
      message: "Agendamento criado e notificação enviada"
    });

  } catch (err) {
    console.error("🔥 ERRO GERAL:", err);
    return res.status(500).json({ error: "Erro interno", detail: err.message });
  }
}
