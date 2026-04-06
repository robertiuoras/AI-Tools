"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

const ADMIN_LS_KEY = "auth:isAdmin";

export type AuthSessionContextValue = {
  session: Session | null;
  user: User | null;
  accessToken: string | null;
  userId: string | null;
  isReady: boolean;
  isAdmin: boolean;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const profileSyncedForUserRef = useRef<string | null>(null);

  useEffect(() => {
    const syncProfile = async (sess: Session) => {
      try {
        const ensureRes = await fetch("/api/user/ensure", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sess.access_token}`,
          },
        });
        if (!ensureRes.ok) console.error("Failed to ensure user record exists");
        const roleRes = await fetch("/api/auth/check", {
          headers: { Authorization: `Bearer ${sess.access_token}` },
        });
        if (roleRes.ok) {
          const roleData = (await roleRes.json()) as { role?: string };
          const admin = roleData.role === "admin";
          setIsAdmin(admin);
          try {
            if (admin) localStorage.setItem(ADMIN_LS_KEY, "1");
            else localStorage.removeItem(ADMIN_LS_KEY);
          } catch {
            /* ignore */
          }
        } else {
          setIsAdmin(false);
          try {
            localStorage.removeItem(ADMIN_LS_KEY);
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        console.error("Auth profile sync:", e);
        setIsAdmin(false);
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event === "TOKEN_REFRESHED" && sess) {
        setSession(sess);
        setIsReady(true);
        return;
      }

      if (!sess?.user) {
        setSession(null);
        setIsAdmin(false);
        profileSyncedForUserRef.current = null;
        try {
          localStorage.removeItem(ADMIN_LS_KEY);
        } catch {
          /* ignore */
        }
        setIsReady(true);
        return;
      }

      setSession(sess);

      const uid = sess.user.id;
      if (profileSyncedForUserRef.current !== uid) {
        profileSyncedForUserRef.current = uid;
        void syncProfile(sess);
      }
      setIsReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthSessionContextValue>(() => {
    const u = session?.user ?? null;
    return {
      session,
      user: u,
      accessToken: session?.access_token ?? null,
      userId: u?.id ?? null,
      isReady,
      isAdmin,
    };
  }, [session, isReady, isAdmin]);

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession(): AuthSessionContextValue {
  const ctx = useContext(AuthSessionContext);
  if (!ctx) {
    throw new Error("useAuthSession must be used within AuthSessionProvider");
  }
  return ctx;
}
