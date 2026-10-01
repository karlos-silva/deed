import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, IBM_Plex_Mono, Instrument_Sans, Instrument_Serif, Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' })

// The signed-in app's own faces (app.css, `.shell`): a serif for the deed's
// title, a grotesque for the interface, and a typewriter mono for the record.
const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
  display: 'swap',
})
const sans = Instrument_Sans({ subsets: ['latin'], variable: '--font-instrument-sans', display: 'swap' })
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Deed — prove you own a domain',
  description:
    'Claim a domain, publish one TXT record, and see exactly what every resolver answers. An independent study in domain verification.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = { themeColor: '#080808', colorScheme: 'dark' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={[inter, geist, geistMono, serif, sans, plexMono].map((font) => font.variable).join(' ')}
    >
      <body
        style={
          {
            '--font-sans': 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
            '--font-display': 'var(--font-geist), var(--font-inter), ui-sans-serif, sans-serif',
            '--font-mono': 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
          } as React.CSSProperties
        }
      >
        {children}
      </body>
    </html>
  )
}
