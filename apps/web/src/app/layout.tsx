import type { Metadata } from 'next'
import { Fraunces, JetBrains_Mono, Newsreader } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  axes: ['SOFT', 'opsz'],
  display: 'swap',
})

const newsreader = Newsreader({
  subsets: ['latin'],
  variable: '--font-newsreader',
  display: 'swap',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
})

export const metadata: Metadata = {
  title: '1Scratch — Infinite-canvas LLM workspace',
  description:
    'Spread your prompts across an infinite canvas. Bring your own keys. Talk to every major model from one workspace.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${fraunces.variable} ${newsreader.variable} ${jetbrains.variable}`}
      >
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}
