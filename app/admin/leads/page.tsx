"use client";

import { useState, useEffect } from "react";

interface Lead {
  id: string;
  name: string;
  company: string | null;
  email: string;
  telegram: string | null;
  message: string | null;
  source: string | null;
  status: string;
  created_at: string;
}

export default function AdminLeadsPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadLeads = async (key: string) => {
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/leads", {
      headers: { "x-admin-secret": key },
    });
    setLoading(false);
    if (!res.ok) {
      setError("Invalid secret or server error");
      return;
    }
    const data = await res.json();
    setLeads(data.leads || []);
    setUnlocked(true);
    sessionStorage.setItem("admin_secret", key);
  };

  useEffect(() => {
    const saved = sessionStorage.getItem("admin_secret");
    if (saved) {
      setSecret(saved);
      loadLeads(saved);
    }
  }, []);

  const updateStatus = async (id: string, status: "contacted" | "rejected") => {
    await fetch("/api/admin/leads", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ id, status }),
    });
    loadLeads(secret);
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
            onClick={() => loadLeads(secret)}
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "..." : "Unlock"}
          </button>
        </div>
      </div>
    );
  }

  const fresh = leads.filter((l) => l.status === "new");
  const other = leads.filter((l) => l.status !== "new");

  const sourceLabel = (source: string | null) => {
    if (source === "loss_calculator") return "Loss Calculator";
    if (source === "contact_form") return "Contact Form";
    return source || "—";
  };

  return (
    <div className="min-h-screen bg-black p-6">
      <h1 className="text-2xl font-bold text-white mb-6">Leads</h1>

      <h2 className="text-white font-semibold mb-3">New ({fresh.length})</h2>
      <div className="space-y-3 mb-10">
        {fresh.length === 0 && <p className="text-gray-500 text-sm">No new leads.</p>}
        {fresh.map((l) => (
          <div key={l.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex justify-between items-start mb-2">
              <div>
                <p className="text-white font-medium">{l.name}</p>
                {l.company && <p className="text-gray-500 text-xs">{l.company}</p>}
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                {sourceLabel(l.source)}
              </span>
            </div>
            <div className="text-gray-400 text-xs mb-2 space-x-3">
              <a href={`mailto:${l.email}`} className="hover:text-white underline">{l.email}</a>
              {l.telegram && <span>TG: {l.telegram}</span>}
              <span>{new Date(l.created_at).toLocaleString()}</span>
            </div>
            {l.message && <p className="text-gray-300 text-sm mb-3 whitespace-pre-line">{l.message}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => updateStatus(l.id, "contacted")}
                className="px-4 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700"
              >
                Mark contacted
              </button>
              <button
                onClick={() => updateStatus(l.id, "rejected")}
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
        {other.map((l) => (
          <div key={l.id} className="bg-gray-900/50 border border-gray-800 rounded-xl p-3 flex justify-between items-center">
            <div>
              <p className="text-gray-300 text-sm">{l.name} — {l.email}</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full ${l.status === "contacted" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
              {l.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}