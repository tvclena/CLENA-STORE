import { createClient } from "@supabase/supabase-js";
import MercadoPago from "mercadopago";

/* ================= SUPABASE ================= */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);


/* ================= HANDLER ================= */
export default async function handler(req, res) {

  /* ========== CORS ========== */
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
    /* ========== BODY SAFE ========== */
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    const { loja_id, cliente, itens } = body;

    /* ========== VALIDAÇÃO PAYLOAD ========== */
    if (
      !loja_id ||
      !cliente?.nome ||
      !cliente?.whatsapp ||
      !Array.isArray(itens) ||
      itens.length === 0
    ) {
      return res.status(400).json({ error: "Payload inválido" });
    }

  /* ========== BUSCA LOJA (USER_PROFILE É A LOJA) ========== */
const { data: loja, error: lojaErr } = await supabase
  .from("user_profile")
  .select("user_id, responsavel, negocio")
  .eq("user_id", loja_id)
  .single();

if (lojaErr || !loja) {
  return res.status(400).json({ error: "Loja inválida" });
}

    /* ========== CREDENCIAL MERCADO PAGO (DONO) ========== */
    const { data: cred, error: credErr } = await supabase
      .from("lojas_pagamento_credenciais")
      .select("mp_access_token")
      .eq("user_id", loja.user_id)
      .eq("ativo", true)
      .single();

    if (credErr || !cred?.mp_access_token) {
      return res.status(400).json({
        error: "Pagamento online não configurado para esta loja"
      });
    }

    /* ========== PRODUTOS (DO DONO DA LOJA) ========== */
    const produtoIds = itens.map(i => i.id);

    const { data: produtos, error: prodErr } = await supabase
      .from("produtos_servicos")
      .select("id, nome, preco")
      .in("id", produtoIds)
      .eq("user_id", loja.user_id)
      .eq("pg_online", true)
      .eq("ativo", true);

    if (prodErr || !produtos || produtos.length === 0) {
      return res.status(400).json({
        error: "Itens inválidos para pagamento online"
      });
    }

    if (produtos.length !== itens.length) {
      return res.status(400).json({
        error: "Um ou mais itens não são válidos"
      });
    }

    /* ========== ITENS MERCADO PAGO ========== */
    const items = produtos.map(p => {
      const carrinhoItem = itens.find(i => i.id === p.id);
      const quantidade = Number(carrinhoItem?.quantidade || 1);

      const preco = Number(
        String(p.preco).replace(",", ".")
      );

      if (
        isNaN(preco) ||
        preco <= 0 ||
        quantidade <= 0
      ) {
        throw new Error("Preço ou quantidade inválidos");
      }

      return {
        title: p.nome,
        quantity: quantidade,
        unit_price: preco,
        currency_id: "BRL"
      };
    });

    const valorTotal = items.reduce(
      (t, i) => t + i.unit_price * i.quantity,
      0
    );

    /* ========== CRIA PEDIDO ========== */
    const { data: pedido, error: pedidoErr } = await supabase
      .from("movimentacoes_pagamento")
.insert({
  user_id: loja.user_id,   // A LOJA É O USER
  status: "CRIADO",
  valor_total: valorTotal,
  cliente_nome: cliente.nome,
  cliente_whatsapp: cliente.whatsapp
})
      .select()
      .single();

    if (pedidoErr || !pedido) {
      throw new Error("Erro ao criar pedido");
    }

    /* ========== MERCADO PAGO ========== */
    const mp = new MercadoPago({
      accessToken: cred.mp_access_token
    });

   const response = await mp.preferences.create({
  items,
  payer: {
    name: cliente.nome
  },
  metadata: {
    user_id: loja.user_id,
    pedido_id: pedido.id
  }, // ✅ VÍRGULA AQUI

  back_urls: {
    success: `${process.env.APP_URL}/sucesso.html`,
    failure: `${process.env.APP_URL}/erro.html`,
    pending: `${process.env.APP_URL}/pendente.html`
  },
  auto_return: "approved",
  notification_url: `${process.env.APP_URL}/api/webhook-mercadopago`
});

    /* ========== SALVA PREFERENCE ID ========== */
    await supabase
      .from("movimentacoes_pagamento")
      .update({
        mp_preference_id: response.body.id
      })
      .eq("id", pedido.id);

    /* ========== RETORNO FINAL ========== */
    return res.status(200).json({
      init_point: response.body.init_point
    });

  } catch (err) {
    console.error("ERRO CREATE PAGAMENTO:", err);
    return res.status(500).json({
      error: "Erro ao criar pagamento"
    });
  }
}
