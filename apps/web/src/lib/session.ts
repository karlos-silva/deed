import type { Db } from '@deed/db'
import { type UserId, userId } from '@deed/core'
import { requestDb } from './db'

export type Session = {
  readonly db: Db
  readonly userId: UserId
  readonly email: string | null
  readonly provider: string | null
}

export async function session(): Promise<Session | null> {
  const db = await requestDb()
  const { data, error } = await db.auth.getUser()
  if (error !== null) return null
  return {
    db,
    userId: userId(data.user.id),
    email: data.user.email ?? null,
    provider: data.user.app_metadata.provider ?? null,
  }
}

export async function requireSession(): Promise<Session> {
  const current = await session()
  if (current === null) throw new Error('not signed in')
  return current
}
