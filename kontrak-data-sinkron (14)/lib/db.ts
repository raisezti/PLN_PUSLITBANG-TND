import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

// Database berupa satu file: data/app.db di dalam folder proyek.
//
// Tabel:
//   app_users         -> akun login (NIP + password hash)
//   contracts         -> data kontrak (satu baris = satu kontrak)
//   contract_termins  -> termin pembayaran tiap kontrak (terhubung lewat contract_id)
//   budgets           -> data anggaran WBS (satu baris = satu anggaran)
//   v_wbs_summary     -> tampilan ringkasan per WBS: pagu, realisasi kontrak, SPPD, sisa
//                        (kontrak dan anggaran terhubung lewat nomor WBS yang sama)
const globalForDb = globalThis as unknown as { sqliteDb?: Database.Database }

export type TerminRow = { amount: number; deadline: string; status: string }
export type ContractRow = {
  id: number; no: string; prk?: string; title: string; wbs: string; vendor: string; start: string; end: string
  value: number; ppn: boolean; ppnRate?: number; ipms: string; picName?: string; picEmail?: string; condition?: string; completed?: boolean; completedAt?: string; termins: TerminRow[]
}
export type BudgetRow = { id: number; prk: string; activity: string; wbs: string; initial: number; sppd: number }

function open() {
  const dir = path.join(process.cwd(), 'data')
  fs.mkdirSync(dir, { recursive: true })
  const db = new Database(path.join(dir, 'app.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nip TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY,
      position INTEGER NOT NULL DEFAULT 0,
      contract_no TEXT NOT NULL,
      title TEXT NOT NULL,
      wbs TEXT NOT NULL,
      vendor TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      ppn INTEGER NOT NULL DEFAULT 0,
      ipms TEXT NOT NULL,
      condition TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_contracts_wbs ON contracts (wbs);

    CREATE TABLE IF NOT EXISTS contract_termins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
      termin_no INTEGER NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      deadline TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_termins_contract ON contract_termins (contract_id);

    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY,
      position INTEGER NOT NULL DEFAULT 0,
      prk_no TEXT NOT NULL,
      activity TEXT NOT NULL,
      wbs TEXT NOT NULL,
      initial_amount INTEGER NOT NULL DEFAULT 0,
      sppd_amount INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_budgets_wbs ON budgets (wbs);

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Database lama: tambahkan kolom tanggal selesai kontrak jika belum ada.
  const contractColumns = db.prepare('PRAGMA table_info(contracts)').all() as { name: string }[]
  if (!contractColumns.some((c) => c.name === 'completed_at')) db.exec('ALTER TABLE contracts ADD COLUMN completed_at TEXT')

  // Akun lama (versi login pakai email) otomatis dipindah ke format NIP.
  const userColumns = db.prepare('PRAGMA table_info(app_users)').all() as { name: string }[]
  if (userColumns.some((c) => c.name === 'email')) {
    db.exec(`
      CREATE TABLE app_users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nip TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO app_users_new (nip, password_hash, created_at)
        SELECT upper(nip), password_hash, created_at FROM app_users;
      DROP TABLE app_users;
      ALTER TABLE app_users_new RENAME TO app_users;
    `)
  }

  // Nama + email PIC kontrak (diisi admin; email PIC adalah penerima pengingat kontrak akan berakhir) + catatan notifikasi yang sudah dikirim lewat email.
  const contractCols = db.prepare('PRAGMA table_info(contracts)').all() as { name: string }[]
  if (!contractCols.some((c) => c.name === 'prk_no')) db.exec('ALTER TABLE contracts ADD COLUMN prk_no TEXT')
  if (!contractCols.some((c) => c.name === 'ppn_rate')) db.exec('ALTER TABLE contracts ADD COLUMN ppn_rate REAL NOT NULL DEFAULT 11')
  if (!contractCols.some((c) => c.name === 'pic_name')) db.exec('ALTER TABLE contracts ADD COLUMN pic_name TEXT')
  if (!contractCols.some((c) => c.name === 'pic_email')) db.exec('ALTER TABLE contracts ADD COLUMN pic_email TEXT')
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminder_log (
      recipient TEXT NOT NULL,
      item_key TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (recipient, item_key)
    );
  `)

  // Data lama (versi satu tabel dashboard_state berisi JSON) otomatis dipecah ke tabel yang rapi.
  const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dashboard_state'").get()
  if (legacy) {
    const row = db.prepare('SELECT contracts, budgets FROM dashboard_state WHERE id = 1').get() as { contracts: string; budgets: string } | undefined
    if (row) {
      try {
        saveState(db, JSON.parse(row.contracts), JSON.parse(row.budgets))
      } catch {}
    }
    db.exec('DROP TABLE dashboard_state')
  }

  // Ringkasan per WBS: menghubungkan anggaran dengan kontrak yang sudah selesai (rumus sama dengan dashboard).
  db.exec(`
    DROP VIEW IF EXISTS v_wbs_summary;
    CREATE VIEW v_wbs_summary AS
    SELECT
      prk_no, wbs, activity AS uraian_kegiatan, pagu_awal, jumlah_kontrak, realisasi_kontrak, realisasi_sppd,
      pagu_awal - realisasi_kontrak - realisasi_sppd AS sisa_wbs
    FROM (
      SELECT
        b.prk_no, b.wbs, b.activity,
        b.initial_amount AS pagu_awal,
        b.sppd_amount AS realisasi_sppd,
        (SELECT COUNT(*) FROM contracts c WHERE c.wbs = b.wbs) AS jumlah_kontrak,
        COALESCE((
          SELECT SUM(
            (c.value + CASE WHEN c.ppn = 1 THEN c.value * c.ppn_rate / 100.0 ELSE 0 END)
            - (MAX(0, MIN(50, CAST(julianday(COALESCE(c.completed_at, 'now')) - julianday(c.end_date) AS INTEGER))) * c.value / 1000.0)
          )
          FROM contracts c WHERE c.wbs = b.wbs AND c.completed = 1
        ), 0) AS realisasi_kontrak
      FROM budgets b
    );
  `)
  return db
}

export function getDb() {
  if (!globalForDb.sqliteDb) globalForDb.sqliteDb = open()
  return globalForDb.sqliteDb
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0)
const str = (v: unknown) => String(v ?? '')

// Simpan seluruh data kontrak + anggaran (insert baru, update yang berubah, hapus yang sudah dihapus).
export function saveState(db: Database.Database, contracts: any[], budgets: any[]) {
  const tx = db.transaction(() => {
    const upsertContract = db.prepare(`
      INSERT INTO contracts (id, position, contract_no, prk_no, title, wbs, vendor, start_date, end_date, value, ppn, ppn_rate, ipms, pic_name, pic_email, condition, completed, completed_at, updated_at)
      VALUES (@id, @position, @no, @prk, @title, @wbs, @vendor, @start, @end, @value, @ppn, @ppnRate, @ipms, @picName, @picEmail, @condition, @completed, @completedAt, datetime('now'))
      ON CONFLICT (id) DO UPDATE SET
        position = excluded.position, contract_no = excluded.contract_no, prk_no = excluded.prk_no, title = excluded.title, wbs = excluded.wbs,
        vendor = excluded.vendor, start_date = excluded.start_date, end_date = excluded.end_date, value = excluded.value,
        ppn = excluded.ppn, ppn_rate = excluded.ppn_rate, ipms = excluded.ipms, pic_name = excluded.pic_name, pic_email = excluded.pic_email, condition = excluded.condition, completed = excluded.completed, completed_at = excluded.completed_at,
        updated_at = datetime('now')`)
    const deleteTermins = db.prepare('DELETE FROM contract_termins WHERE contract_id = ?')
    const insertTermin = db.prepare('INSERT INTO contract_termins (contract_id, termin_no, amount, deadline, status) VALUES (?, ?, ?, ?, ?)')

    const contractIds = new Set<number>()
    contracts.forEach((c, index) => {
      const id = num(c.id)
      contractIds.add(id)
      upsertContract.run({
        id, position: index, no: str(c.no), prk: str(c.prk), title: str(c.title), wbs: str(c.wbs), vendor: str(c.vendor),
        start: str(c.start), end: str(c.end), value: num(c.value), ppn: c.ppn ? 1 : 0, ppnRate: Number.isFinite(Number(c.ppnRate)) && Number(c.ppnRate) >= 0 ? Number(c.ppnRate) : 11, ipms: str(c.ipms),
        picName: c.picName ? str(c.picName) : null, picEmail: c.picEmail ? str(c.picEmail).trim().toLowerCase() : null,
        condition: c.condition ? str(c.condition) : null, completed: c.completed ? 1 : 0, completedAt: c.completedAt ? str(c.completedAt) : null,
      })
      deleteTermins.run(id)
      ;(Array.isArray(c.termins) ? c.termins : []).forEach((t: any, i: number) => {
        insertTermin.run(id, i + 1, num(t.amount), str(t.deadline), str(t.status))
      })
    })
    const deleteContract = db.prepare('DELETE FROM contracts WHERE id = ?')
    for (const row of db.prepare('SELECT id FROM contracts').all() as { id: number }[]) {
      if (!contractIds.has(row.id)) deleteContract.run(row.id)
    }

    const upsertBudget = db.prepare(`
      INSERT INTO budgets (id, position, prk_no, activity, wbs, initial_amount, sppd_amount, updated_at)
      VALUES (@id, @position, @prk, @activity, @wbs, @initial, @sppd, datetime('now'))
      ON CONFLICT (id) DO UPDATE SET
        position = excluded.position, prk_no = excluded.prk_no, activity = excluded.activity, wbs = excluded.wbs,
        initial_amount = excluded.initial_amount, sppd_amount = excluded.sppd_amount, updated_at = datetime('now')`)
    const budgetIds = new Set<number>()
    budgets.forEach((b, index) => {
      const id = num(b.id)
      budgetIds.add(id)
      upsertBudget.run({ id, position: index, prk: str(b.prk), activity: str(b.activity), wbs: str(b.wbs), initial: num(b.initial), sppd: num(b.sppd) })
    })
    const deleteBudget = db.prepare('DELETE FROM budgets WHERE id = ?')
    for (const row of db.prepare('SELECT id FROM budgets').all() as { id: number }[]) {
      if (!budgetIds.has(row.id)) deleteBudget.run(row.id)
    }

    db.prepare("INSERT INTO app_meta (key, value) VALUES ('state_saved', '1') ON CONFLICT (key) DO UPDATE SET value = '1'").run()
  })
  tx()
}

// Baca data kontrak + anggaran. Mengembalikan null jika belum pernah disimpan (aplikasi memakai data awal).
export function loadState(db: Database.Database): { contracts: ContractRow[]; budgets: BudgetRow[] } | null {
  const saved = db.prepare("SELECT 1 FROM app_meta WHERE key = 'state_saved'").get()
  if (!saved) return null

  const termins = db.prepare('SELECT contract_id, amount, deadline, status FROM contract_termins ORDER BY contract_id, termin_no').all() as
    { contract_id: number; amount: number; deadline: string; status: string }[]
  const terminsByContract = new Map<number, TerminRow[]>()
  for (const t of termins) {
    const list = terminsByContract.get(t.contract_id) ?? []
    list.push({ amount: t.amount, deadline: t.deadline, status: t.status })
    terminsByContract.set(t.contract_id, list)
  }

  const contracts = (db.prepare('SELECT * FROM contracts ORDER BY position, id').all() as any[]).map((c): ContractRow => ({
    id: c.id, no: c.contract_no, ...(c.prk_no ? { prk: c.prk_no } : {}), title: c.title, wbs: c.wbs, vendor: c.vendor, start: c.start_date, end: c.end_date,
    value: c.value, ppn: c.ppn === 1, ppnRate: c.ppn_rate, ipms: c.ipms,
    ...(c.pic_name ? { picName: c.pic_name } : {}),
    ...(c.pic_email ? { picEmail: c.pic_email } : {}),
    ...(c.condition ? { condition: c.condition } : {}),
    ...(c.completed === 1 ? { completed: true } : {}),
    ...(c.completed_at ? { completedAt: c.completed_at } : {}),
    termins: terminsByContract.get(c.id) ?? [],
  }))
  const budgets = (db.prepare('SELECT * FROM budgets ORDER BY position, id').all() as any[]).map((b): BudgetRow => ({
    id: b.id, prk: b.prk_no, activity: b.activity, wbs: b.wbs, initial: b.initial_amount, sppd: b.sppd_amount,
  }))
  return { contracts, budgets }
}
