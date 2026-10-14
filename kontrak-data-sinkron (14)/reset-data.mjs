// Mengosongkan data kontrak & anggaran di data/app.db agar aplikasi memuat ulang data awal terbaru.
// Akun login (NIP & password yang sudah terdaftar) TIDAK dihapus.
// Cara pakai: hentikan server (Ctrl + C), jalankan `node reset-data.mjs`, lalu `pnpm dev`.
import Database from 'better-sqlite3'
import fs from 'fs'

const file = 'data/app.db'
if (!fs.existsSync(file)) {
  console.log('Belum ada data/app.db, tidak ada yang perlu direset.')
  process.exit(0)
}
const db = new Database(file)
for (const sql of [
  'DELETE FROM contract_termins',
  'DELETE FROM contracts',
  'DELETE FROM budgets',
  "DELETE FROM app_meta WHERE key = 'state_saved'",
  'DELETE FROM dashboard_state',
]) {
  try { db.exec(sql) } catch {}
}
db.close()
console.log('Selesai. Data kontrak & anggaran direset, akun login tetap aman. Jalankan: pnpm dev')
