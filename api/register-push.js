import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
);

export default async function handler(req, res) {
  const { endpoint, keys } = req.body;

  const user_id = req.headers["x-user-id"]; // ou session

  if (!endpoint || !keys || !user_id) {
    return res.status(400).json({ error: "Dados inválidos" });
  }

  await supabase.from("push_devices").upsert({
    user_id,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: req.headers["user-agent"]
  });

  res.json({ success: true });
}
