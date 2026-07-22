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

export function openPaddleCheckout({
  priceId,
  email,
  plan,
}: {
  priceId: string;
  email: string;
  plan: string;
}) {
  window.Paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: { email },
    customData: { email, plan },
    settings: {
      successUrl: `${window.location.origin}/dashboard?checkout=success`,
    },
  });
}