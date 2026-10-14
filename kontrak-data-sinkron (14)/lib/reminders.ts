// Pengingat email: HANYA untuk kontrak yang akan berakhir, dikirim ke email PIC yang diisi admin pada data kontrak.
// Tiga kali per kontrak: saat sisa waktu 10%, 5%, dan 2% dari masa kontrak (tanggal mulai s.d. tanggal berakhir),
// dibulatkan ke hari. Jika kontrak sudah berstatus Selesai, pengiriman berhenti. Tiap PIC hanya menerima
// kontrak atas email PIC-nya sendiri.
import { getDb, loadState, type ContractRow } from './db'
import { mailConfigured, sendMail } from './mailer'

const DAY_MS = 86400000
const STAGES = [10, 5, 2] as const
type Stage = (typeof STAGES)[number]
type Item = { key: string; stages: Stage[]; stage: Stage; title: string; sub: string; line: string; badge: string }

const MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const fmtDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? `${parseInt(m[3], 10)} ${MONTHS_ID[parseInt(m[2], 10) - 1]} ${m[1]}` : iso
}
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const dayLabel = (n: number) => (n <= 0 ? 'hari ini' : `${n} hari lagi`)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Tanggal hari ini (YYYY-MM-DD) menurut zona waktu pengingat.
const todayIso = () => {
  const tz = process.env.REMINDER_TIMEZONE || 'Asia/Jakarta'
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
const dayNumber = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS : NaN
}

// Kontrak dianggap selesai (berhenti dikirimi pengingat) jika status Selesai, sama dengan aturan di dashboard.
const isFinished = (c: ContractRow) => c.condition === 'Selesai' || Boolean(c.completed)

// Hitung pengingat kontrak akan berakhir per email PIC. Kunci (key) dipakai sebagai catatan "sudah terkirim".
// Jika beberapa tahap jatuh pada hari yang sama (kontrak pendek), semuanya dicatat terkirim dan hanya satu email yang dikirim.
export function buildItemsByPic(contracts: ContractRow[], sent: (email: string, key: string) => boolean): Map<string, { name: string; items: Item[] }> {
  const today = dayNumber(todayIso())
  const result = new Map<string, { name: string; items: Item[] }>()
  for (const c of contracts) {
    const email = (c.picEmail || '').trim().toLowerCase()
    if (!EMAIL_RE.test(email) || isFinished(c)) continue
    const start = dayNumber(c.start)
    const end = dayNumber(c.end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(today)) continue
    const left = end - today
    if (left < 0) continue
    const duration = Math.max(0, end - start)
    const due = STAGES.filter((pct) => left <= Math.round((duration * pct) / 100)).filter((pct) => !sent(email, `end-${c.id}-${c.end}-${pct}`))
    if (due.length === 0) continue
    const stage = due[due.length - 1]
    const item: Item = {
      key: `end-${c.id}-${c.end}`, stages: [...due], stage, title: c.title, sub: `${c.no} · ${c.wbs}`,
      line: `Berakhir ${fmtDate(c.end)} (${dayLabel(left)})`,
      badge: `Pengingat ${stage}% masa kontrak tersisa`,
    }
    const entry = result.get(email) ?? { name: (c.picName || '').trim(), items: [] }
    if (!entry.name) entry.name = (c.picName || '').trim()
    entry.items.push(item)
    result.set(email, entry)
  }
  return result
}

function compose(name: string, items: Item[]) {
  const tz = process.env.REMINDER_TIMEZONE || 'Asia/Jakarta'
  const dateLong = new Intl.DateTimeFormat('id-ID', { dateStyle: 'full', timeZone: tz }).format(new Date())
  const dateShort = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz }).format(new Date())
  const appUrl = (process.env.APP_URL || '').trim()
  const minimal = process.env.MAIL_DETAIL === 'minimal'
  const greet = name ? `Halo ${name},` : 'Halo,'
  const subject = `Pengingat Kontrak ${dateShort}: ${items.length} kontrak akan berakhir`

  const cards = items
    .map(
      (it) => `<tr><td style="padding:10px 14px;border-left:4px solid #b45309;background:#f8fafc;border-radius:4px"><div style="font-size:14px;font-weight:bold;color:#0f172a;line-height:1.4">${esc(minimal ? 'Kontrak atas nama Anda' : it.title)}</div>${minimal ? '' : `<div style="font-size:12px;color:#64748b;margin-top:2px">${esc(it.sub)}</div>`}<div style="font-size:13px;color:#334155;margin-top:6px;line-height:1.5">${esc(it.line)}</div><div style="margin-top:8px"><span style="display:inline-block;background:#fef3c7;color:#b45309;font-size:11px;font-weight:bold;padding:3px 10px;border-radius:12px">${esc(it.badge)}</span></div></td></tr><tr><td style="height:8px;line-height:8px;font-size:8px">&nbsp;</td></tr>`
    )
    .join('')

  const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head><body style="margin:0;padding:0;background:#f1f5f9"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif"><tr><td style="background:#123b6b;padding:22px 26px;color:#ffffff"><div style="font-size:11px;letter-spacing:1.5px;color:#9fc3e3">MONITORING KONTRAK &amp; ANGGARAN</div><div style="font-size:22px;font-weight:bold;margin-top:6px">Kontrak Akan Berakhir</div><div style="font-size:12px;color:#c9def0;margin-top:4px">${esc(dateLong)}</div></td></tr><tr><td style="padding:22px 26px 26px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:14px;color:#334155;line-height:1.6;padding-bottom:16px">${esc(greet)}<br>Kontrak berikut yang Anda tangani sebentar lagi berakhir. Mohon siapkan tindak lanjutnya, misalnya surat perpanjangan atau penghentian kontrak.</td></tr><tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate">${cards}</table></td></tr>${appUrl ? `<tr><td align="center" style="padding:24px 0 4px"><a href="${esc(appUrl)}" style="display:inline-block;background:#2568a6;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 28px;border-radius:8px">Buka Dashboard</a></td></tr>` : `<tr><td style="padding:22px 0 0;font-size:13px;color:#475569">Silakan login ke dashboard Monitoring Kontrak untuk melihat rinciannya.</td></tr>`}</table></td></tr><tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 26px;font-size:11px;color:#94a3b8;line-height:1.6">Email ini dikirim otomatis oleh sistem Monitoring Kontrak. Mohon tidak membalas email ini.</td></tr></table></td></tr></table></body></html>`

  const text = [
    'KONTRAK AKAN BERAKHIR - MONITORING KONTRAK & ANGGARAN',
    dateLong,
    '',
    greet,
    'Kontrak berikut yang Anda tangani sebentar lagi berakhir. Mohon siapkan tindak lanjutnya, misalnya surat perpanjangan atau penghentian kontrak.',
    '',
    ...items.map((it) => `- ${minimal ? 'Kontrak atas nama Anda' : it.title}${minimal ? '' : `\n  ${it.sub}`}\n  ${it.line}\n  ${it.badge}`),
    '',
    appUrl ? `Buka dashboard: ${appUrl}` : 'Silakan login ke dashboard Monitoring Kontrak untuk melihat rinciannya.',
    '',
    'Email ini dikirim otomatis oleh sistem, mohon tidak membalas.',
  ].join('\n')
  return { subject, text, html }
}

export type ReminderResult = { ok: boolean; message: string; recipients: number; sent: number; items: number; errors: string[] }

// Mengecek semua kontrak dan mengirim pengingat tahap 10% / 5% / 2% yang sudah waktunya dan belum pernah terkirim ke email PIC itu.
// Aman dipanggil berulang (jadwal harian maupun tombol manual): pengingat yang sudah terkirim tidak dikirim ulang.
export async function runReminders(): Promise<ReminderResult> {
  const empty = { recipients: 0, sent: 0, items: 0, errors: [] as string[] }
  if (!mailConfigured()) return { ok: false, message: 'Pengaturan email (MAIL_USER dan MAIL_PASS) belum diisi di .env.local.', ...empty }

  const db = getDb()
  const state = loadState(db)
  if (!state) return { ok: true, message: 'Belum ada data kontrak yang tersimpan.', ...empty }

  const logged = db.prepare('SELECT 1 FROM reminder_log WHERE recipient = ? AND item_key = ?')
  const log = db.prepare("INSERT OR REPLACE INTO reminder_log (recipient, item_key, sent_at) VALUES (?, ?, datetime('now'))")
  const byPic = buildItemsByPic(state.contracts, (email, key) => Boolean(logged.get(email, key)))
  const totalItems = Array.from(byPic.values()).reduce((a, v) => a + v.items.length, 0)
  if (byPic.size === 0) return { ok: true, message: 'Tidak ada pengingat kontrak akan berakhir yang perlu dikirim hari ini.', ...empty }

  let sent = 0
  const errors: string[] = []
  for (const [email, entry] of byPic) {
    try {
      const mail = compose(entry.name, entry.items)
      await sendMail(email, mail.subject, mail.text, mail.html)
      for (const it of entry.items) for (const pct of it.stages) log.run(email, `${it.key}-${pct}`)
      sent++
    } catch (e: any) {
      errors.push(`${email}: ${e?.message || 'gagal mengirim'}`)
    }
  }
  const message = errors.length ? 'Sebagian email gagal dikirim.' : 'Pengingat berhasil dikirim.'
  return { ok: errors.length === 0, message, recipients: byPic.size, sent, items: totalItems, errors }
}

// Penjadwal otomatis: setiap hari (termasuk Sabtu-Minggu) pukul 09.00 WIB (bisa diubah lewat .env.local), berjalan selama server menyala.
// Dicek tiap menit. Setiap hari hanya dikirim sekali; jika server baru menyala setelah jam pengiriman,
// pengiriman hari itu dilakukan segera setelah server menyala (jika belum terkirim).
const tzParts = (tz: string) => {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]))
  return { weekday: p.weekday as string, date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, minute: Number(p.minute) }
}

export function startReminderScheduler() {
  const g = globalThis as unknown as { reminderTimer?: ReturnType<typeof setInterval> }
  if (g.reminderTimer) return
  if (!mailConfigured()) {
    console.log('[pengingat] MAIL_USER belum diisi di .env.local, pengiriman otomatis tidak aktif.')
    return
  }
  if (process.env.REMINDER_AUTO === 'off') return
  const tz = process.env.REMINDER_TIMEZONE || 'Asia/Jakarta'
  const hour = Math.min(23, Math.max(0, Number(process.env.REMINDER_HOUR ?? 9)))
  const minute = Math.min(59, Math.max(0, Number(process.env.REMINDER_MINUTE ?? 0)))
  let busy = false
  let retryAfter = 0
  const tick = async () => {
    if (busy || Date.now() < retryAfter) return
    const now = tzParts(tz)
    if (now.hour * 60 + now.minute < hour * 60 + minute) return
    const db = getDb()
    const last = db.prepare("SELECT value FROM app_meta WHERE key = 'last_daily_reminder'").get() as { value: string } | undefined
    if (last?.value === now.date) return
    busy = true
    try {
      const r = await runReminders()
      console.log('[pengingat]', r.message, `terkirim: ${r.sent}`, r.errors.length ? r.errors : '')
      if (r.errors.length) retryAfter = Date.now() + 30 * 60 * 1000
      else db.prepare("INSERT INTO app_meta (key, value) VALUES ('last_daily_reminder', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(now.date)
    } catch (e: any) {
      retryAfter = Date.now() + 30 * 60 * 1000
      console.log('[pengingat] error:', e?.message)
    } finally {
      busy = false
    }
  }
  g.reminderTimer = setInterval(tick, 60 * 1000)
  setTimeout(tick, 15 * 1000)
  console.log(`[pengingat] pengiriman otomatis aktif: setiap hari pukul ${String(hour).padStart(2, '0')}.${String(minute).padStart(2, '0')} (${tz}).`)
}
