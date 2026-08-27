"use client";

declare global {
  interface Window {
    Paddle: any;
  }
}

let paddleReady: Promise<void> | null = null;

export function loadPaddle(): Promise<void> {
  if (paddleReady) return paddleReady;

  paddleReady = new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject("no window");

    if (window.Paddle) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.onload = () => {
      window.Paddle.Environment.set(
        process.env.NEXT_PUBLIC_PADDLE_ENV === "sandbox" ? "sandbox" : "production"
      );
      window.Paddle.Initialize({
        token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN!,
      });
      resolve();
    };
    script.onerror = () => reject("failed to load paddle.js");
    document.body.appendChild(script);
  });

  return paddleReady;
}

// ФІКС (аудит FINAL B3): раніше приймала лише { priceId, email, plan } і
// сама жорстко збирала customData: { email, plan } — business_id, який
// /api/orders/create СПЕЦІАЛЬНО готує в result.customData, губився по
// дорозі. Вебхук (app/api/webhooks/paddle/route.js) для допуслуг
// вимагає custom_data.business_id і без нього тихо відповідає 200 OK,
// нічого не створюючи — гроші списались, послуга — ні. Зараз ця гілка
// недосяжна (усі три допуслуги йдуть через Ko-fi/крипту, не через
// Paddle), але лишати міну для моменту, коли Paddle увімкнуть під
// допуслуги, не варто.
//
// Тепер приймає весь customData цілим об'єктом від сервера (як він є в
// result.customData з /api/orders/create), а не збирає його сама з
// урізаного набору полів — це і є "єдине джерело правди" про те, що
// має піти у вебхук.
export function openPaddleCheckout({
  priceId,
  email,
  customData,
}: {
  priceId: string;
  email: string;
  customData?: Record<string, unknown>;
}) {
  window.Paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: { email },
    customData: customData ?? { email },
    settings: {
      successUrl: `${window.location.origin}/dashboard?checkout=success`,
    },
  });
}