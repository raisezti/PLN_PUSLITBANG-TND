// Pengirim email (SMTP). Semua pengaturan dibaca dari .env.local, jadi saat pindah ke SMTP PLN
// cukup mengganti isi .env.local tanpa mengubah kode.
//
//   MAIL_USER        akun pengirim (mis. alamat Gmail, atau noreply@pln.co.id)
//   MAIL_PASS        App Password Gmail / password SMTP. Boleh kosong jika SMTP relay tidak butuh login.
//   MAIL_HOST        default: smtp.gmail.com
//   MAIL_PORT        default: 465 (465 = SSL langsung, selain itu STARTTLS)
//   MAIL_FROM_NAME   nama pengirim yang tampil, default: Monitoring Kontrak PLN
// @ts-ignore - tipe nodemailer bersifat opsional
import nodemailer from 'nodemailer'

export function mailConfigured() {
  return Boolean(process.env.MAIL_USER)
}

export async function sendMail(to: string, subject: string, text: string, html: string) {
  const port = Number(process.env.MAIL_PORT || 465)
  const user = process.env.MAIL_USER as string
  const pass = process.env.MAIL_PASS
  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    ...(pass ? { auth: { user, pass } } : {}),
  })
  await transporter.sendMail({
    from: `"${process.env.MAIL_FROM_NAME || 'Monitoring Kontrak PLN'}" <${user}>`,
    to,
    subject,
    text,
    html,
  })
}
