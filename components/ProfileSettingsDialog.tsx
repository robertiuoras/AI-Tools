"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  Camera,
  Trash2,
  X,
  Check,
  Mail,
  User as UserIcon,
  MessageCircle,
  Palette,
  Sun,
  Moon,
  Monitor,
  BellRing,
  BellOff,
  Pipette,
} from "lucide-react";
import { useAuthSession } from "@/components/AuthSessionProvider";
import {
  useUserProfile,
  userInitials,
  resolveAccentColor,
  ACCENT_COLOR_PRESETS,
  type UserProfile,
} from "@/components/UserProfileProvider";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

type ThemePref = "light" | "dark" | "system";

function applyThemePref(pref: ThemePref) {
  // Mirror ThemeToggle's localStorage-based scheme so the rest of the app
  // (and a hard-reload) picks up the same value.
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  if (pref === "system") {
    window.localStorage.removeItem("theme");
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", dark);
  } else {
    window.localStorage.setItem("theme", pref);
    root.classList.toggle("dark", pref === "dark");
  }
}

/**
 * Centered modal that lets the user customize their display name,
 * profile picture, bio, accent / cursor colour, theme, and email
 * notification preference. Saves to /api/user/profile and
 * /api/user/avatar, then broadcasts a `user:profile-updated` window
 * event so anywhere the profile is shown updates instantly.
 */
export function ProfileSettingsDialog({ open, onClose }: Props) {
  const { accessToken } = useAuthSession();
  const { profile, setProfile, refresh } = useUserProfile();
  const { addToast } = useToast();

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [cursorColor, setCursorColor] = useState<string>("");
  const [themePref, setThemePref] = useState<ThemePref>("system");
  const [emailOptIn, setEmailOptIn] = useState<boolean>(true);

  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Hydrate the form whenever the dialog opens or the profile changes.
  useEffect(() => {
    if (!open) return;
    setName(profile?.name ?? "");
    setBio(profile?.bio ?? "");
    setCursorColor(profile?.cursor_color ?? "");
    setThemePref((profile?.theme_pref as ThemePref) ?? "system");
    setEmailOptIn(profile?.email_notifications ?? true);
    setPreviewUrl(null);
  }, [
    open,
    profile?.id,
    profile?.name,
    profile?.bio,
    profile?.cursor_color,
    profile?.theme_pref,
    profile?.email_notifications,
  ]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving && !uploadingAvatar && !removingAvatar) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, saving, uploadingAvatar, removingAvatar]);

  if (!open) return null;

  const broadcast = (next: UserProfile) => {
    setProfile(next);
    if (typeof window !== "undefined") {
      try {
        window.dispatchEvent(
          new CustomEvent("user:profile-updated", { detail: next }),
        );
      } catch {
        /* CustomEvent failure is non-fatal */
      }
    }
  };

  const dirty = useMemo(() => {
    const n = name.trim();
    const b = bio.trim();
    const c = cursorColor.trim();
    return (
      n !== (profile?.name ?? "") ||
      b !== (profile?.bio ?? "") ||
      (c || null) !== (profile?.cursor_color ?? null) ||
      themePref !== ((profile?.theme_pref as ThemePref) ?? "system") ||
      emailOptIn !== (profile?.email_notifications ?? true)
    );
  }, [name, bio, cursorColor, themePref, emailOptIn, profile]);

  const saveAll = async () => {
    if (!accessToken) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      addToast({ title: "Please enter a name", variant: "error" });
      return;
    }
    if (!dirty) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name: trimmedName,
          bio: bio.trim(),
          cursorColor: cursorColor.trim(),
          themePref,
          emailNotifications: emailOptIn,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Server returned ${res.status}`);
      }
      const data = (await res.json()) as { user: UserProfile };
      broadcast(data.user);
      // Apply theme right away so the page reflects the new choice
      // even before the next route navigation.
      applyThemePref(themePref);
      addToast({ title: "Profile updated", variant: "success", duration: 2500 });
      onClose();
    } catch (err) {
      addToast({
        title: "Couldn't save profile",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const onPickFile = (file: File) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      addToast({
        title: "Image too large",
        description: "Pick a file under 4 MB.",
        variant: "error",
      });
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    void uploadAvatar(file);
  };

  const uploadAvatar = async (file: File) => {
    if (!accessToken) return;
    setUploadingAvatar(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/user/avatar", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: fd,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Server returned ${res.status}`);
      }
      const data = (await res.json()) as { user: UserProfile };
      broadcast(data.user);
      addToast({
        title: "Avatar updated",
        variant: "success",
        duration: 2500,
      });
    } catch (err) {
      addToast({
        title: "Couldn't upload avatar",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "error",
      });
      setPreviewUrl(null);
      void refresh();
    } finally {
      setUploadingAvatar(false);
    }
  };

  const removeAvatar = async () => {
    if (!accessToken) return;
    if (!profile?.avatar_url && !previewUrl) return;
    setRemovingAvatar(true);
    try {
      const res = await fetch("/api/user/avatar", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Server returned ${res.status}`);
      }
      const data = (await res.json()) as { user: UserProfile };
      broadcast(data.user);
      setPreviewUrl(null);
      addToast({
        title: "Avatar removed",
        variant: "success",
        duration: 2500,
      });
    } catch (err) {
      addToast({
        title: "Couldn't remove avatar",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "error",
      });
    } finally {
      setRemovingAvatar(false);
    }
  };

  const displayedAvatar = previewUrl ?? profile?.avatar_url ?? null;
  const initials = userInitials(profile?.name, profile?.email);
  const accent = resolveAccentColor(cursorColor, profile?.id ?? profile?.email);
  const busy = saving || uploadingAvatar || removingAvatar;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-settings-title"
      className="fixed inset-0 z-[160] flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="my-auto flex max-h-[calc(100vh-4rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border/70 bg-popover shadow-2xl ring-1 ring-black/10">
        {/* Sticky header so the title is never clipped, even on short
            viewports where the dialog has to scroll its body. */}
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-5 py-3">
          <h2 id="profile-settings-title" className="text-sm font-semibold">
            Profile settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <div
                className="flex h-20 w-20 items-center justify-center rounded-full text-2xl font-semibold text-white shadow-md ring-2 ring-background"
                style={{ backgroundColor: accent }}
              >
                {displayedAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={displayedAvatar}
                    alt="Your avatar"
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <span aria-hidden>{initials}</span>
                )}
              </div>
              {uploadingAvatar ? (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                </div>
              ) : null}
            </div>

            <div className="flex flex-1 flex-col gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                <Camera className="h-3.5 w-3.5" />
                {profile?.avatar_url || previewUrl ? "Change picture" : "Upload picture"}
              </button>
              {(profile?.avatar_url || previewUrl) ? (
                <button
                  type="button"
                  onClick={() => void removeAvatar()}
                  disabled={busy}
                  className="inline-flex h-7 w-fit items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                >
                  {removingAvatar ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  Remove picture
                </button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onPickFile(file);
                  e.currentTarget.value = "";
                }}
              />
              <p className="text-[10px] text-muted-foreground">
                PNG, JPEG, WebP, or GIF · max 4 MB.
              </p>
            </div>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <label
              htmlFor="profile-name"
              className="flex items-center gap-1.5 text-xs font-medium text-foreground/90"
            >
              <UserIcon className="h-3.5 w-3.5" />
              Display name
            </label>
            <input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              disabled={saving}
              placeholder="What should we call you?"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
            />
            <p className="text-[10px] text-muted-foreground">
              Shows in shared notes, whiteboards, and notifications.
            </p>
          </div>

          {/* Bio */}
          <div className="space-y-1.5">
            <label
              htmlFor="profile-bio"
              className="flex items-center gap-1.5 text-xs font-medium text-foreground/90"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Bio
              <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                {bio.length}/280
              </span>
            </label>
            <textarea
              id="profile-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 280))}
              rows={2}
              disabled={saving}
              placeholder="Designer · loves pixels."
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
            />
            <p className="text-[10px] text-muted-foreground">
              A short blurb shown next to your name in shared rooms.
            </p>
          </div>

          {/* Accent / cursor colour */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-foreground/90">
              <Palette className="h-3.5 w-3.5" />
              Accent &amp; cursor colour
              {cursorColor ? (
                <button
                  type="button"
                  onClick={() => setCursorColor("")}
                  className="ml-auto text-[10px] font-normal text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Reset to auto
                </button>
              ) : (
                <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                  Using auto colour
                </span>
              )}
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {ACCENT_COLOR_PRESETS.map((c) => {
                const selected = cursorColor.toLowerCase() === c.toLowerCase();
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCursorColor(c)}
                    className={cn(
                      "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                      selected
                        ? "border-foreground ring-2 ring-foreground/20"
                        : "border-transparent",
                    )}
                    style={{ backgroundColor: c }}
                    aria-label={`Pick colour ${c}`}
                    aria-pressed={selected}
                  />
                );
              })}
              <label className="ml-1 flex h-7 cursor-pointer items-center gap-1 rounded-md border border-dashed border-border px-2 text-[11px] text-muted-foreground hover:bg-muted">
                <Pipette className="h-3 w-3" />
                Custom
                <input
                  type="color"
                  value={cursorColor || "#6366f1"}
                  onChange={(e) => setCursorColor(e.target.value)}
                  className="sr-only"
                />
              </label>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Used for your avatar fallback, live cursor, and selection
              highlights in shared notes &amp; whiteboards.
            </p>
          </div>

          {/* Theme */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-foreground/90">
              <Sun className="h-3.5 w-3.5" />
              Theme
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { v: "light", label: "Light", Icon: Sun },
                  { v: "dark", label: "Dark", Icon: Moon },
                  { v: "system", label: "System", Icon: Monitor },
                ] as const
              ).map(({ v, label, Icon }) => {
                const active = themePref === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setThemePref(v);
                      // Apply immediately for live preview; the save call
                      // will persist the choice to the user row.
                      applyThemePref(v);
                    }}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-[11px] font-medium transition-colors",
                      active
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Email notifications */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-foreground/90">
              {emailOptIn ? (
                <BellRing className="h-3.5 w-3.5" />
              ) : (
                <BellOff className="h-3.5 w-3.5" />
              )}
              Email notifications
            </label>
            <button
              type="button"
              onClick={() => setEmailOptIn((v) => !v)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                emailOptIn
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-border bg-background hover:bg-muted",
              )}
            >
              <span className="flex flex-col">
                <span className="text-xs font-medium text-foreground">
                  {emailOptIn ? "On" : "Off"}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {emailOptIn
                    ? "We'll email you when someone shares a note or whiteboard."
                    : "In-app notifications only — no emails."}
                </span>
              </span>
              <span
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                  emailOptIn ? "bg-emerald-500" : "bg-muted-foreground/30",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                    emailOptIn ? "translate-x-4" : "translate-x-0.5",
                  )}
                />
              </span>
            </button>
          </div>

          {/* Email (read-only) */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-foreground/90">
              <Mail className="h-3.5 w-3.5" />
              Email
            </label>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {profile?.email ?? "—"}
            </div>
          </div>
        </div>

        <div
          className={cn(
            "flex shrink-0 items-center justify-end gap-2 border-t border-border/60 bg-muted/30 px-5 py-3",
          )}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-foreground/80 hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void saveAll()}
            disabled={busy || !name.trim()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                Save changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
