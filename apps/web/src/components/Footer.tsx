/**
 * D9's one constraint, and it is small. This app asks visitors to paste records
 * into their own DNS; a public page that does that without saying who is asking
 * is phishing-shaped regardless of intent. So it says what it is, permanently
 * and quietly.
 */
export function Footer() {
  return (
    <footer className="footer">
      Deed is an independent study in domain-ownership verification. It only ever reads
      your DNS; it never writes to it.
    </footer>
  )
}
