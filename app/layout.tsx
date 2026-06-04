import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import { ClientProvider } from '@/components/ClientProvider'

const inter = Inter({ 
  subsets: ["latin"],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'RIVANT - Business Visibility System',
  description: 'Nothing Stays Hidden. RIVANT provides real-time business analytics, anomaly detection, and operational visibility.',
}

export const viewport: Viewport = {
  themeColor: '#0A0A0A',
  width: 'device-width',
  initialScale: 1,
  userScalable: true,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased bg-black`}>
        <ClientProvider>
          {children}
        </ClientProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}