import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ClientProvider } from '@/components/ClientProvider'
import { CookieConsentBanner } from '@/components/cookie-consent-banner'

const inter = Inter({ 
  subsets: ["latin"],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'RIVANT - Business Visibility System',
  description: 'Nothing Stays Hidden. RIVANT provides real-time business analytics, anomaly detection, and operational visibility.',
  // FIX: /icon.png (634x393, не квадратная) браузер сжимал в квадрат
  // фавиконки неравномерно по X и Y — отсюда "раздавленная" картинка во
  // вкладке. Сделали набор честных квадратных PNG (лого по центру на
  // прозрачном холсте, без искажений пропорций) под конкретные размеры,
  // плюс app/favicon.ico (многослойный 16/32/48 — именно его чаще всего
  // берёт Chrome для самой вкладки) и отдельный apple-touch-icon 180x180.
  icons: {
    icon: [
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-48.png', sizes: '48x48', type: 'image/png' },
      { url: '/favicon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/favicon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: '/favicon-180.png',
  },
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
          {process.env.NODE_ENV === 'production' && <CookieConsentBanner />}
        </ClientProvider>
      </body>
    </html>
  )
}