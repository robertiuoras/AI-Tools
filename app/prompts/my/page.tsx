"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { UserPromptsPanel } from "@/components/prompts/UserPromptsPanel";
import { ArrowLeft, User } from "lucide-react";

export default function MyPromptsPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-fuchsia-500/5 via-background to-violet-500/5">
      <div className="container max-w-5xl px-4 py-10">
        <div className="mb-8">
          <Button variant="ghost" size="sm" className="mb-4 gap-2 pl-0 hover:bg-transparent" asChild>
            <Link href="/prompts">
              <ArrowLeft className="h-4 w-4" />
              Back to community prompts
            </Link>
          </Button>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">
                <span className="bg-gradient-to-r from-fuchsia-600 to-violet-600 bg-clip-text text-transparent dark:from-fuchsia-400 dark:to-violet-400">
                  My prompts
                </span>
              </h1>
              <p className="text-muted-foreground">
                Your personal library — same categories as the community page.
              </p>
            </div>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500/20 to-violet-500/20 ring-1 ring-border/60">
              <User className="h-6 w-6 text-fuchsia-600 dark:text-fuchsia-400" />
            </div>
          </div>
        </div>

        <UserPromptsPanel />
      </div>
    </div>
  );
}
