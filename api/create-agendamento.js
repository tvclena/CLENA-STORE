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

    const valorFinal = Number(valor_servico) || 0;

    /* ================= SALVA AGENDAMENTO ================= */
    const { error } = await supabase
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

    if (error) {
      console.error("❌ ERRO AO SALVAR:", error);
      return res.status(500).json({ error: "Erro ao salvar agendamento" });
    }

    /* ================= EMAIL ================= */
    const { data: loja } = await supabase
      .from("user_profile")
      .select("email_contato, negocio")
      .eq("user_id", loja_id)
      .single();

    if (loja?.email_contato) {
      try {
        await enviarEmail({
          to: loja.email_contato,
          subject: "📅 Novo agendamento",
          html: `
            <p><strong>${cliente_nome}</strong> agendou:</p>
            <p>${servico_nome}</p>
            <p>${data} • ${hora_inicio} - ${hora_fim}</p>
          `
        });
      } catch (e) {
        console.warn("⚠️ Email falhou:", e.message);
      }
    }

    /* ================= PUSH (NUNCA BLOQUEIA) ================= */
    if (firebaseAdmin) {
      try {
        const { data: tokens } = await supabase
          .from("notificacoes_tokens")
          .select("token")
          .eq("user_id", loja_id);

        if (tokens?.length) {
          await firebaseAdmin.messaging().sendEach(
            tokens.map(t => ({
              token: t.token,
              notification: {
                title: "📅 Novo agendamento",
                body: `${cliente_nome} • ${hora_inicio}`
              },
              data: {
                tipo: "AGENDAMENTO",
                loja_id
              }
            }))
          );

          console.log("🔔 Push enviado");
        }
      } catch (e) {
        console.error("⚠️ Push falhou (ignorado):", e.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Agendamento criado com sucesso"
    });

  } catch (err) {
    console.error("🔥 ERRO GERAL:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
}
