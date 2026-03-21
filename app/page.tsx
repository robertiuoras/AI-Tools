"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useRouter } from "next/navigation";
import { Hero } from "@/components/Hero";
import { ToolCard } from "@/components/ToolCard";
import { SearchBar } from "@/components/SearchBar";
import { FilterSidebar } from "@/components/FilterSidebar";
import { UpvoteTimer } from "@/components/UpvoteTimer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { GraduationCap, Heart, Info, LayoutGrid, List } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SiteTour } from "@/components/SiteTour";
import { MOST_POPULAR_HELP } from "@/lib/tool-popularity";
import type { ToolCardLayout } from "@/components/ToolCard";
import { supabase } from "@/lib/supabase";
import type { Tool } from "@/lib/supabase";

type SortOption = "alphabetical" | "newest" | "popular" | "traffic" | "traffic-low" | "upvotes";
type SortOrder = "asc" | "desc";

const TOOLS_VIEW_STORAGE_KEY = "ai-tools-view";

function HomePageContent() {
  const router = useRouter();
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTraffic, setSelectedTraffic] = useState<string[]>([]);
  const [selectedRevenue, setSelectedRevenue] = useState<string[]>([]);
  const [sort, setSort] = useState<SortOption>("popular");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tourReplayNonce, setTourReplayNonce] = useState(0);
  const [viewMode, setViewMode] = useState<ToolCardLayout>("grid");

  useEffect(() => {
    try {
      const v = localStorage.getItem(TOOLS_VIEW_STORAGE_KEY);
      if (v === "list" || v === "grid") setViewMode(v);
    } catch {
      /* ignore */
    }
  }, []);

  const setToolsViewMode = useCallback((mode: ToolCardLayout) => {
    setViewMode(mode);
    try {
      localStorage.setItem(TOOLS_VIEW_STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, []);

  const searchSuggestions = useMemo(() => {
    if (!tools || tools.length === 0) return [];
    const names = tools.map((t) => t.name);
    const cats = tools.map((t) => t.category);
    return Array.from(new Set([...names, ...cats]));
  }, [tools]);

  // Get user session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Admin role (for dev-only site tour replay button)
  useEffect(() => {
    let cancelled = false;

    const checkAdmin = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        if (!cancelled) setIsAdmin(false);
        return;
      }
      try {
        const res = await fetch("/api/auth/check", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { role?: string };
        if (!cancelled) setIsAdmin(data?.role === "admin");
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    };

    void checkAdmin();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void checkAdmin();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // Handle OAuth callback if tokens are in the hash
  useEffect(() => {
    const handleAuthCallback = async () => {
      // Check if we have tokens in the hash
      if (typeof window !== "undefined" && window.location.hash) {
        const hashParams = new URLSearchParams(
          window.location.hash.substring(1)
        );
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");

        if (accessToken && refreshToken) {
          try {
            // Set the session
            const { data, error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

            if (error) {
              console.error("Error setting session:", error);
              return;
            }

            if (data.user) {
              // Create user record if it doesn't exist
              const { data: existingUser } = await supabase
                .from("user")
                .select("id")
                .eq("id", data.user.id)
                .single();

              if (!existingUser) {
                await supabase.from("user").insert([
                  {
                    id: data.user.id,
                    email: data.user.email!,
                    name:
                      data.user.user_metadata?.name ||
                      data.user.user_metadata?.full_name ||
                      data.user.user_metadata?.display_name ||
                      data.user.email?.split("@")[0] ||
                      "User",
                    role: "user",
                  },
                ]);
              }
            }

            // Clear the hash and reload to show logged in state
            window.history.replaceState({}, "", "/");
            window.location.reload();
          } catch (error: any) {
            console.error("Error in auth callback:", error);
          }
        }
      }
    };

    handleAuthCallback();
  }, []);

  const fetchTools = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory) params.append("category", selectedCategory);
      selectedTraffic.forEach((t) => params.append("traffic", t));
      selectedRevenue.forEach((r) => params.append("revenue", r));
      if (search) params.append("search", search);
      params.append("sort", sort);
      params.append("order", sortOrder);
      if (favoritesOnly) params.append("favoritesOnly", "true");

      const session = await supabase.auth.getSession();
      const token = (await session).data.session?.access_token;

      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(`/api/tools?${params.toString()}`, {
        headers,
      });

      if (!response.ok) {
        console.error("Failed to fetch tools:", response.statusText);
        setTools([]);
        return;
      }

      const data = await response.json();

      // Ensure data is an array
      if (Array.isArray(data)) {
        setTools(data);
      } else {
        console.error("Invalid response format:", data);
        setTools([]);
      }
    } catch (error) {
      console.error("Error fetching tools:", error);
      setTools([]);
    } finally {
      setLoading(false);
    }
  }, [
    selectedCategory,
    selectedTraffic,
    selectedRevenue,
    search,
    sort,
    sortOrder,
    favoritesOnly,
    // Removed user from dependencies - it causes unnecessary refetches
  ]);

  // Debounce search to avoid too many requests
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchTools();
    }, search ? 300 : 0); // 300ms debounce for search, immediate for other filters

    return () => clearTimeout(timeoutId);
  }, [fetchTools]);

  return (
    <div className="flex min-h-screen flex-col">
      <Hero />
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="lg:w-80">
            <FilterSidebar
              selectedCategory={selectedCategory}
              onCategoryChange={setSelectedCategory}
              selectedTraffic={selectedTraffic}
              onTrafficChange={setSelectedTraffic}
              selectedRevenue={selectedRevenue}
              onRevenueChange={setSelectedRevenue}
              favoritesOnly={favoritesOnly}
              onFavoritesToggle={() => setFavoritesOnly(!favoritesOnly)}
              user={user}
            />
          </div>

          <div
            className="flex-1 scroll-mt-24 space-y-6"
            data-tutorial="tool-results"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex-1 max-w-2xl" data-tutorial="search-bar">
                <SearchBar
                  value={search}
                  onChange={setSearch}
                  suggestions={searchSuggestions}
                />
              </div>
              <UpvoteTimer />
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="flex rounded-md border border-border bg-muted/30 p-0.5"
                  role="group"
                  aria-label="Results layout"
                >
                  <Button
                    type="button"
                    size="sm"
                    variant={viewMode === "grid" ? "secondary" : "ghost"}
                    className="h-8 w-8 p-0"
                    title="Grid view"
                    aria-pressed={viewMode === "grid"}
                    onClick={() => setToolsViewMode("grid")}
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={viewMode === "list" ? "secondary" : "ghost"}
                    className="h-8 w-8 p-0"
                    title="List view"
                    aria-pressed={viewMode === "list"}
                    onClick={() => setToolsViewMode("list")}
                  >
                    <List className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-1">
                  <Select
                    value={sort}
                    onValueChange={(v) => {
                      const next = v as SortOption;
                      setSort(next);
                      if (next === "alphabetical") setSortOrder("asc");
                      else setSortOrder("desc");
                    }}
                  >
                    <SelectTrigger
                      className="w-[180px]"
                      title="Most Popular: monthly upvotes, then traffic, then star rating (curated estimate)"
                    >
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="popular">Most Popular</SelectItem>
                      <SelectItem value="alphabetical">Alphabetical</SelectItem>
                      <SelectItem value="newest">Newest</SelectItem>
                      <SelectItem value="traffic">Highest Traffic</SelectItem>
                      <SelectItem value="traffic-low">Lowest Traffic</SelectItem>
                      <SelectItem value="upvotes">Most Upvoted</SelectItem>
                    </SelectContent>
                  </Select>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground"
                        title={MOST_POPULAR_HELP.title}
                        aria-label={MOST_POPULAR_HELP.title}
                      >
                        <Info className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle>{MOST_POPULAR_HELP.title}</DialogTitle>
                      </DialogHeader>
                      <ul className="list-disc space-y-2 pl-4 text-sm text-muted-foreground">
                        {MOST_POPULAR_HELP.bullets.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    </DialogContent>
                  </Dialog>
                </div>
                {sort === "alphabetical" && (
                  <Select
                    value={sortOrder}
                    onValueChange={(v) => setSortOrder(v as SortOrder)}
                  >
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asc">A-Z</SelectItem>
                      <SelectItem value="desc">Z-A</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            {loading ? (
              viewMode === "grid" ? (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {[...Array(8)].map((_, i) => (
                    <div
                      key={i}
                      className="h-64 min-h-0 animate-pulse rounded-lg border bg-muted"
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {[...Array(8)].map((_, i) => (
                    <div
                      key={i}
                      className="h-[4.5rem] animate-pulse rounded-lg border bg-muted"
                    />
                  ))}
                </div>
              )
            ) : tools.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-lg text-muted-foreground">
                  No tools found. Try adjusting your filters or search.
                </p>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Showing {tools.length} tool{tools.length !== 1 ? "s" : ""}
                </p>
                <div
                  className={
                    viewMode === "grid"
                      ? "grid min-w-0 grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                      : "flex min-w-0 flex-col gap-3"
                  }
                >
                  {tools.map((tool, index) => (
                    <ToolCard
                      key={tool.id}
                      tool={tool}
                      index={index}
                      layout={viewMode}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {isAdmin && (
        <div className="fixed bottom-4 right-4 z-30 print:hidden">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 border-dashed border-amber-500/50 bg-background/90 text-xs shadow-md backdrop-blur-sm hover:bg-amber-500/10"
            title="Clears tour completion for this browser and starts the onboarding tour (admin testing only)"
            onClick={() => setTourReplayNonce((n) => n + 1)}
          >
            <GraduationCap className="h-3.5 w-3.5" />
            Test site tour
          </Button>
        </div>
      )}
      <SiteTour adminReplayNonce={tourReplayNonce} />
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col">
          <Hero />
          <div className="container mx-auto px-4 py-8">
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          </div>
        </div>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
