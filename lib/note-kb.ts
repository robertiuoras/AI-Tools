/** Client-only: Mac vs Windows/Linux modifier labels for note UI. */
export function noteIsApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/i.test(navigator.platform);
}

/** e.g. ⌘ or Ctrl+ */
export function noteModPrefix(): string {
  return noteIsApplePlatform() ? "⌘" : "Ctrl+";
}

/** Bracket shortcut for tooltips/menus: (⌘B) or (Ctrl+B) */
export function noteKbParen(key: string): string {
  const m = noteModPrefix();
  return m === "⌘" ? `(⌘${key})` : `(Ctrl+${key})`;
}

/** Plain paste shortcut: (⌘\\) or (Ctrl+\\) */
export function noteKbPastePlainParen(): string {
  return noteIsApplePlatform() ? `(⌘\\)` : `(Ctrl+\\)`;
}

/** Redo: ⌘⇧Z on Apple, Ctrl+Y on Windows/Linux */
export function noteKbRedoParen(): string {
  return noteIsApplePlatform() ? `(⌘⇧Z)` : `(Ctrl+Y)`;
}
