import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { user_id, nome, descricao, categoria, tipo } = req.body;

    if (!user_id || !nome) {
      return res.status(400).json({ error: "Dados obrigatórios ausentes" });
    }

    // ================= PROMPT INTELIGENTE =================
    const prompt =
      tipo === "SERVICO"
        ? `
Imagem profissional representando um serviço.
Nome: ${nome}
Descrição: ${descricao || ""}
Ambiente limpo, profissional, realista.
Fotografia moderna, iluminação suave.
`
        : `
Foto profissional de produto comercial para e-commerce.
Nome: ${nome}
Descrição: ${descricao || ""}
Categoria: ${categoria || ""}
Fundo branco, iluminação suave, fotografia realista,
estilo premium.
`;

    // ================= OPENAI IMAGE =================
    const image = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    });

    const base64Image = image.data[0].b64_json;
    const buffer = Buffer.from(base64Image, "base64");

    // ================= STORAGE =================
    const fileName = `${crypto.randomUUID()}.png`;
    const filePath = `${user_id}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from(process.env.SUPABASE_STORAGE_BUCKET)
      .upload(filePath, buffer, {
        contentType: "image/png",
        upsert: false,
      });

    if (uploadError) {
      throw uploadError;
    }

    // ================= URL PÚBLICA =================
    const { data: publicUrl } = supabase.storage
      .from(process.env.SUPABASE_STORAGE_BUCKET)
      .getPublicUrl(filePath);

    return res.status(200).json({
      imagem_url: publicUrl.publicUrl,
    });
  } catch (err) {
    console.error("Erro IA:", err);
    return res.status(500).json({
      error: "Erro ao gerar imagem com IA",
    });
  }
}
