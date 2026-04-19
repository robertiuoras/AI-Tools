"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuthSession } from "@/components/AuthSessionProvider";

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role?: string | null;
}

interface UserProfileContextValue {
  profile: UserProfile | null;
  loading: boolean;
  /** Re-fetches the profile from the server (use after a backend update). */
  refresh: () => Promise<void>;
  /** Optimistically replaces the cached profile (e.g. after PATCH). */
  setProfile: (next: UserProfile | null) => void;
}

const UserProfileContext = createContext<UserProfileContextValue | null>(null);

const STORAGE_KEY = "user:profile";

/**
 * Fetches and caches the current user's profile (name, avatar) so any
 * component can read it cheaply. Hydrates from localStorage so the
 * avatar/name appear instantly on page load instead of after the
 * profile fetch round-trip completes.
 *
 * Listens for a `user:profile-updated` window event so settings dialogs
 * elsewhere can broadcast updates without prop drilling.
 */
export function UserProfileProvider({ children }: { children: ReactNode }) {
  const { userId, accessToken, isReady } = useAuthSession();
  const [profile, setProfileState] = useState<UserProfile | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as UserProfile;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);

  const setProfile = useCallback((next: UserProfile | null) => {
    setProfileState(next);
    if (typeof window === "undefined") return;
    if (next) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* quota / private mode — non-fatal */
      }
    } else {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!userId || !accessToken) return;
    setLoading(true);
    try {
      const res = await fetch("/api/user/profile", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { user: UserProfile | null };
      if (data.user) setProfile(data.user);
    } catch {
      /* ignore network blips — we'll retry on next mount */
    } finally {
      setLoading(false);
    }
  }, [userId, accessToken, setProfile]);

  // Fetch on auth-ready and whenever the user id changes.
  useEffect(() => {
    if (!isReady) return;
    if (!userId) {
      setProfile(null);
      return;
    }
    if (profile?.id !== userId) {
      void refresh();
    } else {
      // Background refresh to pick up server-side changes.
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, userId]);

  // Cross-component update broadcast (e.g. settings dialog → header
  // avatar). Components dispatch `new CustomEvent("user:profile-updated",
  // { detail: <UserProfile> })` after a successful PATCH/upload.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onUpdated = (e: Event) => {
      const detail = (e as CustomEvent<UserProfile | null>).detail;
      if (detail && typeof detail === "object" && "id" in detail) {
        setProfile(detail);
      } else {
        void refresh();
      }
    };
    window.addEventListener("user:profile-updated", onUpdated);
    return () => window.removeEventListener("user:profile-updated", onUpdated);
  }, [refresh, setProfile]);

  return (
    <UserProfileContext.Provider value={{ profile, loading, refresh, setProfile }}>
      {children}
    </UserProfileContext.Provider>
  );
}

export function useUserProfile(): UserProfileContextValue {
  const ctx = useContext(UserProfileContext);
  if (!ctx) {
    // Allow components to render without the provider (gracefully degrade)
    // by returning a no-op shape. This avoids crashing rare admin pages
    // that may not have the provider mounted.
    return {
      profile: null,
      loading: false,
      refresh: async () => {},
      setProfile: () => {},
    };
  }
  return ctx;
}

/** Helper used by avatar bubbles (header, presence). */
export function userInitials(name?: string | null, email?: string | null): string {
  const src = (name && name.trim()) || (email && email.split("@")[0]) || "";
  if (!src) return "?";
  const parts = src.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Stable HSL colour from a string (for placeholder avatar bg). */
export function avatarColor(seed?: string | null): string {
  const s = seed || "anon";
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}
