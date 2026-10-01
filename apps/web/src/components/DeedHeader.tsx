import { Fragment } from 'react'
import type { Domain } from '@deed/core'
import { DomainMeta } from '@/components/DomainMeta'
import { Seal } from '@/components/Seal'

/**
 * The top of a domain's page: the name as the deed's title, the seal stamped
 * beside it, and the particulars underneath with the actions that act on them.
 * Shared with the design gallery, so what is previewed there is this.
 */
export function DeedHeader({
  domain,
  now,
  closed,
  unicode,
  actions,
}: {
  domain: Domain
  now: number
  closed: boolean
  unicode: string | null
  actions: React.ReactNode
}) {
  return (
    <>
      <header className="deed-head">
        <div className="deed-id">
          <p className="eyebrow">
            Deed of claim
            {domain.isSandbox && <span className="badge badge-info">simulated zone</span>}
          </p>
          <h1 className="deed-title" {...(domain.name.length > 22 && { 'data-long': '' })}>
            <DomainName name={domain.name} />
          </h1>
          {unicode !== null && (
            <p className="t-small subtle">
              Displays as <span className="t-mono">{unicode}</span>. Stored and compared as punycode,
              so two names that look alike can never be confused.
            </p>
          )}
        </div>
        <Seal ownership={domain.ownership} />
      </header>

      <div className="deed-band">
        <DomainMeta domain={domain} now={now} closed={closed} />
        <div className="deed-actions">{actions}</div>
      </div>
    </>
  )
}

/**
 * The name with its dots set apart, and a break opportunity before each one, so
 * a long name wraps at a label rather than in the middle of one. The text a
 * reader copies is unchanged.
 */
function DomainName({ name }: { name: string }) {
  return (
    <>
      {name.split('.').map((label, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <>
              <wbr />
              <span className="dot-sep">.</span>
            </>
          )}
          {label}
        </Fragment>
      ))}
    </>
  )
}
