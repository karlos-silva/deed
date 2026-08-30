import { Client } from 'pg'

/**
 * A signed-in session, reproduced the way Postgres actually sees one: the
 * `authenticated` role, plus the JWT claims PostgREST puts on the connection.
 * `auth.uid()` reads the `sub` from exactly here, so a policy cannot tell this
 * apart from a real request.
 */
export type QueryOptions = {
  /**
   * Disable sequential scans for this statement. Used to ask the planner what
   * it *could* do with the indexes available, rather than what it chose at a
   * table size where either plan is cheap.
   */
  seqscan?: boolean
}

export type Session = {
  /** Run a statement as this account. Rolls back if it throws. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[], options?: QueryOptions): Promise<T[]>
  /** Run a statement expected to be refused, and return the error code. */
  refused(sql: string, params?: unknown[]): Promise<string>
}

export type Harness = {
  readonly admin: Client
  /** Creates an account and returns its id. */
  account(email: string): Promise<string>
  as(uid: string | null, role?: 'authenticated' | 'anon' | 'service_role'): Session
  reset(): Promise<void>
  close(): Promise<void>
}

export async function connect(): Promise<Harness> {
  const url = process.env['TEST_DATABASE_URL']
  if (url === undefined) throw new Error('TEST_DATABASE_URL is not set; is the global setup running?')

  const admin = new Client({ connectionString: url })
  await admin.connect()

  const run = async <T>(
    uid: string | null,
    role: string,
    sql: string,
    params: unknown[],
    options: QueryOptions = {},
  ): Promise<T[]> => {
    await admin.query('begin')
    try {
      await admin.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify(uid === null ? { role } : { sub: uid, role }),
      ])
      if (options.seqscan === false) await admin.query('set local enable_seqscan = off')
      await admin.query(`set local role ${role}`)
      const result = await admin.query(sql, params)
      await admin.query('commit')
      return result.rows as T[]
    } catch (error) {
      await admin.query('rollback')
      throw error
    }
  }

  return {
    admin,

    async account(email) {
      const { rows } = await admin.query<{ id: string }>(
        'insert into auth.users (email) values ($1) returning id',
        [email],
      )
      return rows[0]!.id
    },

    as(uid, role = 'authenticated') {
      return {
        query: (sql, params = [], options = {}) => run(uid, role, sql, params, options),
        refused: async (sql, params = []) => {
          try {
            await run(uid, role, sql, params)
            return 'ALLOWED'
          } catch (error) {
            return (error as { code?: string }).code ?? 'unknown'
          }
        },
      }
    },

    async reset() {
      await admin.query('truncate public.audit_events, public.lookups, public.sandbox_zones cascade')
      await admin.query('delete from public.domains')
      await admin.query('delete from auth.users')
    },

    close: () => admin.end(),
  }
}

/** A pending claim, as the app would create it. */
export const pendingOwnership = (token: string, now = Date.now()) => ({
  status: 'pending',
  token,
  claimedAt: now,
  expiresAt: now + 14 * 24 * 3_600_000,
})

export const verifiedOwnership = (token: string, now = Date.now()) => ({
  status: 'verified',
  token,
  verifiedAt: now,
})

export const degradedOwnership = (token: string, now = Date.now()) => ({
  status: 'degraded',
  token,
  verifiedAt: now,
  degradedAt: now,
  revokesAt: now + 7 * 24 * 3_600_000,
  cause: 'record_missing',
})
