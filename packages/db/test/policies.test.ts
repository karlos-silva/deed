import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Harness,
  connect,
  degradedOwnership,
  pendingOwnership,
  verifiedOwnership,
} from './session'

/**
 * Everything a pure function cannot hold: isolation between accounts,
 * exclusivity of proof, and serialized writes (state-model §4, invariants 1, 2
 * and 8). Against real Postgres, because for RLS a mock tests the mock (D12).
 */

let db: Harness
let alice: string
let bob: string

const TOKEN_A = 'a'.repeat(52)
const TOKEN_B = 'b'.repeat(52)

beforeAll(async () => {
  db = await connect()
})
afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  await db.reset()
  alice = await db.account('alice@example.com')
  bob = await db.account('bob@example.com')
})

const claim = async (uid: string, name: string, token = TOKEN_A): Promise<string> => {
  const rows = await db.as(uid).query<{ id: string }>(
    `select * from public.create_claim($1, false, $2::jsonb, now(), now())`,
    [name, JSON.stringify(pendingOwnership(token))],
  )
  return rows[0]!.id
}

const transition = (uid: string | null, id: string, version: number, ownership: unknown, events: unknown[] = []) =>
  db.as(uid, uid === null ? 'service_role' : 'authenticated').query<{ apply_transition: unknown }>(
    `select public.apply_transition(
       $1::uuid, $2::bigint, now(), $3::jsonb,
       '{"status":"verified"}'::jsonb, null, now(), null, now(), $4::jsonb
     ) as apply_transition`,
    [id, version, JSON.stringify(ownership), JSON.stringify(events)],
  )

describe('accounts are isolated', () => {
  it('RLS isolates accounts without simply denying everyone', async () => {
    const hers = await claim(alice, 'acme.com')

    // B cannot read A's domain by id…
    expect(await db.as(bob).query(`select id from public.domains where id = $1`, [hers])).toEqual([])
    // …nor her audit history…
    expect(await db.as(bob).query(`select id from public.audit_events where domain_id = $1`, [hers])).toEqual([])

    // …nor change it. Zero rows affected, not an error: RLS filters, it does not shout.
    const updated = await db.as(bob).query(
      `update public.domains set name = 'stolen.com' where id = $1 returning id`,
      [hers],
    )
    expect(updated).toEqual([])

    // With no JWT at all, nothing.
    expect(await db.as(null, 'anon').query(`select id from public.domains`)).toEqual([])

    // And the half a deny-everyone policy would also pass: A reads her own.
    // Without this assertion the three above are satisfied by a broken product.
    const mine = await db.as(alice).query<{ id: string }>(`select id from public.domains`)
    expect(mine.map((row) => row.id)).toEqual([hers])
    expect(await db.as(alice).query(`select id from public.audit_events where domain_id = $1`, [hers]))
      .toHaveLength(1)
  })

  it('the audit log is not writable by the account it belongs to', async () => {
    const hers = await claim(alice, 'acme.com')
    // A history the client can write is not evidence (prd §3).
    const code = await db.as(alice).refused(
      `insert into public.audit_events (domain_id, owner_id, domain_name, at, kind, actor, to_status)
       values ($1, $2, 'acme.com', now(), 'state_changed', 'user', 'verified')`,
      [hers, alice],
    )
    expect(code).toBe('42501')
  })
})

describe('claiming is open, proof is not', () => {
  it('Pending is open, verified is exclusive', async () => {
    // Any number of accounts may attempt the same name. If claiming reserved
    // it, squatting would cost one click (prd §8).
    const hers = await claim(alice, 'contested.com', TOKEN_A)
    const his = await claim(bob, 'contested.com', TOKEN_B)
    expect(hers).not.toBe(his)

    // A proves it. B's claim is revoked at that moment, with a reason.
    const [result] = await transition(alice, hers, 0, verifiedOwnership(TOKEN_A))
    expect(result!.apply_transition).toMatchObject({ applied: true, revoked_competing: 1 })

    const [bobsClaim] = await db.as(bob).query<{ status: string; reason: string }>(
      `select ownership->>'status' as status, ownership->>'reason' as reason
         from public.domains where id = $1`,
      [his],
    )
    expect(bobsClaim).toEqual({ status: 'revoked', reason: 'claimed_by_other' })

    // B sees an explanation, not a silently vanished claim.
    const explanation = await db.as(bob).query<{ to_status: string }>(
      `select to_status from public.audit_events
        where domain_id = $1 and kind = 'state_changed' order by id desc limit 1`,
      [his],
    )
    expect(explanation[0]?.to_status).toBe('revoked')
  })

  it('Degradation keeps the domain', async () => {
    // A degraded holder keeps the name for the whole grace window: you do not
    // lose your domain to a squatter because of a DNS migration (invariant 2).
    const hers = await claim(alice, 'migrating.com', TOKEN_A)
    await transition(alice, hers, 0, verifiedOwnership(TOKEN_A))
    await transition(alice, hers, 1, degradedOwnership(TOKEN_A))

    const his = await claim(bob, 'migrating.com', TOKEN_B)
    expect(his).toBeTruthy() // pending is still open to him

    // But he cannot be promoted while her claim is live.
    const code = await db.as(bob).refused(
      `update public.domains set ownership = $2::jsonb where id = $1`,
      [his, JSON.stringify(verifiedOwnership(TOKEN_B))],
    )
    expect(code).toBe('23505') // one live claim per name
  })
})

describe('writes for one domain are serialized', () => {
  it('A sweep and a manual check cannot double-write', async () => {
    const hers = await claim(alice, 'raced.com')
    const event = [{ kind: 'state_changed', actor: 'sweep', level: 'claim', from: 'pending', to: 'verified' }]

    // Both read version 0 — the sweep and the user's Check now, firing together.
    const [first] = await transition(null, hers, 0, verifiedOwnership(TOKEN_A), event)
    const [second] = await transition(alice, hers, 0, verifiedOwnership(TOKEN_A), event)

    expect(first!.apply_transition).toMatchObject({ applied: true, version: 1 })
    // The second waited for the lock, found the state it read was gone, and
    // discarded its observation rather than applying it to state it never read.
    expect(second!.apply_transition).toMatchObject({ applied: false, reason: 'stale', version: 1 })

    // One transition, one audit event. Not two.
    const events = await db.as(alice).query(
      `select id from public.audit_events where domain_id = $1 and kind = 'state_changed'`,
      [hers],
    )
    expect(events).toHaveLength(1)
  })
})

describe('the log grows without becoming unreadable', () => {
  it('The audit log stays readable as it grows', async () => {
    const hers = await claim(alice, 'noisy.com')
    // A month of checks every six hours is ~120; make it an order worse. Ids
    // ascend with time, as an append-only log's do…
    await db.admin.query(
      `insert into public.audit_events (domain_id, owner_id, domain_name, at, kind, actor, to_status)
       select $1, $2, 'noisy.com', now() - ((1200 - g) || ' minutes')::interval,
              'check_completed', 'sweep', 'verified'
         from generate_series(1, 1200) g`,
      [hers, alice],
    )
    // …except where they do not. A backfilled event has an old timestamp and a
    // new id, and a cursor keyed on id alone silently skips rows around it.
    await db.admin.query(
      `insert into public.audit_events (domain_id, owner_id, domain_name, at, kind, actor, to_status)
       values ($1, $2, 'noisy.com', now() - interval '600 minutes', 'check_completed', 'system', 'verified')`,
      [hers, alice],
    )

    const page = async (before: { at: string; id: number } | null) =>
      db.as(alice).query<{ id: number; at: string }>(
        `select id::int as id, at from public.audit_events
          where domain_id = $1
            and ($2::timestamptz is null or (at, id) < ($2::timestamptz, $3::bigint))
          order by at desc, id desc limit 25`,
        [hers, before?.at ?? null, before?.id ?? null],
      )

    const first = await page(null)
    const second = await page(first.at(-1)!)

    expect(first).toHaveLength(25)
    expect(second).toHaveLength(25)
    // Newest first, and the pages neither overlap nor skip.
    const seen = [...first, ...second]
    expect(new Set(seen.map((r) => r.id)).size).toBe(50)
    for (let i = 1; i < seen.length; i++) {
      expect(Date.parse(seen[i]!.at)).toBeLessThanOrEqual(Date.parse(seen[i - 1]!.at))
    }

    // "Renders without loading every event" is a claim about the plan, and the
    // plan has to be the one RLS actually produces: the policy predicate on
    // owner_id is a security barrier, so an index keyed on domain_id alone is
    // never reachable. Sorting the account's whole history to show 25 rows is
    // what must be impossible, not merely unchosen.
    const plan = (
      await db.as(alice).query<{ 'QUERY PLAN': string }>(
        `explain select * from public.audit_events
          where domain_id = '${hers}' order by at desc, id desc limit 25`,
        [],
        { seqscan: false },
      )
    )
      .map((row) => row['QUERY PLAN'])
      .join('\n')

    expect(plan).toMatch(/Index Scan/)
    expect(plan).not.toMatch(/Sort/)
  })
})

describe('the background sweep', () => {
  it('The sweep runs with nobody watching', async () => {
    const due = await claim(alice, 'due.com', TOKEN_A)
    const later = await claim(bob, 'later.com', TOKEN_B)

    await db.admin.query(
      `update public.domains set next_check_at = case when id = $1
         then now() - interval '5 minutes' else now() + interval '1 hour' end`,
      [due],
    )

    // The sweep has no session at all, which is why RLS cannot express "due":
    // due-ness is a property of the fleet, not of one account's rows.
    const claims = await db.as(null, 'service_role').query<{ id: string }>(
      `select id from public.claims_due(now(), 25)`,
    )
    expect(claims.map((c) => c.id)).toEqual([due])
    expect(claims.map((c) => c.id)).not.toContain(later)

    // And nobody else may ask. A signed-in account reading the whole fleet's
    // schedule would be reading other people's domains by another name.
    expect(await db.as(alice).refused(`select id from public.claims_due(now(), 25)`)).toBe('42501')
    expect(await db.as(null, 'anon').refused(`select id from public.claims_due(now(), 25)`)).toBe('42501')

    // It writes the transition with no user present…
    const [result] = await transition(null, due, 0, verifiedOwnership(TOKEN_A), [
      { kind: 'check_completed', actor: 'sweep', to: 'verified' },
    ])
    expect(result!.apply_transition).toMatchObject({ applied: true })

    // …and the owner, who was not watching, finds it done and attributed.
    const [event] = await db.as(alice).query<{ actor: string }>(
      `select actor from public.audit_events
        where domain_id = $1 and kind = 'check_completed' order by id desc limit 1`,
      [due],
    )
    expect(event!.actor).toBe('sweep')

    // Each run leaves a row of its own, which is both the freshness the product
    // claims and the real database activity a paused free project needs (D10).
    await db.as(null, 'service_role').query(
      `insert into public.sweep_runs (due, checked, failed) values (1, 1, 0)`,
    )
    const [run] = await db.as(alice).query<{ checked: number }>(
      `select checked from public.sweep_runs order by id desc limit 1`,
    )
    expect(run!.checked).toBe(1)
  })
})

describe('recovery', () => {
  it('Re-claiming gets a fresh token', async () => {
    const first = await claim(alice, 'lapsed.com', TOKEN_A)
    await transition(alice, first, 0, { status: 'revoked', reason: 'released_by_owner' }, [
      { kind: 'released', actor: 'user' },
    ])

    // The name is free again, and the new claim is a new claim.
    const second = await claim(alice, 'lapsed.com', TOKEN_B)
    expect(second).not.toBe(first)

    const [row] = await db.as(alice).query<{ token: string }>(
      `select ownership->>'token' as token from public.domains where id = $1`,
      [second],
    )
    expect(row!.token).toBe(TOKEN_B)
    expect(row!.token).not.toBe(TOKEN_A)
  })

  it('Deletion is confirmed and logged', async () => {
    const hers = await claim(alice, 'released.com', TOKEN_A)
    await transition(alice, hers, 0, verifiedOwnership(TOKEN_A))
    await transition(alice, hers, 1, { status: 'revoked', reason: 'released_by_owner' }, [
      { kind: 'released', actor: 'user' },
      { kind: 'state_changed', actor: 'user', level: 'claim', from: 'verified', to: 'revoked' },
    ])

    // The deletion is recorded, and her history is still hers to read (prd §10).
    const history = await db.as(alice).query<{ kind: string }>(
      `select kind from public.audit_events where domain_id = $1 order by id`,
      [hers],
    )
    expect(history.map((h) => h.kind)).toContain('released')
    expect(history.map((h) => h.kind)).toContain('claim_created')

    // And it is off her list, without any of that history moving.
    await db.as(alice).query(`select public.set_hidden($1, true, now())`, [hers])
    const [listed] = await db.as(alice).query<{ hidden_at: string | null }>(
      `select hidden_at from public.domains where id = $1`,
      [hers],
    )
    expect(listed!.hidden_at).not.toBeNull()
    const afterHiding = await db.as(alice).query<{ kind: string }>(
      `select kind from public.audit_events where domain_id = $1 order by id`,
      [hers],
    )
    expect(afterHiding.map((h) => h.kind)).toEqual(history.map((h) => h.kind))

    // The name is free for others to prove.
    const his = await claim(bob, 'released.com', TOKEN_B)
    const [result] = await transition(bob, his, 0, verifiedOwnership(TOKEN_B))
    expect(result!.apply_transition).toMatchObject({ applied: true })

    // And his log starts empty of her history — it never crosses accounts.
    const hisLog = await db.as(bob).query(`select id from public.audit_events where domain_id = $1`, [his])
    expect(hisLog).toHaveLength(1) // his own claim_created, and nothing of hers
  })
})

describe('a closed claim can leave the list without leaving the ledger', () => {
  it('Removing and restoring writes no state and no history', async () => {
    const id = await claim(alice, 'closed.com', TOKEN_A)
    await transition(alice, id, 0, { status: 'revoked', reason: 'released_by_owner' }, [
      { kind: 'released', actor: 'user' },
    ])

    const before = await db.as(alice).query<{ version: number; ownership: unknown; kind: string }>(
      `select d.version, d.ownership, e.kind
         from public.domains d join public.audit_events e on e.domain_id = d.id
        where d.id = $1 order by e.id`,
      [id],
    )

    await db.as(alice).query(`select public.set_hidden($1, true, now())`, [id])
    await db.as(alice).query(`select public.set_hidden($1, false, now())`, [id])

    const after = await db.as(alice).query<{ version: number; ownership: unknown; kind: string }>(
      `select d.version, d.ownership, e.kind
         from public.domains d join public.audit_events e on e.domain_id = d.id
        where d.id = $1 order by e.id`,
      [id],
    )

    // Not a transition: no version bump, no state change, no new event.
    expect(after).toEqual(before)

    const [row] = await db.as(alice).query<{ hidden_at: string | null }>(
      `select hidden_at from public.domains where id = $1`,
      [id],
    )
    expect(row!.hidden_at).toBeNull()
  })

  it('A live claim stays on the list', async () => {
    const id = await claim(alice, 'live.com', TOKEN_A)

    // Pending is live, and so is verified.
    await expect(
      db.as(alice).query(`select public.set_hidden($1, true, now())`, [id]),
    ).rejects.toThrow(/live claim cannot be removed/)

    await transition(alice, id, 0, verifiedOwnership(TOKEN_A))
    await expect(
      db.as(alice).query(`select public.set_hidden($1, true, now())`, [id]),
    ).rejects.toThrow(/live claim cannot be removed/)

    // Not even by writing the column directly.
    expect(
      await db.as(alice).refused(`update public.domains set hidden_at = now() where id = $1`, [id]),
    ).toBe('23514')
  })

  it('Removing is not something one account does to another', async () => {
    const hers = await claim(alice, 'hers.com', TOKEN_A)
    await transition(alice, hers, 0, { status: 'revoked', reason: 'released_by_owner' })

    await expect(
      db.as(bob).query(`select public.set_hidden($1, true, now())`, [hers]),
    ).rejects.toThrow(/not your domain/)
  })

  it('A domain row cannot be deleted, only closed', async () => {
    const id = await claim(alice, 'permanent.com', TOKEN_A)

    // No delete policy: PostgREST-shaped clients get zero rows affected, never
    // a deleted one. History and the spent rate-limit budget both survive.
    await db.as(alice).query(`delete from public.domains where id = $1`, [id])
    const rows = await db.as(alice).query(`select id from public.domains where id = $1`, [id])
    expect(rows).toHaveLength(1)
  })
})

describe('the cap counts what an account can still act on', () => {
  it('Releasing a claim frees a slot', async () => {
    for (let i = 0; i < 25; i++) await claim(alice, `cap${i}.com`)
    await expect(claim(alice, 'cap25.com')).rejects.toThrow(/domain cap reached/)

    // Closing one makes room; the closed row stays, and does not count.
    const [first] = await db.as(alice).query<{ id: string; version: number }>(
      `select id, version from public.domains where owner_id = $1 order by created_at limit 1`,
      [alice],
    )
    await transition(alice, first!.id, first!.version, {
      status: 'revoked',
      reason: 'released_by_owner',
    })

    const made = await claim(alice, 'cap25.com')
    expect(made).toBeTruthy()
    const [{ count }] = await db.as(alice).query<{ count: string }>(
      `select count(*) as count from public.domains where owner_id = $1`,
      [alice],
    )
    expect(Number(count)).toBe(26)
  })
})

describe('the write path has exactly one shape', () => {
  it('Adding a parameter replaced each function rather than overloading it', async () => {
    // `create or replace` cannot change a signature: it silently creates a second
    // overload, and PostgREST then refuses the call as ambiguous. Migration 0006
    // drops before it creates, and this is what proves the drop matched.
    const rows = await db.admin.query<{ name: string; count: string }>(
      `select p.proname as name, count(*)::text as count
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('apply_transition', 'create_claim', 'set_hidden')
        group by p.proname order by p.proname`,
    )
    expect(rows.rows.map((r) => [r.name, r.count])).toEqual([
      ['apply_transition', '1'],
      ['create_claim', '1'],
      ['set_hidden', '1'],
    ])
  })
})
