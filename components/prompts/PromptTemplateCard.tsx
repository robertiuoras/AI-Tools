"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, Check } from "lucide-react";

export function PromptTemplateCard({
  id,
  title,
  body,
  badge,
  copiedId,
  onCopy,
  extra,
}: {
  id: string;
  title: string;
  body: string;
  badge?: string;
  copiedId: string | null;
  onCopy: () => void;
  extra?: ReactNode;
}) {
  return (
    <Card className="border-border/60 bg-card/80 shadow-sm">
      <CardHeader className="space-y-1 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            {badge && (
              <Badge variant="secondary" className="text-xs font-normal">
                {badge}
              </Badge>
            )}
            <CardTitle className="text-base leading-snug">{title}</CardTitle>
          </div>
          <div className="flex shrink-0 gap-1">
            {extra}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={onCopy}
            >
              {copiedId === id ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              Copy
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground/90">
          {body}
        </pre>
      </CardContent>
    </Card>
  );
}
