import { createClient } from "@supabase/supabase-js";
import mercadopago from "mercadopago";

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

    /* ================= DONO DA LOJA ================= */
    const { data: loja, error: lojaErr } = await supabase
      .from("user_profile")
      .select("id")
      .eq("id", loja_id)
      .single();

    if (lojaErr || !loja) {
      return res.status(400).json({ error: "Loja inválida" });
    }

    /* ================= CREDENCIAL MP ================= */
    const { data: cred, error: credErr } = await supabase
      .from("lojas_pagamento_credenciais")
      .select("mp_access_token")
      .eq("user_id", loja.id)
      .eq("ativo", true)
      .single();

    if (credErr || !cred?.mp_access_token) {
      return res.status(400).json({
        error: "Pagamento online não configurado para esta loja"
      });
    }

    /* ================= PRODUTOS ================= */
    const produtoIds = itens.map(i => i.id);

    const { data: produtos, error: prodErr } = await supabase
      .from("produtos_servicos")
      .select("id, nome, preco")
      .in("id", produtoIds)
      .eq("user_id", loja.id)
      .eq("pg_online", true)
      .eq("ativo", true);

    if (!produtos?.length) {
      return res.status(400).json({
        error: "Itens inválidos para pagamento online"
      });
    }

    const items = produtos.map(p => {
      const qtd = itens.find(i => i.id === p.id)?.quantidade || 1;
      return {
        title: p.nome,
        quantity: qtd,
        unit_price: Number(p.preco),
        currency_id: "BRL"
      };
    });

    const valorTotal = items.reduce(
      (t, i) => t + i.unit_price * i.quantity,
      0
    );

    /* ================= PEDIDO ================= */
    const { data: pedido } = await supabase
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

    /* ================= MERCADO PAGO ================= */
    mercadopago.configure({
      access_token: cred.mp_access_token
    });

    const response = await mercadopago.preferences.create({
      items,
      payer: { name: cliente.nome },
      metadata: { loja_id, pedido_id: pedido.id },
      back_urls: {
        success: `${process.env.APP_URL}/sucesso.html`,
        failure: `${process.env.APP_URL}/erro.html`,
        pending: `${process.env.APP_URL}/pendente.html`
      },
      auto_return: "approved",
      notification_url: `${process.env.APP_URL}/api/webhook-mercadopago`
    });

    await supabase
      .from("movimentacoes_pagamento")
      .update({
        mp_preference_id: response.body.id
      })
      .eq("id", pedido.id);

    return res.status(200).json({
      init_point: response.body.init_point
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro ao criar pagamento" });
  }
}
