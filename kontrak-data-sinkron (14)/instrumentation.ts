// Dijalankan sekali saat server Next.js start: menyalakan penjadwal pengingat email.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startReminderScheduler } = await import('./lib/reminders')
    startReminderScheduler()
  }
}
