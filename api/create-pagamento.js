import { createClient } from "@supabase/supabase-js";
import MercadoPago from "mercadopago";

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
    /* ===== BODY ===== */
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    const { loja_id, cliente, itens } = body;

    if (!loja_id || !cliente?.nome || !cliente?.whatsapp || !itens?.length) {
      return res.status(400).json({ error: "Payload inválido" });
    }

    /* ===== LOJA ===== */
    const { data: loja, error: lojaErr } = await supabase
      .from("user_profile")
      .select("user_id")
      .eq("user_id", loja_id)
      .single();

    if (lojaErr || !loja) {
      return res.status(400).json({ error: "Loja inválida" });
    }

    /* ===== CREDENCIAL MERCADO PAGO ===== */
    const { data: cred, error: credErr } = await supabase
      .from("lojas_pagamento_credenciais")
      .select("mp_access_token")
      .eq("user_id", loja.user_id)
      .eq("ativo", true)
      .single();

    if (credErr || !cred?.mp_access_token) {
      return res.status(400).json({
        error: "Pagamento online não configurado"
      });
    }

    /* ===== PRODUTOS ===== */
    const ids = itens.map(i => i.id);

    const { data: produtos, error: prodErr } = await supabase
      .from("produtos_servicos")
      .select("id,nome,preco")
      .in("id", ids)
      .eq("user_id", loja.user_id)
      .eq("ativo", true)
      .eq("pg_online", true);

    if (prodErr || !produtos || produtos.length !== itens.length) {
      return res.status(400).json({ error: "Itens inválidos" });
    }

    const mpItems = produtos.map(p => {
      const c = itens.find(i => i.id === p.id);
      return {
        title: p.nome,
        quantity: Number(c.quantidade),
        unit_price: Number(p.preco),
        currency_id: "BRL"
      };
    });

    const total = mpItems.reduce(
      (s, i) => s + i.unit_price * i.quantity,
      0
    );

    /* ===== CRIA PEDIDO ===== */
    const { data: pedido, error: pedErr } = await supabase
      .from("movimentacoes_pagamento")
      .insert({
        user_id: loja.user_id,
        status: "CRIADO",
        valor: total,
        cliente_nome: cliente.nome,
        cliente_whatsapp: cliente.whatsapp
      })
      .select()
      .single();

    if (pedErr || !pedido) {
      throw new Error("Erro ao criar pedido");
    }

    /* ===== MERCADO PAGO (SDK NOVO) ===== */
    const mp = new MercadoPago({
      accessToken: cred.mp_access_token
    });

    const preference = new mp.Preference();

    const response = await preference.create({
      body: {
        items: mpItems,
        external_reference: pedido.id,
        back_urls: {
          success: `${process.env.APP_URL}/sucesso.html`,
          failure: `${process.env.APP_URL}/erro.html`,
          pending: `${process.env.APP_URL}/pendente.html`
        },
        auto_return: "approved",
        notification_url: `${process.env.APP_URL}/api/webhook-mercadopago`
      }
    });

    /* ===== SALVA PREFERENCE ===== */
    await supabase
      .from("movimentacoes_pagamento")
      .update({
        mp_preference_id: response.id
      })
      .eq("id", pedido.id);

    return res.status(200).json({
      init_point: response.init_point
    });

  } catch (err) {
    console.error("❌ CREATE PAGAMENTO ERRO:");
    console.error(err?.message || err);
    console.error(err?.cause || err);

    return res.status(500).json({
      error: err?.message || "Erro interno ao criar pagamento"
    });
  }
}
