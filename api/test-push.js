import { createClient } from "@supabase/supabase-js";
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
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    const { user_id } = body;

    if (!user_id) {
      return res.status(400).json({
        error: "user_id é obrigatório"
      });
    }

    /* ================= BUSCA TOKENS ================= */
    const { data: tokens, error } = await supabase
      .from("notificacoes_tokens")
      .select("token")
      .eq("user_id", user_id);

    if (error) {
      console.error("Erro ao buscar tokens:", error);
      return res.status(500).json({ error: "Erro ao buscar tokens" });
    }

    if (!tokens || tokens.length === 0) {
      return res.status(404).json({
        error: "Nenhum token encontrado para este usuário"
      });
    }

    /* ================= MENSAGENS ================= */
    const mensagens = tokens.map(t => ({
      token: t.token,
      notification: {
        title: "🔔 Teste de Notificação",
        body: "Se você recebeu isso, o PUSH está funcionando 🚀"
      },
      data: {
        tipo: "TESTE_PUSH",
        origem: "api/test-push"
      }
    }));

    /* ================= ENVIO ================= */
    const response = await firebaseAdmin
      .messaging()
      .sendEach(mensagens);

    console.log("🔔 Push teste enviado:", response);

    return res.status(200).json({
      success: true,
      enviados: response.successCount,
      falhas: response.failureCount
    });

  } catch (err) {
    console.error("🔥 Erro geral:", err);
    return res.status(500).json({
      error: "Erro interno",
      detail: err.message
    });
  }
}
