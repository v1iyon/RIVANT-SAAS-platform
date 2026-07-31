// components/dashboard/trial-prompt-modal.tsx
"use client";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

export function TrialPromptModal({ email, language }: { email: string; language: string }) {
  const [show, setShow] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!email) return;
    fetch(`/api/trial-prompt-status?email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((d) => setShow(!!d.shouldShow))
      .catch(() => {});
  }, [email]);

  const respond = async (response: "yes" | "not_now") => {
    setSending(true);
    await fetch("/api/trial-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, response }),
    });
    setSending(false);
    setShow(false);
  };

  if (!show) return null;

  const text =
    language === "UA"
      ? "Ваш тестовий період незабаром закінчується. Хочете продовжити користуватися RIVANT?"
      : language === "DE"
      ? "Ihre Testphase endet bald. Möchten Sie RIVANT weiterhin nutzen?"
      : "Your trial ends soon. Would you like to continue using RIVANT?";

  return (
    <div className="fixed bottom-6 right-6 z-[90] w-[90vw] max-w-[360px] bg-gray-900 border border-blue-500/30 rounded-2xl p-5 shadow-2xl">
      <p className="text-sm text-gray-200 mb-4">{text}</p>
      <div className="flex gap-3">
        <Button className="flex-1 bg-blue-600 hover:bg-blue-700" disabled={sending} onClick={() => respond("yes")}>
          {language === "UA" ? "Так, хочу" : language === "DE" ? "Ja" : "Yes"}
        </Button>
        <Button variant="outline" className="flex-1 border-gray-700 text-gray-300" disabled={sending} onClick={() => respond("not_now")}>
          {language === "UA" ? "Поки ні" : language === "DE" ? "Nicht jetzt" : "Not now"}
        </Button>
      </div>
    </div>
  );
}