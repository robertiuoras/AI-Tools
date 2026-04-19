"use client";

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  Camera,
  Trash2,
  X,
  Check,
  Mail,
  User as UserIcon,
} from "lucide-react";
import { useAuthSession } from "@/components/AuthSessionProvider";
import {
  useUserProfile,
  userInitials,
  avatarColor,
  type UserProfile,
} from "@/components/UserProfileProvider";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Centered modal that lets the user customize their display name and
 * profile picture. Saves to /api/user/profile and /api/user/avatar, then
 * broadcasts a `user:profile-updated` window event so anywhere the
 * profile is shown (header avatar, presence pills in shared notes /
 * whiteboard) updates instantly without a reload.
 */
export function ProfileSettingsDialog({ open, onClose }: Props) {
  const { accessToken } = useAuthSession();
  const { profile, setProfile, refresh } = useUserProfile();
  const { addToast } = useToast();

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Hydrate the form whenever the dialog opens or the profile changes.
  useEffect(() => {
    if (!open) return;
    setName(profile?.name ?? "");
    setPreviewUrl(null);
  }, [open, profile?.id, profile?.name]);

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

  const saveName = async () => {
    if (!accessToken) return;
    const trimmed = name.trim();
    if (!trimmed) {
      addToast({ title: "Please enter a name", variant: "error" });
      return;
    }
    if (trimmed === (profile?.name ?? "")) {
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
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Server returned ${res.status}`);
      }
      const data = (await res.json()) as { user: UserProfile };
      broadcast(data.user);
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
  const bgColor = avatarColor(profile?.id ?? profile?.email);
  const busy = saving || uploadingAvatar || removingAvatar;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-settings-title"
      className="fixed inset-0 z-[160] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border/70 bg-popover shadow-2xl ring-1 ring-black/10">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
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

        <div className="space-y-5 px-5 py-4">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <div
                className="flex h-20 w-20 items-center justify-center rounded-full text-2xl font-semibold text-white shadow-md ring-2 ring-background"
                style={{ backgroundColor: bgColor }}
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
              This name shows up in shared notes, whiteboards, and notifications.
            </p>
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
            "flex items-center justify-end gap-2 border-t border-border/60 bg-muted/30 px-5 py-3",
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
            onClick={() => void saveName()}
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
