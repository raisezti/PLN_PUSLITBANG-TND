import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyPassword } from '@/lib/password'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const nip = String(body.nip ?? '').trim().toUpperCase()
    const password = String(body.password ?? '')

    const row = getDb().prepare('SELECT password_hash FROM app_users WHERE nip = ?').get(nip) as { password_hash: string } | undefined
    if (!row || !verifyPassword(password, row.password_hash)) {
      return NextResponse.json({ ok: false }, { status: 401 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
