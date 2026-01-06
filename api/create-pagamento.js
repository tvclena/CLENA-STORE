import { createClient } from "@supabase/supabase-js";
import mercadopago from "mercadopago";

/* ================= SUPABASE ================= */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

/* ================= HANDLER ================= */
export default async function handler(req, res) {

  /* ================= CORS ================= */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // 🔥 PRE-FLIGHT (OBRIGATÓRIO)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    /* ================= SEGURANÇA ================= */
    const origin = req.headers.origin || "";

    if (
      process.env.APP_DOMAIN &&
      !origin.includes(process.env.APP_DOMAIN)
    ) {
      return res.status(403).json({ error: "Origem não autorizada" });
    }

    /* ================= PAYLOAD ================= */
    const { loja_id, cliente, itens } = req.body;

    if (
      !loja_id ||
      !cliente?.nome ||
      !cliente?.whatsapp ||
      !Array.isArray(itens) ||
      itens.length === 0
    ) {
      return res.status(400).json({ error: "Payload inválido" });
    }

    /* ================= TOKEN MP DA LOJA ================= */
    const { data: cred, error: credErr } = await supabase
      .from("credenciais_pagamento")
      .select("mp_access_token")
      .eq("user_id", loja_id)
      .single();

    if (credErr || !cred?.mp_access_token) {
      return res.status(400).json({
        error: "Pagamento online não configurado para esta loja"
      });
    }

    /* ================= PRODUTOS REAIS ================= */
    const produtoIds = itens.map(i => i.id);

    const { data: produtos, error: prodErr } = await supabase
      .from("produtos_servicos")
      .select("id, nome, preco")
      .in("id", produtoIds)
      .eq("user_id", loja_id)
      .eq("pg_online", true)
      .eq("ativo", true);

    if (prodErr || !produtos?.length) {
      return res.status(400).json({
        error: "Itens inválidos ou não disponíveis para pagamento online"
      });
    }

    /* ================= ITENS MERCADO PAGO ================= */
    const items = produtos.map(p => {
      const qtd = itens.find(i => i.id === p.id)?.quantidade || 1;
      return {
        title: p.nome,
        quantity: Number(qtd),
        unit_price: Number(p.preco),
        currency_id: "BRL"
      };
    });

    const valorTotal = items.reduce(
      (t, i) => t + i.unit_price * i.quantity,
      0
    );

    /* ================= PEDIDO INTERNO ================= */
    const { data: pedido, error: pedidoErr } = await supabase
      .from("movimentacoes_pagamento")
      .insert({
        loja_id,
        status: "CRIADO",
        valor_total: valorTotal,
        cliente_nome: cliente.nome,
        cliente_whatsapp: cliente.whatsapp
      })
      .select()
      .single();

    if (pedidoErr) {
      console.error("PEDIDO ERROR:", pedidoErr);
      return res.status(500).json({ error: "Erro ao criar pedido interno" });
    }

    /* ================= MERCADO PAGO ================= */
    mercadopago.configure({
      access_token: cred.mp_access_token
    });

    const preference = {
      items,
      payer: {
        name: cliente.nome
      },
      metadata: {
        loja_id,
        pedido_id: pedido.id
      },
      back_urls: {
        success: `${process.env.APP_URL}/sucesso.html`,
        failure: `${process.env.APP_URL}/erro.html`,
        pending: `${process.env.APP_URL}/pendente.html`
      },
      auto_return: "approved",
      notification_url: `${process.env.APP_URL}/api/webhook-mercadopago`
    };

    const response = await mercadopago.preferences.create(preference);

    /* ================= ATUALIZA PEDIDO ================= */
    await supabase
      .from("movimentacoes_pagamento")
      .update({
        mp_preference_id: response.body.id,
        payload: preference
      })
      .eq("id", pedido.id);

    /* ================= RETORNO ================= */
    return res.status(200).json({
      init_point: response.body.init_point,
      pedido_id: pedido.id
    });

  } catch (err) {
    console.error("CREATE PAGAMENTO ERROR:", err);
    return res.status(500).json({ error: "Erro ao criar pagamento" });
  }
}
