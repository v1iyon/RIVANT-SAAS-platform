"use client";

import { useState, useEffect } from "react";
import { useAdminAuth } from "@/components/admin/admin-auth-provider";

interface Review {
  id: string;
  author_name: string;
  business_name: string | null;
  rating: number;
  comment?: string | null;
  // На случай, если в вашей таблице поле с текстом называется иначе —
  // берём первое непустое из возможных вариантов.
  text?: string | null;
  message?: string | null;
  review_text?: string | null;
  status: string;
  created_at: string;
}

// Достаём текст отзыва независимо от того, как называется колонка в БД.
function getReviewText(r: Review) {
  return r.comment || r.text || r.message || r.review_text || "";
}

export default function AdminReviewsPage() {
  const { adminFetch } = useAdminAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  const loadReviews = async () => {
    setLoading(true);
    const res = await adminFetch("/api/admin/reviews");
    setLoading(false);
    if (!res.ok) return;
    const data = await res.json();
    setReviews(data.reviews || []);
  };

  useEffect(() => {
    loadReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateStatus = async (id: string, status: "approved" | "rejected") => {
    await adminFetch("/api/admin/reviews", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    loadReviews();
  };

  const deleteReview = async (id: string, author: string) => {
    if (!confirm(`Удалить отзыв от "${author}" навсегда? Это действие необратимо.`)) return;
    await adminFetch("/api/admin/reviews", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    loadReviews();
  };

  if (loading && reviews.length === 0) {
    return <p className="p-6 text-sm text-gray-500">Загрузка...</p>;
  }

  const pending = reviews.filter((r) => r.status === "pending");
  const other = reviews.filter((r) => r.status !== "pending");

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Модерация отзывов</h1>

      <h2 className="mb-3 font-semibold text-white">На рассмотрении ({pending.length})</h2>
      <div className="mb-10 space-y-3">
        {pending.length === 0 && <p className="text-sm text-gray-500">Нет отзывов на рассмотрении.</p>}
        {pending.map((r) => (
          <div key={r.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <p className="font-medium text-white">{r.author_name}</p>
                {r.business_name && <p className="text-xs text-gray-500">{r.business_name}</p>}
              </div>
              <span className="text-sm text-yellow-400">
                {"★".repeat(r.rating)}
                {"☆".repeat(5 - r.rating)}
              </span>
            </div>
            <p className="mb-3 text-sm text-gray-300">{getReviewText(r)}</p>
            <div className="flex gap-2">
              <button
                onClick={() => updateStatus(r.id, "approved")}
                className="rounded-lg bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700"
              >
                Принять
              </button>
              <button
                onClick={() => updateStatus(r.id, "rejected")}
                className="rounded-lg bg-red-600/80 px-4 py-1.5 text-sm text-white hover:bg-red-700"
              >
                Отклонить
              </button>
              <button
                onClick={() => deleteReview(r.id, r.author_name)}
                className="ml-auto rounded-lg bg-gray-700 px-4 py-1.5 text-sm text-gray-300 hover:bg-gray-600"
              >
                Удалить
              </button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mb-3 font-semibold text-white">История ({other.length})</h2>
      <div className="space-y-2">
        {other.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-gray-800 bg-gray-900/50 p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-gray-300">
                {r.author_name} — {getReviewText(r).slice(0, 60)}...
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  r.status === "approved"
                    ? "bg-green-500/20 text-green-400"
                    : "bg-red-500/20 text-red-400"
                }`}
              >
                {r.status === "approved" ? "Принят" : r.status === "rejected" ? "Отклонён" : r.status}
              </span>
              {r.status === "approved" ? (
                <button
                  onClick={() => updateStatus(r.id, "rejected")}
                  className="rounded-lg bg-gray-800 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-700"
                >
                  Отменить
                </button>
              ) : (
                <button
                  onClick={() => updateStatus(r.id, "approved")}
                  className="rounded-lg bg-gray-800 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-700"
                >
                  Принять
                </button>
              )}
              <button
                onClick={() => deleteReview(r.id, r.author_name)}
                className="rounded-lg bg-red-900/40 px-2.5 py-1 text-xs text-red-300 hover:bg-red-900/70"
              >
                Удалить
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}