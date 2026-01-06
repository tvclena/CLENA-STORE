import { createClient } from "@supabase/supabase-js";
import MercadoPago from "mercadopago";
import crypto from "crypto";

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
    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body;

    const { loja_id, cliente, itens } = body;

    if (!loja_id || !cliente?.nome || !cliente?.whatsapp || !itens?.length) {
      return res.status(400).json({ error: "Payload inválido" });
    }

    const pedidoId = crypto.randomUUID();

    /* INSERT SIMPLES */
    const { error: insertErr } = await supabase
      .from("movimentacoes_pagamento")
      .insert({
        id: pedidoId,
        user_id: loja_id,
        status: "CRIADO",
        valor: itens.reduce((s,i)=>s+i.preco*i.quantidade,0),
        cliente_nome: cliente.nome,
        cliente_whatsapp: cliente.whatsapp
      });

    if (insertErr) {
      console.error(insertErr);
      return res.status(500).json({ error: "Erro ao criar pedido" });
    }

    const mp = new MercadoPago({
      accessToken: process.env.MP_ACCESS_TOKEN
    });

    const mpRes = await mp.preferences.create({
      items: itens.map(i=>({
        title: i.nome,
        quantity: i.quantidade,
        unit_price: i.preco,
        currency_id: "BRL"
      })),
      external_reference: pedidoId,
      back_urls: {
        success: `${process.env.APP_URL}/sucesso.html`,
        failure: `${process.env.APP_URL}/erro.html`
      },
      auto_return: "approved"
    });

    const prefId = mpRes?.body?.id;
    const initPoint = mpRes?.body?.init_point;

    if (!prefId || !initPoint) {
      return res.status(500).json({ error: "Erro Mercado Pago" });
    }

    await supabase
      .from("movimentacoes_pagamento")
      .update({ mp_preference_id: prefId })
      .eq("id", pedidoId);

    return res.json({ init_point: initPoint });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro interno" });
  }
}
