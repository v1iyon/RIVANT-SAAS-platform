"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAdminAuth } from "./admin-auth-provider";
import {
  LayoutDashboard,
  Users,
  Star,
  AlertTriangle,
  MessageSquare,
  CreditCard,
  Bell,
  LineChart,
  LogOut,
  Menu,
  X,
} from "lucide-react";

// Единственное место, где нужно дописать пункт меню при добавлении раздела.
const NAV_ITEMS = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Пользователи", icon: Users },
  { href: "/admin/reviews", label: "Отзывы", icon: Star },
  { href: "/admin/errors", label: "Ошибки", icon: AlertTriangle },
  { href: "/admin/feedback", label: "Обратная связь", icon: MessageSquare },
  { href: "/admin/subscriptions", label: "Подписки", icon: CreditCard },
  { href: "/admin/notifications", label: "Уведомления", icon: Bell },
  { href: "/admin/analytics", label: "Аналитика продукта", icon: LineChart },
] as const;

function isActivePath(pathname: string | null, href: string) {
  return pathname === href || pathname?.startsWith(href + "/");
}

export function AdminSidebar() {
  const pathname = usePathname();
  const { logout } = useAdminAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { adminFetch } = useAdminAuth();
const [errorCount, setErrorCount] = useState(0);

useEffect(() => {
  const loadCount = async () => {
    const res = await adminFetch("/api/admin/errors/count");
    if (res.ok) {
      const data = await res.json();
      setErrorCount(data.count || 0);
    }
  };
  loadCount();
  const interval = setInterval(loadCount, 30000);
  return () => clearInterval(interval);
}, []);

  return (
    <>
      {/* ТЕЛЕФОН: тонкая полоска только с иконками, всегда видна */}
      <aside className="sticky top-0 z-30 flex h-screen w-14 shrink-0 flex-col items-center border-r border-gray-800 bg-gray-950 py-4 md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="mb-4 rounded-lg p-2 text-gray-400 hover:bg-gray-900 hover:text-white"
          aria-label="Открыть меню"
        >
          <Menu className="h-5 w-5" />
        </button>
        <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const active = isActivePath(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                  active
                    ? "bg-blue-600/20 text-blue-400"
                    : "text-gray-400 hover:bg-gray-900 hover:text-white"
                }`}
              >
                <Icon className="h-5 w-5" />
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* ДЕСКТОП: полная панель с текстом, как раньше */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-gray-800 bg-gray-950 md:flex">
        <div className="flex h-16 items-center border-b border-gray-800 px-5">
          <span className="font-semibold text-white">Rivant Admin</span>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) => {
            const active = isActivePath(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-blue-600/20 text-blue-400"
                    : "text-gray-400 hover:bg-gray-900 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
{item.label}
{item.href === "/admin/errors" && errorCount > 0 && (
  <span className="ml-auto flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
    {errorCount}
  </span>
)}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-gray-800 p-3">
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-900 hover:text-red-400"
          >
            <LogOut className="h-4 w-4" />
            Выйти
          </button>
        </div>
      </aside>

      {/* ТЕЛЕФОН: выезжающая панель с текстом поверх контента, открывается по тапу на Menu */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r border-gray-800 bg-gray-950">
            <div className="flex h-16 items-center justify-between border-b border-gray-800 px-5">
              <span className="font-semibold text-white">Rivant Admin</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="text-gray-400 hover:text-white"
                aria-label="Закрыть меню"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
              {NAV_ITEMS.map((item) => {
                const active = isActivePath(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-blue-600/20 text-blue-400"
                        : "text-gray-400 hover:bg-gray-900 hover:text-white"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
{item.label}
{item.href === "/admin/errors" && errorCount > 0 && (
  <span className="ml-auto flex h-5 min-w-5 animate-pulse items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
    {errorCount}
  </span>
)}
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-gray-800 p-3">
              <button
                onClick={() => {
                  setMobileOpen(false);
                  logout();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-900 hover:text-red-400"
              >
                <LogOut className="h-4 w-4" />
                Выйти
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}