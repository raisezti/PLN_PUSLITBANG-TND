import { NextResponse } from 'next/server'
import { runReminders } from '@/lib/reminders'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Tombol "Kirim Pengingat Sekarang" di halaman Pengaturan (admin).
export async function POST() {
  try {
    return NextResponse.json(await runReminders())
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: e?.message || 'Gagal mengirim pengingat.', recipients: 0, sent: 0, items: 0, errors: [] }, { status: 500 })
  }
}
