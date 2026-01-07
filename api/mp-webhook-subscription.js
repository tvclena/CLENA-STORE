import { MercadoPagoConfig, Payment } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN_DONO,
});

const paymentClient = new Payment(mp);

export default async function handler(req, res) {
  try {
    
   const body = req.body || {};

const paymentId =
  body.data?.id ||
  body.id ||
  body.resource?.split("/")?.pop();

    if (!paymentId) {
      return res.status(200).json({ ignored: true });
    }

    // 🔎 Busca pagamento real no Mercado Pago
    const payment = await paymentClient.get({ id: paymentId });

    const status = payment.body.status;
    const metadata = payment.body.metadata || {};
    const valor = payment.body.transaction_amount;

    // 🔐 Garante que é assinatura
    if (metadata.tipo !== "assinatura" || !metadata.user_id) {
      return res.status(200).json({ ignored: true });
    }

    const user_id = metadata.user_id;

    // 🗄️ Atualiza status do pagamento
    await supabase
      .from("pagamentos_assinatura")
      .update({
        status,
        valor,
        pago_em: status === "approved" ? new Date().toISOString() : null,
        atualizado_em: new Date().toISOString(),
      })
      .eq("mp_payment_id", paymentId);

    // ❌ Se não aprovado, encerra
    if (status !== "approved") {
      return res.status(200).json({ status });
    }

    // 🔁 BUSCA ASSINATURA ATUAL
    const { data: profile } = await supabase
      .from("user_profile")
      .select("assinatura_valida_ate")
      .eq("user_id", user_id)
      .single();

    const agora = new Date();

    // 🧠 Se já existe assinatura válida → renova a partir dela
    let novaValidade = new Date();

    if (
      profile?.assinatura_valida_ate &&
      new Date(profile.assinatura_valida_ate) > agora
    ) {
      novaValidade = new Date(profile.assinatura_valida_ate);
    }

    // ➕ Soma 30 dias
    novaValidade.setDate(novaValidade.getDate() + 30);

    // ✅ ATIVA / RENOVA ASSINATURA
    await supabase
      .from("user_profile")
      .update({
        status: "active",
        assinatura_ativa: true,
        assinatura_plano: "PROFISSIONAL",
        assinatura_valor: valor,
        assinatura_valida_ate: novaValidade.toISOString(),
        atualizado_em: new Date().toISOString(),
      })
      .eq("user_id", user_id);

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("❌ Webhook erro:", err);
    return res.status(200).json({ error: true });
  }
}
