/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Раньше стояло true — билд проходил даже с ошибками типов и маскировал
    // реальные баги. Причина, по которой это вообще было нужно: слишком
    // широкий tsconfig.json подхватывал supabase/functions/** (Deno edge
    // functions, отдельный рантайм с глобалами Deno/jsr:/esm.sh-импортами,
    // которые TS из Next-проекта не может резолвнуть). Теперь эти функции
    // явно исключены в tsconfig.json ("exclude": ["supabase/functions/**/*"]),
    // `npx tsc --noEmit` на самом Next-коде (app/components/lib) чист — так
    // что ignoreBuildErrors больше не нужен и не должен маскировать реальные
    // ошибки типов в будущем.
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    allowedDevOrigins: ['192.168.100.185'],
  },
  // п.10 аудита: раньше вообще не было security-заголовков. Vercel сам их
  // не добавляет. Набор ниже — консервативный: закрывает clickjacking на
  // /admin (главный названный в аудите риск) и базовые MIME/referrer-дыры,
  // без строгого CSP на script-src/connect-src — сайт грузит Stripe,
  // Paddle, Ko-fi, Supabase, Google/Meta пиксели и шрифты, и жёсткий CSP
  // без полной инвентаризации доменов скорее сломает чекаут/оплату, чем
  // защитит. frame-ancestors в CSP продублирован с X-Frame-Options для
  // старых браузеров, которые CSP не читают.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ]
  },
}

export default nextConfig