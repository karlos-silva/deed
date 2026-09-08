# Deed — Product Requirements

> Prove you own a domain. Understand what is happening while you wait.
> Recover when it breaks.

**Status:** draft · **Owner:** Karlos Silva · **Last updated:** 2026-08-29

The product ships as **Deed**. A deed is the document that proves you own a
piece of land; this issues the proof for a piece of the namespace. The DNS
record users publish at their own domains carries the same name, so a zone
audit can always tell who asked for it (D13).

---

## 1. The problem

Proving you control a domain is a primitive, not a feature of email. The same
proof gates TLS certificate issuance, SSO domain claiming, custom domains on a
CDN, and search-console access. In every one of them the mechanism is identical:
publish a value we generated, at a host we named, and let us read it back.

And in every one of them it is the first thing a new customer is asked to do, and
the first place they get stuck. The user is handed opaque strings, told to paste
them into a control panel they may not own, and then dropped into a screen that
says **Pending** with no further explanation.

The failure is not technical. DNS verification is a solved problem. The failure
is that the product goes silent at exactly the moment the user is least able to
help themselves:

- **They cannot tell "not yet" from "wrong."** Both render as *Pending*. One is
  cured by waiting; the other is never cured by waiting. Conflating them is the
  single most expensive UX mistake in this flow, because it teaches users to
  wait through errors.
- **The mistake is usually the provider's, not theirs.** Cloudflare wraps values
  in quotes. Route 53 appends the zone apex. Some panels silently truncate long
  values. The user pasted correctly and still failed, so "check that you
  copied it right" reads as an accusation.
- **Verification is treated as an event, not a state.** Products verify once and
  assume it holds. DNS is mutable and mostly edited by someone who is not the
  person who set this up — an IT contractor migrating providers, a teammate
  cleaning up "unused" records. Sending silently degrades weeks later.
- **Nothing shows its work.** The user is asked to trust a green badge produced
  by a process they cannot see, cannot re-run, and cannot audit.

## 2. Who this is for

**Primary — the developer setting it up.** Comfortable with DNS as a concept,
not fluent in it. Wants to be unblocked in one sitting. Reads error messages
carefully *if* they are specific.

**Secondary — the person who has to ask someone else.** Does not control DNS.
Needs to forward something a sysadmin can act on without a call, and needs to
see progress without holding the tab open.

**Tertiary — the person debugging it six weeks later.** Did not set it up.
Sending broke. Needs to know what changed, when, and what to do — from the
product, not from a support ticket.

## 3. Principles

1. **Never conflate "not yet" with "wrong."** Every state answers one question:
   *does waiting help?* If the answer is no, say so immediately and stop the
   clock. The prototype already enforces this — `mismatch` never enters a
   propagation grace window.
2. **Diagnose before the user can make the mistake.** We can read their DNS the
   moment they type the domain. Detecting Cloudflare before they paste, and
   warning about the quoting behaviour up front, prevents a failure instead of
   explaining one.
3. **Blame the mechanism, never the user.** "Your provider wrapped the value in
   quotes" is true, actionable, and does not accuse. "Invalid value" is none of
   those.
4. **Show your work.** Which resolvers we asked, when, what each returned, and
   what we concluded. A verdict the user can audit is a verdict they can trust.
5. **Verification decays; the product should say so.** Treat it as a continuously
   re-established fact with an explicit freshness, not a permanent badge.
6. **Consequence over deadline.** "Seven days remaining" motivates nobody. What
   breaks, and when, does.

## 4. The core model: one proof, universally

A single TXT record carrying a high-entropy token scoped to `(user, domain)`.

```
_deed-challenge.example.com.  TXT  "deed-challenge=<token>"
```

One record, one meaning, one failure mode. The token is 32 random bytes,
base32-encoded lowercase without padding — 52 characters, safe in any DNS
panel — and its `deed-challenge=` prefix matches the host label, so the
record reads as one artefact. Fast to satisfy, trivially explained, and the only
thing that grants any authority over a domain in this system.

### What is deliberately not here

Email sending setup — DKIM, SPF, a return-path MX — is the obvious next thing to
build, and it is **out of scope**. So is TLS issuance, and SSO domain claiming.

That is a scope decision, not an oversight:

- **Ownership is the whole job.** The goal is to claim and prove a domain.
  Sending configuration is a different problem — it is *configuration*,
  not *proof*, and a domain does not stop being yours when your SPF is wrong.
- **A second record set would mostly duplicate the first.** DKIM and SPF flow
  through the same record lifecycle, the same resolver matrix, the same
  diagnosis engine. It would add implementation surface without adding a single
  new idea.
- **Depth beats breadth here.** The effort that a second phase would consume goes
  instead into pre-flight diagnosis, the resolver matrix, rotation and
  degradation — the parts that actually distinguish this from a form with a
  spinner.

**The seam is real, and specified.** The state machine is parameterised over the
record set, so a capability is a new record spec fed to existing machinery. What
is out of scope is building a second one, not being able to.

## 5. Scope

### In

- Claim a domain; generate a scoped ownership token.
- Pre-flight diagnosis of the domain before any record is pasted (NS detection,
  provider identification, wildcard detection, CNAME-at-host detection).
- Provider-aware instructions — Cloudflare's field names when the domain is on
  Cloudflare, not generic ones.
- Multi-resolver verification with a per-resolver propagation matrix.
- Character-level diff between expected and observed values.
- A diagnosis taxonomy that names the *cause*, not the symptom.
- Continuous re-verification with a visible freshness timestamp.
- Degradation and revocation when a previously verified record disappears.
- Token rotation as a first-class recovery action.
- An append-only ledger of every check and every state transition — recorded,
  owner-scoped, and never rendered (D20).
- A sandbox suffix (`.test`) where a visitor with no domain can drive real
  failures by editing a simulated zone directly.

### Out

- Email sending setup, and every other capability ownership could unlock (§4).
- Registrar API integration / one-click record creation. Impressive, but it
  removes the very failure modes this product exists to handle.
- Teams, roles, invitations, billing.
- DMARC/BIMI advisory. Adjacent, and would dilute the ownership story.
- Bulk import of many domains.
- A user-visible history. Cut after it shipped (D20): on a live claim every line
  in it repeated the badge, the freshness field or the resolver matrix, and the
  routine checks it existed to show were noise. The ledger underneath stays.

## 6. The experience, moment by moment

0. **Sign in.** One screen, no marketing: the mark, the product name, and two
   buttons — GitHub and Google. Nothing to read, nothing to scroll, no landing
   page. The mark is a 740px tile drawn for this project — a flag planted on a
   horizon lit the green of a verified claim. It is RGB with its near-black face
   baked in and no alpha, so it only sits correctly on the app's near-black
   canvas — which is where it lives.
1. **Claim.** One field. Accepts a pasted URL, a trailing dot, uppercase, or an
   IDN, and normalises silently. Pre-flight runs as they type — debounced to
   pauses on a plausible name, never per keystroke (state-model §5) — so the
   provider-specific warnings are on screen before the token is issued.
2. **Instruct.** The single TXT record, with copy buttons for host and value
   separately (most panels have two fields), and instructions written for their
   detected provider. Plainly stated: we only make read queries against your DNS.
3. **Wait.** Not a spinner. A resolver matrix filling in, an honest "typical
   time for your provider" derived from the observed TTL, and a page that is
   safe to close because we keep checking without it.
4. **Diagnose.** When a value is present but wrong, the wait stops immediately.
   Named cause, character-level diff, and the specific correction.
5. **Prove.** The one celebratory moment in the flow. Ownership established, and
   the domain moves to a watched, continuously re-verified state.
6. **Hold.** Freshness is visible. If a record vanishes, the product explains
   what is now at risk, what the grace window is, and what to do — before
   anything is actually revoked.

## 7. Failure taxonomy

Every diagnosis must answer *does waiting help?* and *what exactly do I do?*

| Cause | Waiting helps | Message leads with |
| --- | --- | --- |
| `not_found` | yes | how long it usually takes at their provider |
| `partially_propagated` | yes | which resolvers already see it |
| `quoted_value` | **no** | the provider added quotes |
| `appended_apex` | **no** | the provider appended the zone name |
| `whitespace` | **no** | an invisible character survived the paste |
| `truncated` | **no** | the panel has a length limit; how to split |
| `wrong_token` | **no** | this token belongs to a different claim |
| `stale_token` | **yes** | a rotated value is still cached; it will clear |
| `wildcard_shadow` | **no** | the record is missing; a wildcard answers in its place |
| `cname_at_host` | **no** | a CNAME here prevents the TXT from resolving |
| `domain_unregistered` | **no** | the domain itself does not resolve — is it registered? |
| `unknown_value` | **no** | the value is wrong and no known quirk explains it; here is the diff |
| `servfail` / `dnssec` | maybe | the zone is failing to answer, not us |

Two are worth calling out because they produce **silently wrong verdicts** if
unhandled: a wildcard TXT record makes a missing record look present —
mishandle it one way and the user gets a baffling diff against an unrelated
value; mishandle it the other and every zone with a legitimate wildcard
(`* IN TXT "v=spf1 -all"` is a recommended anti-spoofing practice) fails
forever — and long TXT values are transmitted as multiple 255-byte strings
that must be concatenated before comparison. Both are in scope; how the
wildcard is disarmed without vetoing honest zones is state-model §3.

## 8. Trust and safety

Trust is the product here, so these are positions, not features:

- **Pending claims are never exclusive.** Any number of users may attempt the
  same domain. If claiming reserved it, anyone could squat `stripe.com` and deny
  it to its owner forever. Only *verification* grants exclusivity.
- **Verification is exclusive, and reversible.** One verified holder at a time.
  If the record disappears and the grace window expires, the claim is revoked and
  the domain returns to the pool — because domains genuinely change hands.
- **Tokens are scoped, single-purpose, and rotatable.** A token proves one user's
  claim to one domain. Rotation is offered as a recovery action, and it
  immediately invalidates the previous token.
- **Public Suffix List enforcement.** No claims on `com`, `co.uk`, `github.io`.
  Verifying a public suffix would be a catastrophic authority grant.
- **Exclusivity is per exact name.** `acme.com` and `updates.acme.com` are
  independent claims: verifying the apex grants nothing at its subdomains, and
  vice versa. The proof is control of a name, not a tree.
- **IDNs display as punycode first.** Names are stored as punycode and shown
  with the Unicode form alongside where it differs — never Unicode alone. A
  product about proving identity does not let `аcme.com` read as `acme.com`.
- **The lookup endpoint takes user input and must be hardened.** DNS reads only —
  never an HTTP fetch to the user's domain. Reject IP literals, reserved and
  internal TLDs, and malformed labels — `.test` is the single reserved-suffix
  exception, and it routes to the sandbox (D2), never to real DNS. Rate limit
  per user and per domain (values in state-model §5).
- **Claims are bound to a real identity.** Sign-in is GitHub or Google (D1), so
  every claim traces to an account, not a browser session. Accounts are capped at
  25 domains, and lookups are rate limited per user and per domain — OAuth stops
  anonymous abuse, not throwaway-account abuse.
- **We do not present ourselves as anyone else.** The deployed app carries its
  own name and says what it is: an independent study that only ever reads your
  DNS. A page that asks strangers to paste records into their zone and is vague
  about who is asking is phishing-shaped, whatever the intent.
- **No fabricated stakes.** The prototype shows an "emails at risk" volume. We
  do not send email and have no such number, so we state consequences in terms
  of capabilities lost, not invented traffic.

## 9. Success criteria

What success looks like, one line per quality this project set out to show:

- **Product thinking** — treating ownership as a universal primitive rather than
  an email feature, and pending claims as non-exclusive, are each defensible in
  one sentence.
- **UX quality** — no state is a spinner; every wait shows what is being waited on.
- **Technical communication** — a user who has never edited a DNS zone finishes
  the flow and can explain what they just did.
- **Trust and safety** — §8 positions are implemented, not merely documented.
- **Error handling** — every row in §7 is reachable in the sandbox and produces a
  distinct, correct, non-accusatory message.
- **State modelling** — the state machine is a typed, pure, exhaustively tested
  module with no I/O.
- **Code quality** — verification logic is a pure core with resolvers behind a
  port; the UI holds no domain rules.
- **Full-stack approach** — one seam end to end: the same pure engine serves
  the UI, the route handlers, the background sweep, and the sandbox (D7).
- **Thoughtful tradeoffs** — every cut is a decision with its cost named
  (D3, D8, D12); out-of-scope is a list of reasons, not omissions.
- **Documentation** — a reader can understand the model without running the app.
- **Overall polish** — S8 exists solely for it: keyboard, reduced motion,
  empty/error states, 375px, and a footer that says what this is.

## 10. Resolved questions

Two questions were open in earlier drafts; both are now decided.

1. **A revoked claim's audit history stays visible to its former holder.**
   *Superseded by D20:* there is no history screen any more, for a live claim or
   a closed one. What survives is the part that was load-bearing — the ledger is
   never deleted and never crosses accounts, which is a property of the schema
   (D19), not of a page.
2. **Re-claiming always issues a fresh token.** Reusing the old one would be
   kinder to a user who accidentally deleted a domain, but it would keep a
   token alive after its claim died — and a token that outlives its claim is
   exactly what rotation exists to prevent (delivery plan S7).
