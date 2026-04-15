"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const WhiteboardInner = dynamic(() => import("./WhiteboardInner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading whiteboard…</p>
      </div>
    </div>
  ),
});

interface Props {
  token: string;
}

export function WhiteboardPanel({ token }: Props) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-border"
      style={{ height: "calc(100vh - 220px)", minHeight: 480 }}
    >
      <WhiteboardInner token={token} />
    </div>
  );
}
