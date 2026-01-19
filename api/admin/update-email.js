import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // 🔐 Proteção mínima (opcional, mas recomendado)
  if (req.headers['x-admin-token'] !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { user_id, email } = req.body

  if (!user_id || !email) {
    return res.status(400).json({ error: 'Missing params' })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE
  )

  const { error, data } = await supabase.auth.admin.updateUserById(
    user_id,
    {
      email,
      email_confirm: true
    }
  )

  if (error) {
    return res.status(400).json(error)
  }

  return res.json({ success: true, data })
}
