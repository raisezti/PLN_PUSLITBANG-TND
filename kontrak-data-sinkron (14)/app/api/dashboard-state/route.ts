import { NextResponse } from 'next/server'
import { getDb, loadState, saveState } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const state = loadState(getDb())
  return NextResponse.json(state ?? { contracts: null, budgets: null })
}

export async function PUT(request: Request) {
  const body = await request.json()
  const contracts = Array.isArray(body.contracts) ? body.contracts : []
  const budgets = Array.isArray(body.budgets) ? body.budgets : []
  saveState(getDb(), contracts, budgets)
  return NextResponse.json({ ok: true })
}
