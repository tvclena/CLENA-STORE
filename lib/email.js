import nodemailer from "nodemailer";

export async function enviarEmail({ to, subject, html }) {
  if (!process.env.SMTP_HOST) {
    console.warn("⚠️ SMTP não configurado, email ignorado");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html
  });
}
