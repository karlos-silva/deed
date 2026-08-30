# Delivery plan

Nine vertical slices. Each one ends deployed and demonstrable — no slice is
"backend only." This is the last document before code.

It sequences work and states acceptance; it does not restate the specs. Where a
slice needs a rule, it points at [state-model.md](./state-model.md),
[prd.md](./prd.md), or a decision in [decisions.md](./decisions.md).

---

## Definition of done — every slice

Five failures are what these guardrails exist to prevent, worst first:

1. **A silently wrong verdict** — reporting `verified` for a domain the user does
   not control. Wildcard shadowing and superseded-token confusion both produce
   exactly this, and neither announces itself.
2. **One account reading another's claims or tokens** — invisible until it is a
   disclosure.
3. **A secret in the client bundle** — the service key is one `NEXT_PUBLIC_`
   away at all times.
4. **Telling the user to wait through an error**, or to fix a zone that is fine.
5. **Our outage revoking their domain** — an our-side failure treated as evidence.

A guardrail that depends on someone remembering is not a guardrail, so each of
these is held by the build, by CI, or by a test that fails loudly.

**Enforced mechanically**
- `tsc --noEmit` clean under `strict`, `noUncheckedIndexedAccess`, and
  `exactOptionalPropertyTypes`. `any` is an error.
- `@typescript-eslint/switch-exhaustiveness-check` is an error: a new variant in
  `RecordState` breaks the build at every site that must handle it. This is the
  reason these are discriminated unions and not string enums.
- `no-restricted-imports` in `packages/core` — no `node:*`, no `fetch`, no
  Supabase client. The purity claim in state-model §6 is enforced, not asserted.
- `Date.now()` and `new Date()` are banned inside `packages/core`. `now` arrives
  as a parameter, so day-long windows test in microseconds with no sleeps.

**Enforced per slice**
- Every `#### Scenario:` heading here has a test of the same name. A CI script
  extracts the headings and fails if one has no match. This is the cheapest
  guardrail we have and the one that keeps specs from quietly becoming fiction.
- Core test obligations live in state-model §7 and are not restated here.
- Deployed to Vercel and reachable from a cold browser, signed out.
- No state rendered that state-model does not define. If a screen needs a state
  the spec lacks, the spec changes first.
- Copy blames the mechanism, never the user (prd §3).
- Every screen works at 375px wide. People open links on a phone, and a
  deployed link that breaks there has failed before anyone reads a line of the
  code.

**Tooling.** Vitest, `fast-check` for properties, real Postgres via
`supabase start` for anything touching RLS, one Playwright smoke test. What we
deliberately do not test, and why, is D12.

---

## S0 — Walking skeleton

**Status.** Done — deployed at <https://domains.karlos.dev>.

Every assumption this slice existed to test was worth testing, and three of them
bit. DoH from a serverless runtime held for two resolvers and forced D15 for the
third. `pg_cron` on the free tier works exactly as D5 claimed. And the deploy
itself failed twice in ways only a real deploy produces: a build step reaching
outside the root directory, and `NEXT_PUBLIC_*` variables marked as Vercel
"Secret", which are then withheld from the very bundle the prefix exists to
reach — so the app read them as `undefined` while the dashboard showed them
present.

**Context.** Every hard external assumption gets validated before anything is
built on it. Three could each force a redesign: DoH reachable from a Vercel
function (D4), `pg_cron` schedulable on Supabase free (D5), and OAuth callbacks
working on the deployed origin (D1). Discovering any of these in the final week
is the worst outcome available.

**Story.** As the person building this, I want the whole stack proven end to end
on day one, so that no later slice is blocked by infrastructure I assumed.

**Acceptance**
- [x] pnpm + Turborepo monorepo, packages per D7.
- [x] `apps/web` deployed to Vercel, reachable at a public URL.
- [x] Sign in with GitHub and Google, both working on the deployed origin.
      *Verified from a cold signed-out browser: the app hands off to Supabase,
      Supabase to the provider, and GitHub names the app back — "to continue to
      Deed".*
- [x] A route handler resolves one hardcoded TXT record over DoH against all
      three resolvers and renders the raw answers. *Proven against the real
      internet by the release check in S2; the assumption it existed to test —
      DoH reachable from a serverless runtime — held for two of three resolvers
      and forced D15 for the third.*
- [x] A `pg_cron` job writes a heartbeat row every minute; the page shows the
      last heartbeat, proving the sweep mechanism works. *Running once a minute
      against the deployment. `net._http_response` recorded the moment it
      started working — six 500s, then `200 {"due":0,"checked":0,"failed":0}` —
      which is the sweep proving itself with nobody watching.*
- [x] A post-build test scans the client bundle for the service-role key and
      Supabase secret-key patterns, and fails the build on a hit. Wired in S0
      because this is the one mistake that is only detectable at build time, and
      only catastrophic after deploy. *Verified by planting a fake secret and
      watching the build refuse.*

**Not here.** Any product UI. Any state modelling. It is scaffolding, and it is
allowed to be ugly.

---

## S1 — The core, pure and tested

**Status.** Done. 65 tests, `tsc` and ESLint clean. The 559-case enumeration and
the §4 invariants run as property tests in under half a second.

**Context.** Everything downstream consumes these types. Building UI or routes
first means rewriting them once the reducer is real.

**Story.** As the person debugging this six weeks from now, I want the rules to
live in one module with no I/O, so that I can reason about a state transition
without running the app.

**Scenarios**

#### A wrong value outranks a correct majority
- **WHEN** one resolver returns a value that is neither current nor superseded
- **AND** two other resolvers hold the current value
- **THEN** the record is `mismatch`, not `verified`
- **AND** no grace window is started or extended

#### A superseded value never reaches quorum
- **WHEN** two resolvers hold a superseded value and none hold the current one
- **THEN** the record is `propagating` with direction `arriving`
- **AND** the claim does not become `verified`

#### A failed lookup concludes nothing
- **WHEN** every resolver fails with an our-side error
- **AND** the claim was `verified` before the check
- **THEN** the claim is still `verified` and no clock has advanced

#### The window expires on injected time
- **WHEN** a claim has been `degraded` for seven days and one second of injected time
- **THEN** the claim is `revoked` with reason `grace_expired`
- **AND** the whole suite still runs in milliseconds

#### The precedence table is enumerated exhaustively, not sampled
- **WHEN** every combination of three resolvers each answering in one of seven
  ways — current, superseded, wildcard-served, unknown, absent, zone-side
  error, our-side error — is generated, crossed with the control probe
  answering or silent, excluding the incoherent cases (a wildcard-served value
  with a silent probe), so 559 cases
- **THEN** each produces exactly one status
- **AND** every one matches the table in state-model §3

#### Adding a status breaks the build
- **WHEN** a variant is added to `RecordState`
- **THEN** `tsc` fails at every site that switches over it
**Not here.** Real DNS. Persistence. Anything visual.

---

## S2 — Both resolvers behind one port

**Status.** Done. One `DnsPort`, two adapters, one contract suite of nine cases
run against each. DoH fixtures are captured from real resolvers by
`scripts/capture-doh-fixtures.mjs`; Quad9 was replaced mid-slice and the engine
never noticed (D15).

**Context.** The sandbox adapter is built *with* the DoH adapter, not after it.
It is what makes every failure state reachable on demand — including in tests,
including in the demo. Deferring it means testing failure by hand-breaking real
DNS, which is slow and unrepeatable.

**Story.** As a visitor with no domain to hand, I want to drive real failures
myself, so that I can see how the product behaves when things go wrong.

**Scenarios**

#### A long value arrives in chunks
- **WHEN** a resolver returns a TXT record as three character-strings
- **THEN** the adapter returns them joined with no separator

#### Their failure is not our failure
- **WHEN** a resolver answers SERVFAIL or a DNSSEC validation failure
- **THEN** the error is classified zone-side
- **WHEN** a lookup times out or is throttled
- **THEN** the error is classified ours

#### A wildcard answers for a host nobody created
- **WHEN** the control probe returns a value and the challenge host returns
  only that same wildcard-served value
- **THEN** the record is `mismatch` with cause `wildcard_shadow`
- **AND** the copy says the record is missing, not that its value is wrong

#### A wildcard does not veto a real record
- **WHEN** the zone has a wildcard TXT (`* IN TXT "v=spf1 -all"`)
- **AND** the explicit challenge record holds the current token at quorum
- **THEN** the record is `verified`

#### One contract suite, run against both adapters
- **WHEN** the resolver contract tests run
- **THEN** they run unchanged against the DoH adapter, backed by fixtures captured
  from real resolvers and committed to the repo
- **AND** unchanged against the sandbox adapter
- **AND** neither adapter skips a test the other passes

#### Sandbox routing is total
- **WHEN** the domain ends in `.test`
- **THEN** every lookup is served by the sandbox
- **AND** a network mock records zero outbound requests

#### Live DNS is checked once, and not in the commit loop
- **WHEN** the release check runs
- **THEN** one smoke test resolves a known-stable public TXT record for real
- **AND** it does not run on every commit, so a third party's outage cannot turn
  our CI red
**Not here.** The verification loop. UI.

---

## S3 — Claim and prove

**Status.** Done — 8/8. The three that needed real Postgres and a second account
are covered by a harness that boots one in Docker (D17), and the first of them
found a missing INSERT policy that had been shipping a broken claim flow.

**Context.** The first slice that does what the product is for: claim a domain
and prove it. From here the product exists; everything after makes it legible.

**Story.** As a developer setting this up, I want to add my domain and be told
plainly when it is proven mine, so that I can stop thinking about it.

**Scenarios**

#### A pasted URL is accepted without complaint
- **WHEN** the user submits `HTTPS://Updates.ACME.com/path/`
- **THEN** the claim is created for `updates.acme.com`

#### A public suffix cannot be claimed
- **WHEN** the user submits `co.uk` or `github.io`
- **THEN** the claim is refused, and the message says why
- **AND** a property test samples the Public Suffix List and asserts every entry
  is rejected, so this holds as the list grows

#### Names that are not public domains are refused
- **WHEN** the user submits an IP literal, `localhost`, or a `.local` or
  `.internal` name
- **THEN** the claim is refused before any lookup is attempted
- **WHEN** a label exceeds 63 bytes, or the name exceeds 253
- **THEN** the claim is refused
- **WHEN** the name ends in `.test`
- **THEN** it is accepted and routed to the sandbox — the one reserved-suffix
  exception (D2, D10)
- **WHEN** the user submits `test` itself
- **THEN** it is refused; a sandbox name needs at least one label of its own

#### A first-time account has somewhere to start
- **WHEN** a newly signed-in account has no domains
- **THEN** the screen explains what claiming does and what will be needed
- **AND** does not render an empty table with a heading

#### Proof at quorum
- **WHEN** the token is published and two of three resolvers hold it
- **THEN** the claim becomes `verified`

#### A sandbox domain is provable without owning anything
- **WHEN** a `.test` domain is claimed
- **THEN** its page includes the simulated zone, clearly labelled as such
- **AND** publishing the token there drives the same engine as a real record

#### RLS isolates accounts without simply denying everyone
- **WHEN** account B requests account A's domain or token by id
- **THEN** no row is returned
- **WHEN** account B attempts to update account A's domain
- **THEN** zero rows are affected
- **WHEN** there is no JWT at all
- **THEN** nothing is returned
- **WHEN** account A requests their own rows
- **THEN** they are returned — a policy that denies everyone passes the checks
  above and ships a broken product
- **AND** these run against real Postgres, because a mocked policy tests the mock

#### Pending is open, verified is exclusive
- **WHEN** account A holds a pending claim on `example.com`
- **THEN** account B may hold one too
- **WHEN** account A's claim becomes `verified`
- **THEN** account B's claim is `revoked` with reason `claimed_by_other`
- **AND** account B sees an explanation, not a silently vanished claim
**Not here.** Diagnosis of wrong values. Background checking.

---

## S4 — Understanding the wait

**Status.** Done — 5/5. The *Check now* limit moved into `packages/core` as a
rule: it is never told which domain it is deciding about, so a refusal cannot
disclose whether one exists.

**Context.** This is where most products render a spinner. It is the difference
between a demo and a product.

**Story.** As someone who pasted a record two minutes ago, I want to see what is
actually happening, so that I know whether to wait or to go fix something.

**Scenarios**

#### Before the first check
- **WHEN** a claim exists and no check has completed
- **THEN** the record renders as *not looked yet*, never as *not found*

#### Partial arrival names its evidence
- **WHEN** one of three resolvers holds the value
- **THEN** the state is `propagating`, direction `arriving`, and the UI names which
  resolver has it and what TTL it reported

#### A verified record starting to vanish reads differently
- **WHEN** a `verified` record is lost from one resolver
- **THEN** direction is `receding`, and the copy says it is disappearing rather
  than arriving

#### Check now is limited, honest, and reveals nothing
- **WHEN** the user triggers *Check now* twice inside the limit
- **THEN** the second is refused with the time remaining
- **AND** no cached result is presented as fresh
- **AND** the refusal does not disclose whether the domain exists or who holds it

#### Verification survives the tab closing
- **WHEN** the browser is closed for ten minutes
- **THEN** on return, last-checked reflects checks that ran while away
**Not here.** Diagnosis copy. Degradation.

---

## S5 — Understanding failure

**Status.** Done — 7/7. Every row of the PRD §7 taxonomy is reachable by hand in
the sandbox and produces its named cause. Pre-flight reads the zone's NS records
before a token is issued, names the provider, and uses that panel's own field
labels — and never blocks.

**Context.** The PRD asks for a product that explains failure and enables
recovery. This slice is that sentence.

**Story.** As someone whose record was silently mangled by their DNS provider, I
want to be told what the provider did, so that I stop re-reading a value I
already pasted correctly.

**Scenarios**

#### The provider added quotes
- **WHEN** the observed value is the expected value wrapped in double quotes
- **THEN** the cause is `quoted_value`, the copy names the provider's behaviour,
  and the diff marks exactly the two quote characters

#### The provider appended the zone
- **WHEN** the observed value ends with the zone apex appended
- **THEN** the cause is `appended_apex` and the fix names the trailing dot

#### Waiting will not help, and we say so
- **WHEN** the record is `mismatch`
- **THEN** no countdown is shown, and the copy states that waiting will not fix it

#### A corrected mistake stops reading as fatal
- **WHEN** a wrong value was published, then corrected
- **AND** one resolver still serves the cached wrong value while the current
  token is gaining resolvers
- **THEN** the copy acknowledges the correction is arriving and bounds it with
  the observed TTL, instead of flatly declaring that waiting will not help

#### Their problem versus ours
- **WHEN** every resolver answers SERVFAIL
- **THEN** the message describes their zone failing to answer
- **WHEN** every lookup fails on our side
- **THEN** the message describes our check failing, and does not suggest editing DNS

#### Pre-flight warns before the mistake, and never blocks
- **WHEN** the domain's NS records indicate Cloudflare
- **THEN** instructions use Cloudflare's own field labels, and the quoting warning
  appears before the token is issued
- **AND** the user can still proceed

#### Every failure in the taxonomy can be staged by hand
- **WHEN** the visitor edits a sandbox zone — wraps the value in quotes,
  appends the apex, deletes the record, adds a wildcard, or puts a CNAME at
  the host
- **THEN** each edit produces its named diagnosis from PRD §7
- **AND** none of them requires a test fixture or a real domain
**Not here.** Rotation. The sweep.

---

## S6 — Continuity

**Status.** Done — 7/7. Degradation and the windows run on injected time; the
sweep, the double-write guard and audit paging are asserted against real
Postgres. Paging found two defects the code could not have shown otherwise: an
audit index unreachable under RLS, and a cursor keyed on the wrong tuple.

**Context.** Verification decays (prd §3). Without this slice the product claims
a permanent fact from a mutable source.

**Story.** As the person who inherited this domain six weeks later, I want to see
what changed and when, so that I can fix sending without opening a ticket.

**Scenarios**

#### The sweep runs with nobody watching
- **WHEN** five minutes pass with no session open
- **THEN** last-checked has advanced

#### A verified record is deleted
- **WHEN** the token disappears from every resolver
- **THEN** the claim becomes `degraded`, the seven-day window starts, and the audit
  log records the transition with the evidence that produced it

#### Degradation keeps the domain
- **WHEN** a claim is `degraded` and another account attempts the same name
- **THEN** that account may hold a pending claim but cannot become `verified`

#### The window expires
- **WHEN** seven days pass while `degraded`
- **AND** a conclusive check at or after the deadline still finds no proof
- **THEN** the claim is `revoked` and the name is claimable again

#### A sweep and a manual check cannot double-write
- **WHEN** the sweep and a user's *Check now* fire for the same domain at the
  same moment
- **THEN** exactly one transition is persisted and exactly one audit event written
- **AND** the second observation waits for the per-domain lock or is discarded —
  never applied to state it did not read (state-model §4, invariant 8)

#### The audit log stays readable as it grows
- **WHEN** a domain has been checked every six hours for a month
- **THEN** the log is paginated, newest first
- **AND** the page renders without loading every event

#### An outage on our side revokes nothing
- **WHEN** every sweep for an hour fails with our-side errors
- **THEN** no claim is degraded and no window has started
- **AND** a `degraded` claim already past its deadline stays `degraded` until
  a conclusive check confirms the proof is still gone
**Not here.** Rotation.

---

## S7 — Recovery

**Status.** Done — 5/5.

**Context.** The PRD's promise is *recover when it breaks*. Rotation is the
sharpest case, and the one that breaks a naive engine.

**Story.** As someone who pasted their token into a public gist, I want to
replace it without losing the domain, so that a mistake is not permanent.

**Scenarios**

#### Rotation does not read as breakage
- **WHEN** the token is rotated and resolvers still hold the previous value
- **THEN** the record is `propagating`, not `mismatch`

#### The old token cannot prove anything
- **WHEN** only the superseded value is present, at all three resolvers
- **THEN** the claim does not become `verified`

#### Supersession expires
- **WHEN** `max(observed TTL, 24h)` has passed since rotation
- **AND** the previous value is still published
- **THEN** it is treated as an unknown value and the record is `mismatch`

#### Re-claiming gets a fresh token
- **WHEN** a revoked domain is claimed again
- **THEN** a new token is issued and the previous one is never accepted

#### Deletion is confirmed and logged
- **WHEN** the user deletes a verified domain
- **THEN** they are told it frees the name for others, and the deletion is recorded
- **AND** their audit history for the claim remains readable afterwards
- **AND** a later claim on the name by another account starts an empty log —
  history never crosses accounts (prd §10)
**Not here.** Polish.

---

## S8 — Polish and the README

**Status.** Not started.

**Context.** Documentation and polish are where a project is read first, and
the README is the most-read file in the repo. It is written last because it can
then be true.

**Acceptance**
- [ ] README: what this is, the model in a paragraph, how to run it, the
      deployed URL, and the honest limits — including free-tier pausing (D10).
- [ ] Captured screens of every state, from the sandbox.
- [ ] Keyboard reachable end to end; visible focus; `prefers-reduced-motion`
      respected.
- [ ] Empty, loading, and error states exist for every screen.
- [ ] An error boundary catches a render failure and offers a way back, rather
      than showing a blank page.
- [ ] The footer states what this is: an independent study that only reads
      your DNS (D9).
- [ ] The deployed link is verified live from a signed-out browser.

---

## On the two formats

S1–S7 state **scenarios**, because they assert behaviour and each one is a test
name. S0 and S8 stay **checklists**, because they are setup and presence — there
is no behaviour to trigger in "the monorepo exists" or "focus is visible", and
forcing those into `WHEN`/`THEN` would be ceremony, not precision.

The scenario format is borrowed from OpenSpec. The tool itself is not used
(D11).

## Sequencing notes

**Cut from the back, never the front.** If time runs short, S7 collapses to
rotation only and S8 keeps just the README and the deployed link. S0 through S5
are the core; S6 and S7 are what make it a product rather than a form.

**Two checkpoints.** After S0, every infrastructure assumption is either proven
or has forced a documented change. After S3, the product does what it says it
does, and everything remaining is depth.
