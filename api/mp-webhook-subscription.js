import { MercadoPagoConfig, Payment } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

/* 🔐 Supabase com SERVICE ROLE (pode atualizar qualquer usuário) */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

/* 🔑 Mercado Pago */
const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN_DONO,
});

const paymentClient = new Payment(mp);

export default async function handler(req, res) {
  try {
    /* 🔔 Webhook recebe vários eventos — só nos importa PAYMENT */
    if (req.body?.type !== "payment") {
      return res.status(200).json({ received: true });
    }

    const paymentId = req.body?.data?.id;
    if (!paymentId) {
      return res.status(200).json({ ignored: true });
    }

    /* 🔎 Busca o pagamento REAL no Mercado Pago */
    const payment = await paymentClient.get({ id: paymentId });

    const mpStatus = payment.status;
    const metadata = payment.metadata || {};

    /* 🔒 Garante que é pagamento de assinatura */
    if (metadata.tipo !== "assinatura" || !metadata.user_id) {
      return res.status(200).json({ ignored: true });
    }

    const user_id = metadata.user_id;

    /* 🗄️ Atualiza status do pagamento no banco */
    await supabase
      .from("pagamentos_assinatura")
      .update({
        status: mpStatus,
        pago_em: mpStatus === "approved" ? new Date().toISOString() : null,
        atualizado_em: new Date().toISOString(),
      })
      .eq("mp_payment_id", paymentId);

    /* ✅ Se aprovado → ativa assinatura */
    if (mpStatus === "approved") {

      /* 🛑 Evita ativar duas vezes */
      const { data: jaAtiva } = await supabase
        .from("user_profile")
        .select("assinatura_valida_ate")
        .eq("user_id", user_id)
        .single();

      const agora = new Date();

      if (
        jaAtiva?.assinatura_valida_ate &&
        new Date(jaAtiva.assinatura_valida_ate) > agora
      ) {
        return res.status(200).json({ already_active: true });
      }

      /* 📆 Define validade (30 dias) */
      const validade = new Date();
      validade.setDate(validade.getDate() + 30);

      /* 🔓 Libera o sistema para o usuário */
      await supabase
        .from("user_profile")
        .update({
          status: "active",
          assinatura_ativa: true,
          assinatura_plano: "PROFISSIONAL",
          assinatura_valor: payment.transaction_amount,
          assinatura_valida_ate: validade.toISOString(),
        })
        .eq("user_id", user_id);
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("❌ Erro webhook assinatura:", err);
    return res.status(500).json({ error: "Erro no webhook" });
  }
}
