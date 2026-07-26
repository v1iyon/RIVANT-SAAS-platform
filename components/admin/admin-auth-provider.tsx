"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

// Тот же ключ sessionStorage, что уже использовался в текущих страницах —
// поэтому существующий вход не ломается.
const STORAGE_KEY = "admin_secret";

interface AdminAuthContextValue {
  secret: string;
  adminFetch: (url: string, options?: RequestInit) => Promise<Response>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error("useAdminAuth должен вызываться внутри AdminAuthProvider");
  }
  return ctx;
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      setSecret(saved);
      setUnlocked(true);
    }
    setChecking(false);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setSecret("");
    setUnlocked(false);
  }, []);

  // Оборачивает fetch: сам добавляет x-admin-secret и сам разлогинивает
  // при 401 — остальным страницам не нужно об этом думать.
  const adminFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const res = await fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), "x-admin-secret": secret },
      });
      if (res.status === 401) logout();
      return res;
    },
    [secret, logout]
  );

  const tryUnlock = async () => {
    setLoading(true);
    setError("");
    // Проверяем пароль через уже существующий эндпоинт отзывов.
    const res = await fetch("/api/admin/reviews", {
      headers: { "x-admin-secret": input },
    });
    setLoading(false);
    if (!res.ok) {
      setError("Invalid secret or server error");
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, input);
    setSecret(input);
    setUnlocked(true);
  };

  if (checking) return null;

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-sm">
          <h1 className="text-lg font-semibold text-white mb-4">Admin Access</h1>
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
            placeholder="Admin secret"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm mb-3"
          />
          {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
          <button
            onClick={tryUnlock}
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "..." : "Unlock"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <AdminAuthContext.Provider value={{ secret, adminFetch, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}