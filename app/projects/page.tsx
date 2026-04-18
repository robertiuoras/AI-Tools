"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import {
  Bot,
  LayoutGrid,
  Loader2,
  Sparkles,
  TrendingUp,
  ArrowRight,
  Wand2,
  Crosshair,
} from "lucide-react";

export default function ProjectsPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const [authLoading, setAuthLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setAuthLoading(false);
        router.push("/");
        return;
      }

      const { data: userData, error } = await supabase
        .from("user")
        .select("role")
        .eq("id", session.user.id)
        .single();

      if (error || !userData || userData.role !== "admin") {
        setAuthLoading(false);
        addToast({
          variant: "error",
          title: "Access denied",
          description: "Only administrators can open Projects.",
        });
        router.push("/");
        return;
      }

      setIsAdmin(true);
      setAuthLoading(false);
    };

    void checkAuth();
  }, [router, addToast]);

  if (authLoading || !isAdmin) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
        <span className="text-sm">Checking access…</span>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsl(var(--primary)/0.12),transparent)]"
        aria-hidden
      />
      <div className="pointer-events-none absolute -right-24 top-24 -z-10 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl dark:bg-emerald-400/10" />
      <div className="pointer-events-none absolute -left-24 bottom-0 -z-10 h-64 w-64 rounded-full bg-teal-500/10 blur-3xl dark:bg-teal-400/10" />

      <div className="container mx-auto max-w-5xl px-4 py-10 md:py-14">
        <header className="mb-10 md:mb-12">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
            <LayoutGrid className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            Admin workspace
          </div>
          <h1 className="bg-gradient-to-br from-foreground via-foreground to-foreground/70 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
            Projects
          </h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground md:text-lg">
            Small tools and experiments in one place. More cards will appear here
            as each project is ready.
          </p>
        </header>

        <section aria-labelledby="projects-grid-heading">
          <h2 id="projects-grid-heading" className="sr-only">
            Project tools
          </h2>
          <ul className="grid list-none grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 p-0 m-0">

            {/* ── Hedge Calculator ─────────────────────────── */}
            <li>
              <Link href="/projects/hedge-calculator" className="block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl">
                <Card
                  className={cn(
                    "group relative h-full overflow-hidden border-border/80 bg-card/80 shadow-md backdrop-blur-sm transition-all cursor-pointer",
                    "hover:border-emerald-500/40 hover:shadow-xl hover:shadow-emerald-500/10 hover:-translate-y-0.5",
                  )}
                >
                  <div
                    className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/[0.07] via-transparent to-teal-500/[0.06]"
                    aria-hidden
                  />
                  <CardHeader className="relative space-y-3 pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div
                        className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-600/20 ring-1 ring-emerald-500/20"
                        aria-hidden
                      >
                        <TrendingUp className="h-6 w-6 text-emerald-700 dark:text-emerald-300" />
                      </div>
                      <Badge
                        variant="secondary"
                        className="shrink-0 border border-emerald-500/25 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                      >
                        Live
                      </Badge>
                    </div>
                    <CardTitle className="text-xl font-semibold tracking-tight">
                      Betting Calculator Suite
                    </CardTitle>
                    <CardDescription className="text-sm leading-relaxed">
                      Hedge bets for guaranteed profit, convert odds, calculate EV, use Kelly Criterion, build parlays, and find break-even rates.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="relative pt-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {["Hedge", "EV", "Kelly", "Parlay", "Converter"].map((tag) => (
                        <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-muted/80 px-2 py-1 font-medium">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 group-hover:gap-2 transition-all">
                      Open calculator
                      <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>

            {/* ── AI Video Summariser ──────────────────────── */}
            <li>
              <Link
                href="/projects/ai-video-summariser"
                className="block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl"
              >
                <Card
                  className={cn(
                    "group relative h-full overflow-hidden border-border/80 bg-card/80 shadow-md backdrop-blur-sm transition-all cursor-pointer",
                    "hover:border-violet-500/40 hover:shadow-xl hover:shadow-violet-500/10 hover:-translate-y-0.5",
                  )}
                >
                  <div
                    className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-500/[0.08] via-transparent to-fuchsia-500/[0.06]"
                    aria-hidden
                  />
                  <CardHeader className="relative space-y-3 pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div
                        className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-600/20 ring-1 ring-violet-500/20"
                        aria-hidden
                      >
                        <Wand2 className="h-6 w-6 text-violet-700 dark:text-violet-300" />
                      </div>
                      <Badge
                        variant="secondary"
                        className="shrink-0 border border-violet-500/25 bg-violet-500/10 text-violet-900 dark:text-violet-200"
                      >
                        New
                      </Badge>
                    </div>
                    <CardTitle className="text-xl font-semibold tracking-tight">
                      AI Video Summariser
                    </CardTitle>
                    <CardDescription className="text-sm leading-relaxed">
                      Paste a YouTube or TikTok URL — get a TL;DR, key points
                      and a slide-ready outline. Export to Markdown or PDF.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="relative pt-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {["YouTube", "TikTok", "Key points", "Outline", "PDF"].map(
                        (tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 rounded-md bg-muted/80 px-2 py-1 font-medium"
                          >
                            {tag}
                          </span>
                        ),
                      )}
                    </div>
                    <div className="mt-4 flex items-center gap-1 text-xs font-medium text-violet-700 dark:text-violet-400 group-hover:gap-2 transition-all">
                      Open summariser
                      <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>

            {/* ── CS2 Skin Bot ───────────────────────────────── */}
            <li>
              <Link
                href="/projects/cs2-bot"
                className="block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl"
              >
                <Card
                  className={cn(
                    "group relative h-full overflow-hidden border-border/80 bg-card/80 shadow-md backdrop-blur-sm transition-all cursor-pointer",
                    "hover:border-orange-500/40 hover:shadow-xl hover:shadow-orange-500/10 hover:-translate-y-0.5",
                  )}
                >
                  <div
                    className="pointer-events-none absolute inset-0 bg-gradient-to-br from-orange-500/[0.08] via-transparent to-red-500/[0.06]"
                    aria-hidden
                  />
                  <CardHeader className="relative space-y-3 pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div
                        className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500/20 to-red-600/20 ring-1 ring-orange-500/20"
                        aria-hidden
                      >
                        <Crosshair className="h-6 w-6 text-orange-700 dark:text-orange-300" />
                      </div>
                      <Badge
                        variant="secondary"
                        className="shrink-0 border border-orange-500/25 bg-orange-500/10 text-orange-900 dark:text-orange-200"
                      >
                        New
                      </Badge>
                    </div>
                    <CardTitle className="text-xl font-semibold tracking-tight">
                      CS2 Skin Bot
                    </CardTitle>
                    <CardDescription className="text-sm leading-relaxed">
                      Compare CSFloat / Steam prices, calculate fees, and let
                      AI rank a listing screenshot for you.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="relative pt-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {["CSFloat", "Steam", "Fees", "AI vision", "Arbitrage"].map(
                        (tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 rounded-md bg-muted/80 px-2 py-1 font-medium"
                          >
                            {tag}
                          </span>
                        ),
                      )}
                    </div>
                    <div className="mt-4 flex items-center gap-1 text-xs font-medium text-orange-700 dark:text-orange-400 group-hover:gap-2 transition-all">
                      Open CS2 bot
                      <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>

            {/* ── Betting bot (coming soon) ─────────────────── */}
            <li>
              <Card
                className={cn(
                  "group relative h-full overflow-hidden border-border/80 bg-card/80 shadow-md backdrop-blur-sm transition-shadow",
                  "hover:border-amber-500/20 hover:shadow-lg hover:shadow-amber-500/5",
                )}
              >
                <div
                  className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-500/[0.05] via-transparent to-orange-500/[0.04]"
                  aria-hidden
                />
                <CardHeader className="relative space-y-3 pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-600/20 ring-1 ring-amber-500/20"
                      aria-hidden
                    >
                      <Bot className="h-6 w-6 text-amber-700 dark:text-amber-300" />
                    </div>
                    <Badge
                      variant="secondary"
                      className="shrink-0 border border-amber-500/25 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                    >
                      Coming soon
                    </Badge>
                  </div>
                  <CardTitle className="text-xl font-semibold tracking-tight">
                    Betting bot
                  </CardTitle>
                  <CardDescription className="text-sm leading-relaxed">
                    Automated odds tracking and stake suggestions—UI and
                    integrations are under development.
                  </CardDescription>
                </CardHeader>
                <CardContent className="relative pt-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/80 px-2 py-1 font-medium">
                      <Sparkles className="h-3 w-3" />
                      Internal preview
                    </span>
                  </div>
                </CardContent>
              </Card>
            </li>

          </ul>
        </section>
      </div>
    </div>
  );
}
