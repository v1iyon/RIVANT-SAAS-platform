"use client";

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

export function AdminSidebar() {
  const pathname = usePathname();
  const { logout } = useAdminAuth();

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-gray-800 bg-gray-950">
      <div className="flex h-16 items-center border-b border-gray-800 px-5">
        <span className="font-semibold text-white">Rivant Admin</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname?.startsWith(item.href + "/");
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
  );
}