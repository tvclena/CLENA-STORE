import mercadopago from 'mercadopago'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN_DONO
})

export default async function handler(req, res) {
  try {
    const { type, data } = req.body

    if (type !== 'payment') {
      return res.status(200).json({ received: true })
    }

    const paymentId = data.id

    // 🔎 Consulta pagamento real no MP
    const payment = await mercadopago.payment.findById(paymentId)
    const mpStatus = payment.body.status
    const metadata = payment.body.metadata || {}

    if (metadata.tipo !== 'assinatura') {
      return res.status(200).json({ ignored: true })
    }

    const user_id = metadata.user_id

    // 🗄️ Atualiza pagamento
    await supabase
      .from('pagamentos_assinatura')
      .update({
        status: mpStatus,
        pago_em: mpStatus === 'approved' ? new Date().toISOString() : null,
        atualizado_em: new Date().toISOString()
      })
      .eq('mp_payment_id', paymentId)

    // ✅ Se aprovado → ativa assinatura
    if (mpStatus === 'approved') {

      // Busca último pagamento aprovado
      const { data: ultimo } = await supabase
        .from('pagamentos_assinatura')
        .select('*')
        .eq('user_id', user_id)
        .eq('status', 'approved')
        .order('pago_em', { ascending: false })
        .limit(1)
        .single()

      if (ultimo) {
        const validade = new Date(ultimo.pago_em)
        validade.setDate(validade.getDate() + 30)

        await supabase
          .from('user_profile')
          .update({
            assinatura_ativa: true,
            assinatura_plano: 'PROFISSIONAL',
            assinatura_valor: ultimo.valor,
            assinatura_valida_ate: validade.toISOString()
          })
          .eq('user_id', user_id)
      }
    }

    return res.status(200).json({ success: true })

  } catch (err) {
    console.error('Erro webhook assinatura:', err)
    return res.status(500).json({ error: 'Erro no webhook' })
  }
}
