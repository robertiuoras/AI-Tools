"use client";

export function TopLoadingBar({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-1 overflow-hidden bg-muted/80 shadow-sm"
      role="progressbar"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="h-full animate-loading-bar rounded-r-full bg-primary shadow-[0_0_14px_rgba(99,102,241,0.45)]" />
    </div>
  );
}
