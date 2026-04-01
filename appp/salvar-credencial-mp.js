import { createClient } from "@supabase/supabase-js";

/* ================= SUPABASE ================= */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

/* ================= HANDLER ================= */
export default async function handler(req, res) {

  /* ===== CORS ===== */
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
    /* ===== BODY SAFE ===== */
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    const { loja_id, mp_access_token } = body;

    if (!loja_id || !mp_access_token) {
      return res.status(400).json({ error: "Payload inválido" });
    }

    if (!mp_access_token.startsWith("APP_USR-")) {
      return res.status(400).json({ error: "Token Mercado Pago inválido" });
    }

    /* ===== SALVA / ATUALIZA CREDENCIAL ===== */
    const { error: credErr } = await supabase
      .from("lojas_pagamento_credenciais")
      .upsert(
        {
          user_id: loja_id,
          mp_access_token,
          ativo: true
        },
        {
          onConflict: "user_id" // 🔥 ESSENCIAL
        }
      );

    if (credErr) {
      console.error("Erro credencial:", credErr);
      throw new Error("Erro ao salvar credencial");
    }

    /* ===== ATIVA PAGAMENTO NA LOJA ===== */
    const { error: lojaErr } = await supabase
      .from("user_profile")
      .update({ pagamento_online_ativo: true })
      .eq("user_id", loja_id);

    if (lojaErr) {
      console.error("Erro loja:", lojaErr);
      throw new Error("Erro ao ativar pagamento da loja");
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("❌ ERRO SALVAR MP:", err);
    return res.status(500).json({
      error: err.message || "Erro interno ao salvar credencial"
    });
  }
}
