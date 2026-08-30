import { NextResponse } from 'next/server'
import { requestDb } from '@/lib/db'

export async function POST(request: Request): Promise<Response> {
  const db = await requestDb()
  await db.auth.signOut()
  return NextResponse.redirect(new URL('/', new URL(request.url).origin), { status: 303 })
}
