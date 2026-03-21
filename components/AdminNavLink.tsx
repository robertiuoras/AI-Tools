"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export function AdminNavLink() {
  const pathname = usePathname();
  const isAdminPage = pathname === "/admin";
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        if (!cancelled) setIsAdmin(false);
        return;
      }
      try {
        const res = await fetch("/api/auth/check", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { role?: string };
        if (!cancelled) setIsAdmin(data?.role === "admin");
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    };

    void check();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void check();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  if (!isAdmin) return null;

  return (
    <Link
      href="/admin"
      className={cn(
        "group relative text-sm font-medium transition-colors",
        isAdminPage ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "transition-all duration-200",
          isAdminPage
            ? "bg-gradient-to-r from-amber-400 to-rose-500 bg-clip-text text-transparent"
            : "text-muted-foreground group-hover:bg-gradient-to-r group-hover:from-amber-400 group-hover:to-rose-500 group-hover:bg-clip-text group-hover:text-transparent",
        )}
      >
        Admin
      </span>
      {isAdminPage && (
        <span className="pointer-events-none absolute inset-x-0 -bottom-1 h-px bg-gradient-to-r from-amber-400/60 via-rose-500/60 to-purple-500/60 blur-[1px]" />
      )}
    </Link>
  );
}
