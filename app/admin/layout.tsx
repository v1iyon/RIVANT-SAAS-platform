import type { ReactNode } from "react";
import { AdminAuthProvider } from "@/components/admin/admin-auth-provider";
import { AdminSidebar } from "@/components/admin/admin-sidebar";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminAuthProvider>
      <div className="flex min-h-screen bg-black">
        <AdminSidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </AdminAuthProvider>
  );
}