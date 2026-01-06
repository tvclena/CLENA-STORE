import { createClient } from "@supabase/supabase-js";
import mercadopago from "mercadopago";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { loja_id, cliente, itens } = req.body;

    if (!loja_id || !cliente || !itens?.length) {
      return res.status(400).json({ error: "Payload inválido" });
    }

    /* 1️⃣ BUSCA TOKEN MP DA LOJA */
    const { data: cred, error: credErr } = await supabase
      .from("credenciais_pagamento")
      .select("mp_access_token")
      .eq("user_id", loja_id)
      .single();

    if (credErr || !cred?.mp_access_token) {
      return res
        .status(400)
        .json({ error: "Pagamento online não configurado para esta loja" });
    }

    /* 2️⃣ CONFIGURA MERCADO PAGO */
    mercadopago.configure({
      access_token: cred.mp_access_token
    });

    /* 3️⃣ MONTA ITENS */
    const items = itens.map(i => ({
      title: i.nome,
      quantity: Number(i.quantidade),
      unit_price: Number(i.preco),
      currency_id: "BRL"
    }));

    /* 4️⃣ CRIA PREFERÊNCIA */
    const preference = {
      items,
      payer: {
        name: cliente.nome
      },
      metadata: {
        loja_id,
        cliente_whatsapp: cliente.whatsapp
      },
      back_urls: {
        success: `${req.headers.origin}/sucesso.html`,
        failure: `${req.headers.origin}/erro.html`,
        pending: `${req.headers.origin}/pendente.html`
      },
      auto_return: "approved",
      notification_url: `${req.headers.origin}/api/webhook-mercadopago`
    };

    const response = await mercadopago.preferences.create(preference);

    /* 5️⃣ SALVA MOVIMENTAÇÃO */
    await supabase.from("movimentacoes_pagamento").insert({
      loja_id,
      status: "CRIADO",
      mp_preference_id: response.body.id,
      valor_total: itens.reduce(
        (t, i) => t + i.preco * i.quantidade,
        0
      ),
      cliente_nome: cliente.nome,
      cliente_whatsapp: cliente.whatsapp,
      payload: preference
    });

    /* 6️⃣ RETORNA LINK */
    return res.status(200).json({
      init_point: response.body.init_point
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro ao criar pagamento" });
  }
}
