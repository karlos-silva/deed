import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' })

export const metadata: Metadata = {
  // An honest title, per D9: this app is unambiguous about its own identity,
  // which is the property it is built to demonstrate.
  title: 'Deed — prove you own a domain',
  description:
    'Claim a domain, publish one TXT record, and see exactly what every resolver answers. An independent study in domain verification.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = { themeColor: '#080808', colorScheme: 'dark' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${geist.variable} ${geistMono.variable}`}>
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
