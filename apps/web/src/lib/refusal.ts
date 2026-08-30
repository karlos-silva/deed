import type { ClaimRefusal } from '@deed/core'

export function refusalMessage(refusal: ClaimRefusal, input: string): string {
  switch (refusal.reason) {
    case 'empty':
      return 'Enter a domain to claim.'

    case 'public_suffix':
      return refusal.suffix === 'test'
        ? '“test” is the sandbox suffix itself. Claim something under it, like acme.test.'
        : `“${refusal.suffix}” is a public suffix — the part of the name a registry hands out, not a domain anybody owns. Claim a name under it instead, like acme.${refusal.suffix}.`

    case 'not_a_public_domain':
      switch (refusal.detail) {
        case 'ip_literal':
          return 'That is an IP address, not a domain name. Proof of ownership is a DNS record, so it needs a name.'
        case 'localhost':
          return '“localhost” is not a public domain — there is no zone to publish a record in.'
        case 'reserved_tld':
          return 'That top-level domain is reserved and never resolves publicly. To try the product without owning a domain, use anything ending in .test — it runs against a simulated zone you edit yourself.'
      }
      break

    case 'too_long':
      return refusal.detail === 'label'
        ? `One part of the name is longer than the 63 bytes DNS allows: “${refusal.offending.slice(0, 24)}…”.`
        : 'The whole name is longer than the 253 bytes DNS allows.'

    case 'malformed':
      switch (refusal.detail) {
        case 'no_dot':
          return 'A domain needs at least two parts, like acme.com.'
        case 'empty_label':
          return 'There is an empty part in the name — usually two dots in a row, or a leading dot.'
        case 'bad_characters':
          return 'A domain can only hold letters, digits and hyphens between its dots, and no part may start or end with a hyphen.'
        case 'unparseable':
          return `“${input.slice(0, 60)}” could not be read as a domain or a URL.`
      }
  }
  return 'That does not look like a domain we can claim.'
}
