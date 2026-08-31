# Decision log

Each entry: the decision, the alternatives, and why. Reversal cost noted where
it matters. Entries are append-only; supersede rather than edit.

---

## D1 — Identity: social login (GitHub / Google) up front

**Decided.** Supabase Auth with GitHub and Google OAuth. Sign in before claiming
anything. No anonymous tier.

**Superseded.** An earlier draft made anonymous sign-in the default with
`linkIdentity()` as an upgrade. Rejected in favour of the simpler model.

**Why this is the better call, not just the simpler one.**

- **It deletes the worst edge case in the design.** Anonymous-then-link forces an
  account-merge question with no good answer: an anonymous user holding three
  claims links a Google account that already holds claims on two of the same
  domains. Which claim survives? Which token stays valid? Who owns the audit
  history? None of that exists now.
- **RLS collapses to one predicate.** `auth.uid() = owner_id`, with no
  `is_anonymous` branching — and no risk of the classic mistake where anonymous
  users inherit the `authenticated` role and a naive policy hands them
  everything.
- **The ownership claim means more.** "This domain belongs to `github:octocat`"
  is a stronger statement than "belongs to session 4f3a", and this product's
  entire subject is the strength of ownership claims.

**Cost, accepted.** A visitor must grant OAuth to see anything. No landing
page: the entry point is a sign-in screen — the mark, the product name, GitHub
and Google. Explaining the product to logged-out visitors is not this project's
job.

The README carries the walkthrough instead, with captured screens of every state.
That is not a workaround for the auth wall — documentation has to stand on its
own, and the README would need to do this regardless of how sign-in worked.

**Caps and abuse.** One tier: 25 domains per account. OAuth removes anonymous
sign-in abuse but not throwaway-account abuse, so per-user and per-domain rate
limits on DNS lookups stay exactly as specified.

## D2 — DNS: real by default, simulated under a reserved suffix

**Decided.** Real multi-resolver lookups against real domains. Domains ending in
a reserved sandbox suffix are routed to a simulated zone that the user edits
directly, driving the same verification engine.

**Alternatives.** (a) Real only — a visitor without a domain at hand cannot
reach any failure state, which is precisely what the product exists to show.
(b) Simulated only — "prove domain ownership" becomes theatre.

**Why this wins.** The engine cannot tell the difference. Both paths implement
one `DnsResolver` port, so the sandbox exercises the production code path rather
than a parallel demo mode. Every row of the failure taxonomy becomes reachable
on demand, and real domains still get a real proof.

**Consequences.** The sandbox suffix must be visibly labelled in the UI. A
sandbox domain must never be presentable as a real verified domain. The
simulated zone editor is product surface with its own acceptance (S3, S5) —
it is the visitor's primary instrument, not a hidden debug tool.

---

## D3 — One proof; capabilities are out of scope

**Decided.** A single TXT ownership token is the entire product. Email sending
setup is not built.

**Superseded.** An earlier draft split the work into two phases — ownership,
then DKIM/SPF/MX. Dropped: the second phase reused the first phase's record
lifecycle, resolver matrix, and diagnosis engine without introducing one new
idea, and its aggregate state machine was structurally the record lifecycle a
second time.

**Why this is stronger, not merely smaller.** The problem is one thing: claim
and prove domain ownership. Proving control of a domain is a primitive shared by
TLS issuance, SSO claiming, CDN custom domains and search consoles — email is
one consumer of it, not its purpose. Scoping to the primitive is a sharper
thesis than rebuilding any one product's domain screen, and scope is where
judgement shows first.

**Accepted losses, named so this stays a decision.**

- `region_mismatch` disappears from the taxonomy — it was AWS-and-email specific.
- The >255-byte multi-string TXT case is no longer reachable in the product; a
  32-byte token never gets there. The join stays implemented and tested, because
  the resolver layer is a general TXT reader and getting it wrong would fail
  silently.
- The propagation view becomes one record across N resolvers rather than a
  records × resolvers grid. Per-resolver TTL, last-seen and direction carry it.

**Reversal cost.** Low, by construction: the state machine is parameterised over
the record set, so a capability is a new record spec, not a new lifecycle.

## D4 — DNS transport: DNS-over-HTTPS, multi-resolver

**Decided.** Query Cloudflare, Google, and Quad9 over their DoH JSON endpoints.
Independent resolvers with independent caches.

**Alternatives.** `node:dns` with `resolver.setServers()` over UDP/53 — the
obvious choice locally, and a liability on serverless where outbound UDP is not
contractually guaranteed. DoH is plain HTTPS and works on any runtime.

**Why this is better than a workaround.** The propagation matrix stops being a
simulation. Different resolvers genuinely hold different cache states, so the
matrix in the UI reports observed reality rather than a modelled delay curve.

**Known limitation.** DoH cannot query a specific authoritative nameserver, so
the prototype's "authoritative" row has no direct equivalent. Treated as an
optional enhancement via `node:dns` on the Node runtime, degrading gracefully if
the network blocks it — never a hard dependency.

**Verified in S0, with a named fallback.** The walking skeleton queries all
three JSON endpoints on day one. If any of them turns out not to serve a
usable JSON API, the port absorbs the change — RFC 8484 wireformat against the
same resolver, or an independent replacement (OpenDNS, AdGuard) — without the
engine noticing.

---

## D5 — Background re-checks: Postgres cron, not Vercel cron

**Decided.** Three mechanisms, in order of importance:

1. **Lazy revalidation on read** — loading a domain whose last check is stale
   triggers a fresh check. Covers all interactive use.
2. **`pg_cron` + `pg_net` in Supabase** — a minute-granularity sweep that
   re-checks every claim due under the cadence table (state-model §5) —
   pending claims awaiting propagation, verified domains, degraded ones —
   and drives the time-based transitions.
3. **Explicit "Check now"** — rate-limited, always honest about what it found.

**Why not Vercel Cron.** On the Hobby plan cron jobs fire roughly once per day.
The product promises to keep watching while the user is away, and a daily sweep
cannot honour a grace window measured in hours.

**Verified.** Supabase Cron is `pg_cron`, exposed in the dashboard and via SQL,
and is not plan-gated. It accepts standard cron syntax and sub-minute intervals
(`'30 seconds'`) on Postgres 15.1.1.61+. Jobs invoke an Edge Function through
`net.http_post` from `pg_net`. A `*/1 * * * *` sweep is well within the free tier.

```sql
select cron.schedule('recheck-sweep', '*/1 * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/recheck',
    headers := jsonb_build_object('Content-Type','application/json','apikey','<key>'),
    timeout_milliseconds := 5000
  );
$$);
```

**Residual risk — free-plan pausing.** Supabase pauses free projects after a
7-day window of low *user* database activity. Whether `pg_cron`'s own traffic
counts as user activity is not stated in the docs, so we do not rely on it. Two
mitigations, in order: keep the sweep writing to a real table (so it produces
genuine queries), and treat a paused project as a documented operating limit of
the free tier rather than a bug. Harmless while someone is using the app; noted
so nobody is surprised in a month.

**Housekeeping.** `cron.job_run_details` is never cleaned up automatically. A
minute-granularity job accumulates rows indefinitely, so the schedule includes a
retention delete.

**Consequence.** Verification freshness is a first-class, user-visible field. A
product that claims continuous verification must show when it last actually
looked.

---

## D6 — Claim exclusivity: pending is open, verified is exclusive

**Decided.** Many users may hold a pending claim on the same domain
simultaneously. Verification grants exclusivity and invalidates competing pending
claims with an explicit explanation. Revocation returns the domain to the pool.

**Why.** If claiming reserved a domain, squatting it would cost one click and
deny it to its rightful owner indefinitely. Making the *proof* exclusive rather
than the *attempt* puts the cost on the party who must actually control the DNS.

**Caps.** 25 domains per account (D1). Per-domain and per-user rate limits on
lookups, independent of the cap.

---

## D7 — Monorepo with a pure domain core

**Decided.** pnpm workspaces + Turborepo.

```
apps/web          Next.js (App Router) — UI and route handlers
packages/core     state machine, diagnosis, diff, record specs — zero I/O
packages/dns      DnsResolver port; DoH and sandbox adapters
packages/db       Supabase client, generated types, migrations
packages/ui       design system — tokens, components, motion
```

**Why the core is separate and pure.** State modelling and type safety are what
this project exists to get right. A module with no I/O, exhaustive discriminated
unions, and fast unit tests demonstrates both far better than logic scattered
through React components. It also means the sandbox and production paths cannot
diverge.

---

## D8 — Reuse the prototype's engine, not its framing

**Decided.** Port the parts that are genuinely good: the LCS character-level
diff, mid-string truncation, the per-record status set
(`absent | propagating | mismatch | verified`), the rule that `mismatch` never
enters a propagation grace window, and the pre-flight check panel.

**Dropped.** The "emails at risk" volume meter. It fabricates a number we do not
have — we do not send mail. Consequences are stated as capabilities lost.
Inventing stakes to create urgency is a dark pattern, and a product whose
subject is trust cannot afford one.

---

## D9 — A quiet visual language, and an app that says who it is

**Decided.** A dark, strictly neutral interface: layers separated by borders
rather than fills or shadows, one colour per state, Inter for UI and Geist for
display. It is the vocabulary of developer tools, which is who this is for. Ship
it publicly.

**The one constraint, and it is small.** This app asks visitors to paste records
into their own DNS. A public page that does that without saying who is asking is
phishing-shaped regardless of intent — a stranger arriving cold cannot tell it
from a provider's real verification screen. So the app carries a permanent,
quiet line stating what it is: an independent study that only ever reads your
DNS. One line in the footer and an honest `<title>`. Nothing else changes.

**Why this earns its line.** A product whose entire subject is proving identity,
and which is itself unambiguous about its own identity, demonstrates the
principle instead of merely claiming it in a doc.

**Documentation** stays in English throughout — README, specs, comments, UI copy.

---

## D10 — Everything runs on free tiers; one operating risk

**Cost: zero.** Every component has a free tier that comfortably covers a
study project.

| Component | Plan | Relevant limit |
| --- | --- | --- |
| Vercel | Hobby | 100 GB bandwidth; non-commercial use only |
| Supabase | Free | 500 MB DB, 50k MAU, 2 projects per org |
| DoH resolvers | public | Cloudflare / Google / Quad9, no key, fair use |
| GitHub + Google OAuth | free | — |
| `pg_cron` + `pg_net` | included | not plan-gated (D5) |

No email is sent (PRD §5), so there is no email-provider spend either.

**The sandbox suffix costs nothing and must not be a real domain.** Use `.test`,
reserved by RFC 2606 for exactly this purpose — `acme.test`, `updates.acme.test`.
It can never resolve in real DNS, which makes it impossible to confuse a
simulated verification with a real one. Buying a domain for the sandbox would be
both a cost and a correctness hazard. Sandbox domains count toward the
25-domain cap and the same rate limits — one abuse model, no carve-outs.

**The one real risk: free-plan pausing.** Supabase pauses free projects after a
7-day window of low activity (D5). For most products that is a footnote. For a
project that lives on a shared link it is the failure that matters most: someone
opening the link three weeks later finds a dead app, and that reads as "it
doesn't work" rather than "the database was asleep."

Mitigations, in order of effort:

1. Confirm the deployed link is live immediately before sharing it, and again if
   it has sat for a while.
2. An external uptime pinger on a health endpoint that performs a real `select`.
   Hitting a static page does not generate database activity; the check must
   touch Postgres to count.
3. Note the limitation in the README. Honesty about an accepted free-tier
   constraint costs nothing; a silently dead link costs the first impression.

**Optional, not required: a real domain to test against.** The sandbox exercises
every failure path, but proving the real-DNS path end to end means controlling a
real zone. Any domain already owned works — the verification record sits on a
subdomain and touches nothing else.

---

## D11 — OpenSpec's scenario format, without OpenSpec

**Decided.** Acceptance criteria are written as `WHEN` / `THEN` scenarios, the
format OpenSpec uses for its requirement documents. The tool is not installed and
no `openspec/` directory exists.

**Why the format.** A scenario is a test name. "Waiting will not help" still has
to be translated into an assertion, and precision is lost in the translation;
"WHEN the record is mismatch, THEN no countdown is shown" is already the test.

**Why not the tool.** Its value is the `propose → apply → archive → specs
updated` loop, which keeps specs true across many changes over months. This is a
greenfield build of nine slices in one push — that loop would run approximately
zero times, and we would pay for the structure anyway.

Two further costs specific to this project: the `SHALL` requirement format
flattens the reasoning that makes these documents worth reading — the state
model's value is in sentences like *"rule 2 outranks rules 3–4 deliberately,
because ranking `verified` higher would let a correct-but-stale majority mask a
value the user just broke"* — and a repository foregrounding process artefacts
competes for attention with the product, in a project whose first stated
requirement is a deployed, accessible application.

**Revisit if** this outlives its first push and starts accumulating changes
over time. Then the loop earns its keep, and the existing documents port into
it without rewriting.

---

## D12 — What we deliberately do not test

**Decided.** Four things are left out on purpose. Naming them keeps them
decisions rather than gaps someone finds later.

- **Broad end-to-end suites.** One Playwright test covers sign-in → claim →
  verify against the sandbox. Everything else is faster and more precise a layer
  down. Wide browser suites are slow to write, slower to maintain, and flaky in
  exactly the ways that erode trust in a suite.
- **Coverage targets.** Coverage counts lines executed, not properties held. The
  559-case precedence enumeration and the invariant properties are the real
  target, and a percentage would be a worse proxy for the same claim.
- **Mutation testing.** It would probably find real gaps in the core. It also
  costs more setup and runtime than a project this size justifies — first thing
  to add if it keeps growing.
- **Deep Supabase mocks.** For anything touching RLS, a mock tests the mock.

**Also decided: no separate testing document.** An earlier draft created
`docs/testing.md`. It was deleted one message later: testing is a cross-cutting
concern of every slice, not a domain with its own contract, and the file
immediately duplicated state-model §7. Guardrails now live in the delivery plan's
definition of done, testing specifics live in the slice that owns the behaviour,
and this entry holds the omissions. The rule in `docs/README.md` — a new file
needs a new domain, not new work — applies to us too.

---

## D13 — Name: Deed; the DNS record names its verifier

**Decided.** The product, repo, and deployment are named Deed — `deed` wherever
a name has to be lowercase. The DNS record users publish at their own domains
carries the same name:

```
_deed-challenge.<domain>.  TXT  "deed-challenge=<token>"
```

**Why the name.** A deed is the document that proves you own a piece of land;
this product issues the proof for a piece of the namespace. One syllable, no
collision with anything a zone already holds, and it reads the same in a
headline as it does in a TXT value.

**Why the DNS label carries it.** Two reasons, both trust:

- Verification records conventionally name the *verifier* (`_acme-challenge`,
  `google-site-verification=`). Someone auditing their zone should be able to
  tell who asked for a record without asking around; an anonymous
  `_verify-*` label presents the proof as nobody's, and nobody's records are the
  ones that get copied blindly from one zone to the next.
- Zone audit legibility: months later, `deed-challenge` reads as one product's
  ownership proof and can be removed when that claim is released; a generic
  label reads as load-bearing infrastructure and lingers.

**Also considered.** A self-describing name such as `domain-proof`: better at
saying what it is, worse as an identity, and a mouthful in a TXT label.
Reversal cost: one grep, while nothing is deployed.

---

## D14 — Seven refinements the core needed, and the one gap the table had

**Decided.** `packages/core` implements state-model §2–§6 as written, with six
additions to the type sketches and one resolution of a case the precedence table
does not cover. Recorded here rather than edited into the state model, because
each is a choice with an alternative.

**The gap: mixed total failure.** Rule 6 is "all failed, and the failures are
zone-side"; rule 7 is "all failed, and the failures are ours". Neither matches
one SERVFAIL and two timeouts, which would fall through to rule 8 and render
`absent` — telling the user their record is missing when nothing answered. Total
failure with *any* zone-side error is now `zone_error`. A SERVFAIL is positive
evidence about their zone, and swallowing it sends nobody to fix it; the
conservative reading (concluding nothing) would hide a real outage behind our
own timeouts. It cannot cause a wrong revocation, because `zone_error` only
degrades — and degradation is the owner's time to fix the zone.

**Additions to the types**

- **`Domain.lastChangedAt`.** The cadence table in §5 is keyed on "since last
  state change", and a *record*-level change resets it just as a claim-level one
  does. Neither `ownership` nor `record` carries a timestamp for that.
- **`Domain.nextCheckAt` is nullable.** `expired` and `revoked` are terminal;
  there is nothing left to watch, and a non-null field would have the sweep
  re-checking dead claims forever.
- **`Observation.actor`.** `AuditEvent.actor` has to come from somewhere, and
  `reduce`'s signature is fixed at three parameters. The check knows who asked
  for it; the event it produces inherits that.
- **`AuditEvent.level`.** Invariant 5 is "exactly one audit event per
  transition", and there are two lifecycles. One event per level that actually
  moved keeps the invariant countable — and a `state_changed` with no level
  would be ambiguous in the log the user reads.
- **`RecordState.mismatch.correcting`.** §3 requires the copy to hedge when a
  corrected mistake is still clearing caches. The UI holds no domain rules
  (prd §9), so the comparison against the previous observation happens in the
  core and arrives as data.
- **`mismatch.observed` carries every value, not only the offending ones.**
  The corrected-mistake comparison needs to know the current token is spreading
  while the wrong one recedes, and "show your work" (prd §3) wants what each
  resolver returned regardless of verdict.

**Reversal cost.** Low. Six are additive fields; the seventh is one branch in
`deriveRecord`, covered by its own test.

---

## D15 — The third resolver is AdGuard unfiltered, not Quad9

**Decided.** The resolver trio is Cloudflare, Google, and AdGuard's *unfiltered*
endpoint. Quad9 is out.

**Supersedes** the resolver list in D4, and exercises the fallback D4 named:
*"If any of them turns out not to serve a usable JSON API, the port absorbs the
change — RFC 8484 wireformat against the same resolver, or an independent
replacement (OpenDNS, AdGuard) — without the engine noticing."*

**What we found, in this order.**

1. Quad9's JSON API lives on port 5053, which times out from both a local
   machine and a build environment. Not a usable dependency.
2. Quad9's standard endpoint on 443 speaks RFC 8484 wireformat and answers
   correctly to `curl` — so a wireformat transport was written, and it worked.
3. It then returned **505 HTTP Version Not Supported** to Node's `fetch`. Quad9
   requires HTTP/2, which undici does not speak; `curl` had silently negotiated
   it over ALPN. The transport was correct and the runtime could not use it.

**Why AdGuard, and why unfiltered.** Its `/resolve` JSON endpoint answered all
five captured cases correctly over HTTP/1.1 — including the SERVFAIL that
`dns.sb`, the other candidate, turned into an HTTP 503 we would have had to
misreport as our own failure. The **unfiltered** endpoint specifically: AdGuard's
default resolver blocks domains, and a blocked name would come back `NXDOMAIN`
and read as `absent` — a silently wrong verdict, which is failure #1 on the
delivery plan's list.

**The wireformat transport was deleted.** It worked, it was tested, and no
endpoint used it. Code kept "in case" is a liability, and the port's value was
demonstrated by the swap itself: three files changed, none of them in
`packages/core`.

**Accepted cost.** The three resolvers are no longer the three most famous ones,
and AdGuard is a smaller operator than Quad9. What matters for the propagation
matrix is that the caches are independent, and they are.

**Reversal cost.** One entry in `DOH_ENDPOINTS` and one rename of the
`ResolverId` variant. If Quad9 is wanted back, the wireformat transport is in
this repository's history and the runtime is the only blocker.

---

## D16 — `NEXT_PUBLIC_*` variables are Vercel "Config", never "Secret"

**Decided.** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
are stored as Vercel **Config** variables. `SUPABASE_SECRET_KEY` and
`SWEEP_SECRET` are stored as **Secret**.

**Why this is an entry and not a note.** Marking the two public ones as "Secret"
looks like the cautious choice, and it is the one that took the deployment down
for an hour. Vercel's Secret type withholds a value from the client bundle —
which is exactly what the `NEXT_PUBLIC_` prefix exists to reach. The two cancel:
the dashboard lists the variable as present, the build inlines `undefined`, and
every route dies in middleware with `MIDDLEWARE_INVOCATION_FAILED` and no
further explanation. Nothing in the code was wrong.

**The publishable key is public by design.** It identifies the project; it
authorises nothing. RLS is what protects the data, which is why `0001_schema.sql`
spends a block on policies and why S3 requires a policy that denies *everyone* to
fail its test too. Treating the publishable key as a secret buys no safety and
costs a working deployment.

**What changed in the code, and what deliberately did not.** The middleware can
no longer take the site down: anything it throws becomes a log line and the
request continues unauthenticated. `/api/health` reports which variables the
*build* actually has and whether the URL parses, because presence is not
correctness. What did not change is the guardrail in the other direction — the
post-build scan still fails the build if a secret reaches a client chunk, and it
was verified by planting one.

**The general rule.** Configuration that must reach the browser cannot also be
hidden from it. Any store offering a "secret" flag will happily accept both
instructions and honour the wrong one silently.

---

## D17 — Real Postgres for RLS, without the rest of the Supabase stack

**Decided.** Tests that touch row-level security run against a real Postgres in
Docker, seeded with the three Supabase primitives our policies depend on: the
`anon` / `authenticated` / `service_role` roles, `auth.uid()`, and the
`request.jwt.claims` setting. `supabase start` is not used.

**Refines** the delivery plan's tooling line, which named `supabase start`, and
keeps the reasoning behind it: for RLS, a mock tests the mock (D12).

**Why not the full stack.** Policy evaluation depends on those three things and
nothing else. GoTrue, Kong, Realtime, Storage and Studio have no say in whether
a row is visible, and booting nine containers to find that out costs a minute
per run and a working Supabase CLI on every machine. One container starts in
about two seconds from an image most machines already have.

**What this gives up, and the mitigation.** A stub can drift from the real
thing. So `auth.uid()` is reproduced verbatim rather than approximated, the
grants match what Supabase issues, and every assertion in the suite was also run
once by hand against the live project before being written down. The harness is
a faster way to keep running the checks, not the only place they have ever run.

**It paid for itself immediately.** Two defects that only appear with RLS on:

- **The audit index was unreachable.** `(domain_id, at, id)` is exactly the
  index the query looks like it wants, and a real session can never use it: the
  policy predicate on `owner_id` is a security barrier, so the planner enters
  through `owner_id`, filters `domain_id` afterwards, and sorts — scanning an
  account's whole history to render 25 rows. As superuser it plans beautifully.
- **The audit cursor keyed on `id` while ordering by `(at, id)`**, which holds
  only while the two agree. Backfilling a missing event gives an old timestamp a
  new id, and the pages start skipping rows.

Neither is visible to a unit test, a mock, or a query run as the owner of the
database.

---

## D18 — A drawn mark, and the disclaimer moved into the name

**Decided.** The app uses a drawn glyph — a flag planted on a horizon — as its
mark, on the sign-in screen and in the top bar. The disclaimer paragraph is
removed from the sign-in screen.

**Amends D9**, which asked for a footer line and an honest title on the grounds
that a page asking strangers to paste DNS records must not be mistakable for
anyone else's.

**Why the line moves rather than disappears.** D13 already made the argument
without noticing it applied here: the product carries its own name precisely so
that a cold visitor knows who is asking. The sign-in screen now reads **Log in
to Deed** directly beneath the mark — the product's name before anything else,
in type larger than the mark itself. The paragraph underneath was restating in
three lines what the headline already says in one.

**What is deliberately kept.** The honest `<title>`, and the footer line on
every screen inside the app. The claim is not that the disclosure is
unnecessary — it is that the headline carries it better than a paragraph
nobody finishes reading.

**The mark stays small.** A glyph beside a headline naming the product reads as
a signature. A large illustration with no name beside it would read as a landing
page, which D1 ruled out. That distinction is the whole of this entry and it
survives intact.

**Reversal cost.** One component and one paragraph.

### D18a — the mark reverts; the disclaimer decision stands

**Reversed, same day.** The app does not use the drawn glyph. The tile goes back
on the sign-in screen and the top bar keeps its own glyph.

The glyph behind D18 was sound — drawn on the same 1800-unit canvas as the tile
and checked at every size it renders — and it turned out not to be the
interesting question. What the mark cost was attention, on a screen whose job is
to get someone signed in. The tile already says what the product is about: a
flag planted on a horizon, lit the green of a verified claim.

**The second half of D18 is not reversed.** The disclaimer paragraph stays off
the sign-in screen: the headline reads "Log in to Deed", which is D13's argument
that the name carries the trust posture. The honest `<title>` and the in-app
footer stay.

So D9 ends where it began — a quiet interface, and a product that says who it is.

---

## D19 — Deleting a domain removes it from the list, never from the ledger

A domain could be released and then never got out of the way. The `Release`
control lived in the detail page's Recovery card, which is gated on
`activeToken(ownership) !== null`, and `activeToken` returns null the moment a
claim is revoked — so the released row had no control anywhere in the product.
It sat in the list with a `Released` badge forever.

That was not only untidy. `enforce_domain_cap` counted rows, not live claims, so
every closed claim consumed one of the account's 25 slots permanently. Because
`domains_one_claim_per_owner_per_name` is partial and covers only live statuses,
re-claiming a released name inserts a *second* row. Release and re-claim the same
name 25 times and the account is locked out, with no move left that frees a slot.

**Deleting the row is the obvious fix and the wrong one.** `audit_events.domain_id`
is `on delete set null` and `listAudit` finds a claim's history by that id, so a
deleted row puts its history permanently out of reach of the one person it was
kept for — the promise in prd §10 and the delivery plan's own scenario, which
requires that "their audit history for the claim remains readable afterwards".
`lookups.domain_id` cascades, so a delete would also refund the hour's rate-limit
budget the account had already spent. The `domains_owner_delete` policy was live
and unused, which meant any signed-in client holding the publishable key could do
both through PostgREST. It is dropped, so "history survives" is now a property of
the schema rather than a convention.

**So the claim closes exactly as it always did, and only the list changes.**
`hidden_at` is a fact about the owner's list, not about the claim. It lives on
`StoredDomain`, the persistence wrapper, and never on core's `Domain`: the
reducer would only spread it through, and putting a view preference in the model
would push it into every invariant, fixture and construction site in
`packages/core` to buy nothing. A DB `CHECK` makes it legal only on a terminal
claim.

Three consequences worth stating.

**Hiding writes no audit event.** prd §6 scopes the log to every check and every
state transition, and this is neither — `set_hidden` touches no byte of
`ownership`, `record`, `supersession`, `next_check_at` or `version`. The contrast
is `token_rotated`, which also changes no status but does write new proof material
through `apply_transition`. A view preference in an append-only ledger would be a
category error. It also means the two can never race: they write disjoint columns.

**Releasing revokes and unlists in one transaction.** `apply_transition` gained a
`p_hidden_at` parameter rather than gaining a sibling RPC, so it stays the one
write path for a state change (invariant 8). Two round trips can fail between
them, and the state that failure leaves — revoked, still sitting in the list — is
the exact one this whole change removes.

**Only `released_by_owner` unlists itself.** A claim that ended some other way —
`expired`, `grace_expired`, `claimed_by_other` — stays in the list with its badge
and its explanation until its owner dismisses it by hand. The delivery plan is
explicit that a losing account "sees an explanation, not a silently vanished
claim", and auto-hiding those would break it.

Two smaller things fell out. The cap now counts live claims, with a separate
100-row ceiling since nothing is ever deleted. And `reclaimed` — an audit kind
that has been in the union, the `CHECK` and the renderer since S7 with nothing
ever emitting it — is finally written, because with closed claims kept as their
own rows, claiming a name you held before genuinely starts a second history
rather than continuing the first.
