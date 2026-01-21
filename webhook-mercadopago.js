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
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    const paymentId =
      body?.data?.id ||
      body?.id ||
      body?.resource?.split("/")?.pop();

    if (!paymentId) {
      return res.status(400).json({ error: "Pagamento não identificado" });
    }

    /* =====================================================
       BUSCA ASSINATURA PRIMEIRO
       (mais simples e direta)
    ===================================================== */
    const { data: assinatura } = await supabase
      .from("pagamentos_assinatura")
      .select("*")
      .eq("mp_payment_id", paymentId)
      .single();

    if (assinatura) {
      return await processarAssinatura({
        assinatura,
        paymentId,
        res
      });
    }

    /* =====================================================
       CASO NÃO SEJA ASSINATURA, É PEDIDO
    ===================================================== */
    return await processarPedido({
      paymentId,
      body,
      res
    });

  } catch (err) {
    console.error("❌ WEBHOOK MP:", err);
    return res.status(500).json({
      error: err?.message || "Erro no webhook Mercado Pago"
    });
  }
}

/* =====================================================
   ASSINATURA
===================================================== */
async function processarAssinatura({ assinatura, paymentId, res }) {

  const { data: cred } = await supabase
    .from("lojas_pagamento_credenciais")
    .select("mp_access_token")
    .eq("user_id", assinatura.user_id)
    .eq("ativo", true)
    .single();

  if (!cred?.mp_access_token) {
    throw new Error("Credencial MP não encontrada (assinatura)");
  }

  mercadopago.configure({
    access_token: cred.mp_access_token
  });

  const mpPayment = await mercadopago.payment.get(paymentId);
  const status = mpPayment.body.status;

  const mapa = {
    approved: "PAGO",
    pending: "PENDENTE",
    rejected: "REJEITADO",
    cancelled: "CANCELADO"
  };

  await supabase
    .from("pagamentos_assinatura")
    .update({
      status: mapa[status] || status,
      pago_em: status === "approved"
        ? new Date().toISOString()
        : null,
      atualizado_em: new Date().toISOString()
    })
    .eq("id", assinatura.id);

  // 🔥 AQUI você pode:
  // - ativar assinatura
  // - liberar plano
  // - estender validade

  return res.status(200).json({
    ok: true,
    tipo: "ASSINATURA",
    status_mp: status
  });
}

/* =====================================================
   PEDIDO
===================================================== */
async function processarPedido({ paymentId, body, res }) {

  const { data: movimento } = await supabase
    .from("movimentacoes_pagamento")
    .select("*")
    .eq("mp_payment_id", paymentId)
    .single();

  if (!movimento) {
    return res.status(200).json({ ignored: true });
  }

  const { data: cred } = await supabase
    .from("lojas_pagamento_credenciais")
    .select("mp_access_token")
    .eq("user_id", movimento.user_id)
    .eq("ativo", true)
    .single();

  if (!cred?.mp_access_token) {
    throw new Error("Credencial MP não encontrada (pedido)");
  }

  mercadopago.configure({
    access_token: cred.mp_access_token
  });

  const mpPayment = await mercadopago.payment.get(paymentId);
  const pagamento = mpPayment.body;

  const status = pagamento.status;
  const pedidoId = pagamento.external_reference;

  const mapaMov = {
    approved: "APROVED",
    pending: "PENDING",
    rejected: "REJEITADO",
    cancelled: "CANCELADO"
  };

  const mapaPedido = {
    approved: "PAGO",
    pending: "PENDENTE_PAGAMENTO",
    rejected: "CANCELADO",
    cancelled: "CANCELADO"
  };

  await supabase
    .from("movimentacoes_pagamento")
    .update({
      status: mapaMov[status] || status,
      mp_payment_id: paymentId,
      updated_at: new Date().toISOString()
    })
    .eq("id", movimento.id);

  await supabase
    .from("pedidos")
    .update({
      status: mapaPedido[status] || "ERRO_PAGAMENTO",
      updated_at: new Date().toISOString()
    })
    .eq("id", pedidoId);

  return res.status(200).json({
    ok: true,
    tipo: "PEDIDO",
    status_mp: status
  });
}
