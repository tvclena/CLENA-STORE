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
    // ✅ Apenas POST
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { user_id, email } = req.body;

    if (!user_id || !email) {
      return res.status(400).json({
        error: "user_id e email obrigatórios",
      });
    }

    const { data: profile, error: profileError } = await supabase
      .from("user_profile")
      .select("user_id")
      .eq("user_id", user_id)
      .single();

    if (profileError || !profile) {
      return res.status(400).json({
        error: "Usuário não encontrado",
      });
    }

    const valor = 29.9;

    const payment = await paymentClient.create({
      body: {
        transaction_amount: valor,
        description: "Assinatura Agenda Fácil",
        payment_method_id: "pix",
        payer: {
          email,
        },
        metadata: {
          user_id,
          tipo: "assinatura",
        },
      },
    });

    await supabase.from("pagamentos_assinatura").insert({
      user_id,
      mp_payment_id: payment.id,
      status: payment.status,
      valor,
    });

    return res.status(200).json({
      mp_payment_id: payment.id,
      status: payment.status,
      qr_code: payment.point_of_interaction.transaction_data.qr_code,
      qr_code_base64:
        payment.point_of_interaction.transaction_data.qr_code_base64,
    });

  } catch (err) {
    console.error("❌ create-subscription error:", err);

    return res.status(500).json({
      error: "Erro ao criar assinatura",
      detail: err.message,
    });
  }
}
