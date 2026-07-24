"use client";

import { useState, useEffect } from "react";

interface Review {
  id: string;
  author_name: string;
  business_name: string | null;
  rating: number;
  comment: string;
  status: string;
  created_at: string;
}

export default function AdminReviewsPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadReviews = async (key: string) => {
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/reviews", {
      headers: { "x-admin-secret": key },
    });
    setLoading(false);
    if (!res.ok) {
      setError("Invalid secret or server error");
      return;
    }
    const data = await res.json();
    setReviews(data.reviews || []);
    setUnlocked(true);
    sessionStorage.setItem("admin_secret", key);
  };

  useEffect(() => {
    const saved = sessionStorage.getItem("admin_secret");
    if (saved) {
      setSecret(saved);
      loadReviews(saved);
    }
  }, []);

  const updateStatus = async (id: string, status: "approved" | "rejected") => {
    await fetch("/api/admin/reviews", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ id, status }),
    });
    loadReviews(secret);
  };

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-sm">
          <h1 className="text-lg font-semibold text-white mb-4">Admin Access</h1>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Admin secret"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm mb-3"
          />
          {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
          <button
            onClick={() => loadReviews(secret)}
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "..." : "Unlock"}
          </button>
        </div>
      </div>
    );
  }

  const pending = reviews.filter((r) => r.status === "pending");
  const other = reviews.filter((r) => r.status !== "pending");

  return (
    <div className="min-h-screen bg-black p-6">
      <h1 className="text-2xl font-bold text-white mb-6">Review Moderation</h1>

      <h2 className="text-white font-semibold mb-3">Pending ({pending.length})</h2>
      <div className="space-y-3 mb-10">
        {pending.length === 0 && <p className="text-gray-500 text-sm">No pending reviews.</p>}
        {pending.map((r) => (
          <div key={r.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex justify-between items-start mb-2">
              <div>
                <p className="text-white font-medium">{r.author_name}</p>
                {r.business_name && <p className="text-gray-500 text-xs">{r.business_name}</p>}
              </div>
              <span className="text-yellow-400 text-sm">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
            </div>
            <p className="text-gray-300 text-sm mb-3">{r.comment}</p>
            <div className="flex gap-2">
              <button
                onClick={() => updateStatus(r.id, "approved")}
                className="px-4 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700"
              >
                Approve
              </button>
              <button
                onClick={() => updateStatus(r.id, "rejected")}
                className="px-4 py-1.5 bg-red-600/80 text-white text-sm rounded-lg hover:bg-red-700"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-white font-semibold mb-3">History ({other.length})</h2>
      <div className="space-y-2">
        {other.map((r) => (
          <div key={r.id} className="bg-gray-900/50 border border-gray-800 rounded-xl p-3 flex justify-between items-center">
            <div>
              <p className="text-gray-300 text-sm">{r.author_name} — {r.comment.slice(0, 60)}...</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === "approved" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
              {r.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}