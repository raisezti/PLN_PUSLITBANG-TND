import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { hashPassword } from '@/lib/password'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const nip = String(body.nip ?? '').trim().toUpperCase()
    const password = String(body.password ?? '')

    if (!/^[A-Z0-9]+$/.test(nip)) {
      return NextResponse.json({ ok: false, error: 'NIP hanya boleh berisi huruf dan angka, tanpa spasi.' }, { status: 400 })
    }
    if (!password) {
      return NextResponse.json({ ok: false, error: 'Password wajib diisi.' }, { status: 400 })
    }

    const db = getDb()
    const exists = db.prepare('SELECT 1 FROM app_users WHERE nip = ?').get(nip)
    if (exists) {
      return NextResponse.json({ ok: false, error: 'NIP ini sudah terdaftar. Silakan login.' }, { status: 409 })
    }
    db.prepare('INSERT INTO app_users (nip, password_hash) VALUES (?, ?)').run(nip, hashPassword(password))
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Gagal menyimpan akun ke database.' }, { status: 500 })
  }
}
