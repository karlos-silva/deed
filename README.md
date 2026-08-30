# Deed

> Prove you own a domain. Understand what is happening while you wait.
> Recover when it breaks.

An independent study in domain-ownership verification. The app says what it is
in its own footer, because a page that asks strangers to paste records into their
DNS has no business being ambiguous about who it is (D9).

**Deployed at:** <https://domains.karlos.dev>

---

## What it is

Proving you control a domain is a primitive, not a feature of email. The same
proof gates TLS issuance, SSO domain claiming, custom domains on a CDN, and
search-console access. It is also the first thing a new customer is asked to do,
and the first place they get stuck — because the product goes silent at exactly
the moment the user is least able to help themselves.

This builds the primitive, and spends the whole budget on the part that usually
gets a spinner.

You claim a domain and get one TXT record:

```
_deed-challenge.example.com.  TXT  "deed-challenge=<52 chars of base32>"
```

Then the product reads it back from three independent resolvers and tells you
what it found — not *pending*, but which resolver has it, what TTL it reported,
and, when the value is wrong, which provider quirk mangled it and whether
waiting will help. It keeps reading it afterwards, because DNS is mutable and
verification decays.

## The model, in a paragraph

A domain has one lifecycle — its ownership claim — and beneath it the DNS record
carrying the proof has a lifecycle of its own. The claim's state is derived from
the record's; the record's is derived from what resolvers answered, through a
precedence table where **a wrong value at one resolver outranks a correct
majority**. That ordering is the product's whole thesis made mechanical: the
moment there is evidence that waiting will not help, the clock stops. Symmetric
rules would let a correct-but-stale majority mask a value the user just broke.
Verification needs quorum; *keeping* it does not, so a single cache eviction
cannot flap a domain between states. And absence of evidence is never evidence
of absence: if our own lookup failed, nothing is concluded and no clock advances
— which is what stops an outage on our side from revoking working domains.

The full specification is [`docs/state-model.md`](docs/state-model.md). It is
normative: `packages/core` implements it, and where the two disagree the spec
wins.

## Trying it without a domain

Anything ending in **`.test`** runs against a simulated zone that you edit
yourself, from inside the app. `.test` is reserved by RFC 2606 and can never
resolve in real DNS, so a simulated verification can never be mistaken for a
real one.

The simulated zone is not a demo mode. It implements the same `DnsPort` the real
resolvers do, so it drives the same engine, the same reducer and the same audit
log — and each simulated resolver adopts a change after its own delay
(25s / 55s / 95s), so propagation, staleness and receding records are real
rather than staged.

Claim `acme.test`, then use the zone editor to reproduce any row of the failure
taxonomy: publish the value with quotes around it, append the zone name, delete
the record, add a wildcard, put a CNAME at the host, or make the whole zone
SERVFAIL. Each produces its own named diagnosis.

## Running it

```bash
pnpm install
pnpm --filter @deed/web dev
```

You need `apps/web/.env.local`; [`apps/web/.env.example`](apps/web/.env.example)
lists the four variables and which of them are secret.

```bash
pnpm test          # every package
pnpm scenarios     # every scenario in the delivery plan has a test of that name
pnpm lint
pnpm typecheck
```

Two scripts refresh vendored data, and both commit their output so the diff is
readable:

```bash
node scripts/capture-doh-fixtures.mjs        # real resolver responses, for the contract suite
node scripts/capture-public-suffix-list.mjs  # the Public Suffix List
```

## How it is put together

```
apps/web          Next.js (App Router) — UI and route handlers
packages/core     state machine, diagnosis, diff, name parsing — zero I/O
packages/dns      the DnsResolver port; DoH and sandbox adapters
packages/db       Supabase clients, schema types, migrations
packages/ui       the design system — tokens, components, motion
```

**`packages/core` has no I/O, and that is enforced rather than asserted.** ESLint
forbids `node:*`, `fetch`, `process` and the browser globals inside it, and bans
`Date.now()` outright — `now` arrives as a parameter, which is what lets a
seven-day grace window be tested in microseconds.

**Adding a variant to `RecordState` breaks the build at every site that switches
over it.** That is the entire reason these are discriminated unions rather than
string enums, and there is a test that grafts an extra variant onto a copy of
the source and asserts `tsc` refuses it.

**Two invariants live in Postgres, because a pure function cannot hold them.**
"At most one live claim per name" is a partial unique index; "transitions for one
domain are serialized" is `apply_transition()`, which takes a per-domain lock,
commits the state change with its audit events in one transaction, and refuses a
writer whose read is stale.

## What is deliberately not here

Email sending setup — DKIM, SPF, a return-path MX — is the obvious next thing to
build, and it is out of scope. Ownership is the whole problem; sending
configuration is *configuration*, not *proof*, and a domain does not stop being
yours when your SPF is wrong. A second record set would flow through the same
record lifecycle, the same resolver matrix and the same diagnosis engine without
adding one new idea. The effort went into pre-flight diagnosis, the resolver
matrix, rotation, degradation and the audit log instead.

The seam is real and specified: the state machine is parameterised over the
record set, so a capability would be a new record spec fed to existing
machinery. What is out of scope is building a second one, not being able to.

Also out: registrar API integration (it would remove the very failure modes this
product exists to handle), teams and billing, DMARC/BIMI advisory, and bulk
import. The reasoning for each is in [`docs/prd.md`](docs/prd.md) §5.

## Honest limits

- **Supabase pauses free projects after about a week of low activity.** The
  sweep writes a real row every run to keep the database genuinely active, but
  this is an accepted free-tier constraint, not a solved problem. If the link
  looks dead, that is probably why.
- **DoH cannot query a specific authoritative nameserver,** so the matrix shows
  three independent recursive caches rather than an authoritative row.
- **The third resolver is AdGuard's unfiltered endpoint, not Quad9.** Quad9
  requires HTTP/2, which Node's `fetch` does not speak. The reasoning, and why
  the *unfiltered* endpoint specifically, is [D15](docs/decisions.md).
- **One Playwright smoke test, no wide end-to-end suite.** What is deliberately
  not tested, and why, is [D12](docs/decisions.md).

## Deploying

The app is a Next.js project inside a pnpm workspace, so the Vercel project's
**root directory must be `apps/web`**.

**Environment variables** are listed in
[`apps/web/.env.example`](apps/web/.env.example). `SUPABASE_SECRET_KEY` is the
Supabase project's secret API key and must never carry a `NEXT_PUBLIC_` prefix —
a post-build scan fails the build if it ever reaches a client chunk.

`GET /api/health` reports which of them are present — never a value — and
whether Postgres answers. `NEXT_PUBLIC_*` variables are inlined at build time,
so setting one after a deploy does nothing until you redeploy; that is the
failure this endpoint exists to name out loud.

**The custom domain.** Add `domains.karlos.dev` to the Vercel project, then
create the record Vercel asks for — normally:

```
domains.karlos.dev.   CNAME   300   cname.vercel-dns.com.
```

Add it **where the zone actually lives**, which is not always where the domain
was bought. `karlos.dev` is registered through Squarespace but its authoritative
nameservers are Google Cloud DNS:

```
$ dig +short NS karlos.dev
ns-cloud-d1.googledomains.com.   ns-cloud-d2.googledomains.com.
ns-cloud-d3.googledomains.com.   ns-cloud-d4.googledomains.com.
```

A record added in the registrar's panel while a different provider is
authoritative simply never resolves — which is, more or less, the class of
failure this whole product exists to make legible.

**Sign-in** takes two callback URLs, and they are not the same one:

| Where | Value |
| --- | --- |
| GitHub OAuth app → *Authorization callback URL* | `https://<ref>.supabase.co/auth/v1/callback` |
| Google OAuth client → *Authorised redirect URI* | `https://<ref>.supabase.co/auth/v1/callback` |
| Supabase → Authentication → URL Configuration → *Site URL* | `https://domains.karlos.dev` |
| Supabase → *Redirect URLs* | `https://domains.karlos.dev/auth/callback` |

The providers redirect to **Supabase**, and Supabase redirects to **the app**.
Pointing the provider at the app directly is the usual first mistake.

Two more things on the Google side, both of which a visitor hits before they
see a single screen of the product:

- **Set an app name** under *APIs & Services → Branding*. Without one, Google's
  consent screen falls back to the redirect URI's host and asks the visitor to
  sign in to `<ref>.supabase.co` — an unidentifiable string, on the first screen
  of a product whose entire subject is proving identity (D9).
- **Publish the consent screen to Production.** While it is in *Testing*, only
  addresses added as test users can sign in and everyone else is blocked. The
  scopes here are `email` and `profile`, which are not sensitive, so publishing
  needs no review from Google.

**The sweep.** Store the shared secret in Supabase Vault, using the same value
set as `SWEEP_SECRET` in the deployment:

```sql
select vault.create_secret('<the secret>', 'sweep_secret',
                           'Bearer token pg_cron presents to /api/sweep');
```

Then apply
[`packages/db/migrations/0003_sweep_schedule.sql`](packages/db/migrations/0003_sweep_schedule.sql).
It reads the secret from Vault rather than carrying it inline, because
`cron.job.command` is plain text readable by anyone with database access — a
secret pasted into a scheduled job is a secret published to every future reader
of that table. This is what makes verification keep happening while nobody is
watching (D5).

**Proving the real path.** The sandbox covers every failure state, but only a
real zone proves the real one. Claim `demo.karlos.dev` in the app and publish
the TXT record it gives you in Google Cloud DNS — same engine, same matrix, real
resolvers.

## The documents

Four, each with one job, in this order:

| Document | Answers |
| --- | --- |
| [prd.md](docs/prd.md) | What is this, for whom, and why does it matter? |
| [state-model.md](docs/state-model.md) | What states exist, and what moves between them? |
| [delivery-plan.md](docs/delivery-plan.md) | What gets built, in what order, and how do we know it works? |
| [decisions.md](docs/decisions.md) | Why is it this way and not the obvious alternative? |

Acceptance criteria are `WHEN` / `THEN` scenarios. Every `####` heading in the
delivery plan has a test of the same name, and `pnpm scenarios` fails if one
does not — the cheapest guardrail here, and the one that keeps specs from
quietly becoming fiction.
