import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const {
      user_id,
      nome,
      descricao = "",
      categoria = "",
      tipo = "PRODUTO"
    } = req.body;

    if (!user_id || !nome) {
      return res.status(400).json({ error: "Dados obrigatórios ausentes" });
    }

    // 🔑 OpenAI
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const prompt = `
Foto profissional de ${tipo === "SERVICO" ? "serviço" : "produto"}.
Nome: ${nome}
Categoria: ${categoria}
Descrição: ${descricao}

Estilo: fotografia de estúdio, fundo neutro, iluminação suave,
alta qualidade, realista, e-commerce, sem texto, sem marcas.
    `.trim();

    // 🎨 GERA IMAGEM
    const image = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024"
    });

    const base64 = image.data[0].b64_json;
    if (!base64) {
      throw new Error("OpenAI não retornou imagem");
    }

    const buffer = Buffer.from(base64, "base64");

    // ☁️ Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );

    const filePath = `${user_id}/${Date.now()}.jpg`;

    const upload = await supabase.storage
      .from("produtos")
      .upload(filePath, buffer, {
        contentType: "image/jpeg",
        upsert: true
      });

    if (upload.error) {
      throw upload.error;
    }

    const { data: urlData } = supabase.storage
      .from("produtos")
      .getPublicUrl(filePath);

    if (!urlData?.publicUrl) {
      throw new Error("Falha ao gerar URL pública");
    }

    // ✅ SUCESSO
    return res.status(200).json({
      imagem_url: urlData.publicUrl
    });

  } catch (err) {
    console.error("❌ ERRO REAL:", err);

    return res.status(500).json({
      error: err.message || "Erro interno",
      stack: err.stack
    });
  }
}
