"use client";

import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  Suspense,
} from "react";
import { useRouter } from "next/navigation";
import { Hero } from "@/components/Hero";
import { TopLoadingBar } from "@/components/TopLoadingBar";
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
import {
  GraduationCap,
  Info,
  LayoutGrid,
  List,
  RefreshCw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SiteTour } from "@/components/SiteTour";
import { MOST_POPULAR_HELP } from "@/lib/tool-popularity";
import type { ToolCardLayout } from "@/components/ToolCard";
import { supabase } from "@/lib/supabase";
import type { Tool } from "@/lib/supabase";
import { toolCategoryList, toolIsAgency } from "@/lib/tool-categories";
import {
  AGENCY_CATEGORY_LABEL,
  categories as defaultCategories,
  sortToolCategoryLabelsForDisplay,
} from "@/lib/schemas";

type SortOption = "alphabetical" | "newest" | "popular" | "traffic" | "traffic-low" | "upvotes";
type SortOrder = "asc" | "desc";

const TOOLS_VIEW_STORAGE_KEY = "ai-tools-view";
const TOOLS_LIST_CACHE_PREFIX = "ai-tools-list:v1";
const REFRESH_ALL_STEPS = 50;

function toolsListCacheKey(sort: SortOption, order: SortOrder) {
  return `${TOOLS_LIST_CACHE_PREFIX}:${sort}:${order}`;
}

function normalizeToolFromApi(raw: Record<string, unknown>): Tool {
  const d =
    typeof raw.description === "string"
      ? raw.description
      : raw.description != null
        ? String(raw.description)
        : typeof raw.Description === "string"
          ? raw.Description
          : "";
  return { ...raw, description: d } as Tool;
}

/** Match Tailwind breakpoints for tool grid columns (sm/lg/xl). */
function useToolGridColumnCount() {
  const [cols, setCols] = useState(4);
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w < 640) setCols(1);
      else if (w < 1024) setCols(2);
      else if (w < 1280) setCols(3);
      else setCols(4);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return cols;
}

function HomePageContent() {
  const router = useRouter();
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedTraffic, setSelectedTraffic] = useState<string[]>([]);
  const [selectedRevenue, setSelectedRevenue] = useState<string[]>([]);
  const [sort, setSort] = useState<SortOption>("popular");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [agenciesOnly, setAgenciesOnly] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tourReplayNonce, setTourReplayNonce] = useState(0);
  const [viewMode, setViewMode] = useState<ToolCardLayout>("grid");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshAllOpen, setRefreshAllOpen] = useState(false);
  const [refreshAllStep, setRefreshAllStep] = useState({
    step: 0,
    total: REFRESH_ALL_STEPS,
  });
  const toolGridCols = useToolGridColumnCount();
  const toolsRef = useRef<Tool[]>([]);
  toolsRef.current = tools;
  const refreshModalBlockingRef = useRef(false);
  const prevToolsCacheKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const key = toolsListCacheKey(sort, sortOrder);
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const data = JSON.parse(stored) as unknown;
        if (Array.isArray(data) && data.length > 0) {
          setTools(
            data.map((row) => normalizeToolFromApi(row as Record<string, unknown>)),
          );
          setLoading(false);
          prevToolsCacheKeyRef.current = key;
          return;
        }
      }
    } catch {
      /* ignore */
    }
    if (
      prevToolsCacheKeyRef.current !== null &&
      prevToolsCacheKeyRef.current !== key
    ) {
      setTools([]);
      setLoading(true);
    }
    prevToolsCacheKeyRef.current = key;
  }, [sort, sortOrder]);

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
    const cats = tools
      .flatMap((t) => toolCategoryList(t))
      .filter((c) => c !== AGENCY_CATEGORY_LABEL);
    return Array.from(new Set([...names, ...cats]));
  }, [tools]);

  /** Union of default + every category on any loaded tool (full list; filters applied client-side). */
  const availableCategories = useMemo(() => {
    const seen = new Set<string>();
    for (const c of defaultCategories) {
      if (c !== AGENCY_CATEGORY_LABEL) seen.add(c);
    }
    for (const t of tools) {
      for (const c of toolCategoryList(t)) {
        const x = c?.trim();
        if (x && x !== AGENCY_CATEGORY_LABEL) seen.add(x);
      }
    }
    for (const c of selectedCategories) {
      const x = c?.trim();
      if (x && x !== AGENCY_CATEGORY_LABEL) seen.add(x);
    }
    return sortToolCategoryLabelsForDisplay(Array.from(seen));
  }, [tools, selectedCategories]);

  useEffect(() => {
    setSelectedCategories((prev) =>
      prev.filter((c) => c !== AGENCY_CATEGORY_LABEL),
    );
  }, []);

  /** Sidebar filters (client-side so category checklist stays complete while filtering). */
  const sidebarFilteredTools = useMemo(() => {
    let list = tools;
    if (selectedCategories.length > 0) {
      const needles = new Set(
        selectedCategories.map((c) => c.toLowerCase()),
      );
      list = list.filter((t) =>
        toolCategoryList(t).some((c) => needles.has(c.toLowerCase())),
      );
    }
    if (selectedTraffic.length > 0) {
      list = list.filter(
        (t) =>
          t.traffic != null && selectedTraffic.includes(t.traffic),
      );
    }
    if (selectedRevenue.length > 0) {
      list = list.filter(
        (t) =>
          t.revenue != null && selectedRevenue.includes(t.revenue),
      );
    }
    if (favoritesOnly) {
      list = list.filter((t) => t.userFavorited === true);
    }
    if (agenciesOnly) {
      list = list.filter((t) => toolIsAgency(t));
    }
    return list;
  }, [
    tools,
    selectedCategories,
    selectedTraffic,
    selectedRevenue,
    favoritesOnly,
    agenciesOnly,
  ]);

  const toolsAddedTodayCount = useMemo(() => {
    if (tools.length === 0) return 0;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return tools.filter((t) => {
      const created = new Date(t.createdAt);
      return !Number.isNaN(created.getTime()) && created >= start;
    }).length;
  }, [tools]);

  /** Search filters in the browser — no network per keystroke (fast vs full refetch + loading). */
  const displayedTools = useMemo(() => {
    const raw = search.trim();
    const q = raw.toLowerCase();
    if (!q) return sidebarFilteredTools;
    const matches = sidebarFilteredTools.filter(
      (t) =>
        t.name?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        (t.tags && t.tags.toLowerCase().includes(q)) ||
        toolCategoryList(t).some((c) => c.toLowerCase().includes(q)),
    );
    // Picking a suggestion often sets the full tool name — show that tool alone when unambiguous
    const exactName = matches.filter(
      (t) => t.name?.toLowerCase() === q,
    );
    if (exactName.length === 1) return exactName;
    return matches;
  }, [sidebarFilteredTools, search]);

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
    const hadCachedTools = toolsRef.current.length > 0;
    if (hadCachedTools) setRefreshing(true);
    else setLoading(true);
    try {
      const params = new URLSearchParams();
      // Category / traffic / revenue / agencies / favorites: applied client-side so the
      // filter list always reflects every label present in the loaded directory.
      params.append("sort", sort);
      params.append("order", sortOrder);

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

      // Ensure data is an array; normalize description from API/DB (full text)
      if (Array.isArray(data)) {
        setTools(data.map((raw) => normalizeToolFromApi(raw)));
        try {
          localStorage.setItem(
            toolsListCacheKey(sort, sortOrder),
            JSON.stringify(data),
          );
        } catch {
          /* ignore */
        }
      } else {
        console.error("Invalid response format:", data);
        setTools([]);
      }
    } catch (error) {
      console.error("Error fetching tools:", error);
      setTools([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sort, sortOrder, user?.id]);

  const handleRefreshAll = useCallback(async () => {
    refreshModalBlockingRef.current = true;
    setRefreshAllOpen(true);
    setRefreshAllStep({ step: 0, total: REFRESH_ALL_STEPS });
    let step = 0;
    const intervalId = window.setInterval(() => {
      step = Math.min(step + 1, REFRESH_ALL_STEPS - 1);
      setRefreshAllStep({ step, total: REFRESH_ALL_STEPS });
    }, 40);
    try {
      await fetchTools();
    } finally {
      window.clearInterval(intervalId);
      setRefreshAllStep({
        step: REFRESH_ALL_STEPS,
        total: REFRESH_ALL_STEPS,
      });
      await new Promise((r) => window.setTimeout(r, 320));
      refreshModalBlockingRef.current = false;
      setRefreshAllOpen(false);
    }
  }, [fetchTools]);

  useEffect(() => {
    void fetchTools();
  }, [fetchTools]);

  return (
    <div className="flex min-h-screen flex-col">
      <TopLoadingBar visible={loading && tools.length === 0} />
      <Hero toolsAddedTodayCount={toolsAddedTodayCount} />
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="lg:w-80">
            <FilterSidebar
              selectedCategories={selectedCategories}
              onCategoriesChange={setSelectedCategories}
              selectedTraffic={selectedTraffic}
              onTrafficChange={setSelectedTraffic}
              selectedRevenue={selectedRevenue}
              onRevenueChange={setSelectedRevenue}
              favoritesOnly={favoritesOnly}
              onFavoritesToggle={() => setFavoritesOnly(!favoritesOnly)}
              agenciesOnly={agenciesOnly}
              onAgenciesToggle={() => setAgenciesOnly(!agenciesOnly)}
              user={user}
              availableCategories={availableCategories}
            />
          </div>

          <div className="flex-1 space-y-6">
            <div className="scroll-mt-24 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex-1 max-w-2xl space-y-1" data-tutorial="search-bar">
                <SearchBar
                  value={search}
                  onChange={setSearch}
                  suggestions={searchSuggestions}
                />
                {refreshing ? (
                  <p
                    className="pl-3 text-[11px] text-muted-foreground"
                    aria-live="polite"
                  >
                    Updating list…
                  </p>
                ) : null}
              </div>
              <UpvoteTimer />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1.5"
                disabled={refreshing || refreshAllOpen}
                onClick={() => void handleRefreshAll()}
                title="Reload tools from the server"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshing || refreshAllOpen ? "animate-spin" : ""}`}
                />
                Refresh all
              </Button>
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

            <div className="min-h-[8rem] space-y-4 scroll-mt-24">
              {loading && tools.length === 0 ? (
                viewMode === "grid" ? (
                  <>
                    <div
                      data-tutorial="tool-results-first-row"
                      className="grid min-w-0 grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                    >
                      {Array.from({ length: toolGridCols }).map((_, i) => (
                        <div
                          key={`s1-${i}`}
                          className="h-64 min-h-0 animate-pulse rounded-lg border bg-muted"
                        />
                      ))}
                    </div>
                    <div className="grid min-w-0 grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {Array.from({
                        length: Math.max(0, 8 - toolGridCols),
                      }).map((_, i) => (
                        <div
                          key={`s2-${i}`}
                          className="h-64 min-h-0 animate-pulse rounded-lg border bg-muted"
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      data-tutorial="tool-results-first-row"
                      className="flex min-w-0 flex-col gap-3"
                    >
                      <div className="h-[4.5rem] animate-pulse rounded-lg border bg-muted" />
                    </div>
                    <div className="flex min-w-0 flex-col gap-3">
                      {[...Array(7)].map((_, i) => (
                        <div
                          key={i}
                          className="h-[4.5rem] animate-pulse rounded-lg border bg-muted"
                        />
                      ))}
                    </div>
                  </>
                )
              ) : tools.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-lg text-muted-foreground">
                    No tools found. Try again later or refresh the list.
                  </p>
                </div>
              ) : sidebarFilteredTools.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-lg text-muted-foreground">
                    No tools match your current filters. Adjust or clear filters
                    in the sidebar.
                  </p>
                </div>
              ) : displayedTools.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <p className="text-lg text-muted-foreground">
                    No tools match &ldquo;{search.trim()}&rdquo;. Try different
                    keywords or clear the search.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Showing {displayedTools.length} tool
                    {displayedTools.length !== 1 ? "s" : ""}
                    {search.trim() &&
                    sidebarFilteredTools.length !== displayedTools.length
                      ? ` (${sidebarFilteredTools.length} match current filters)`
                      : ""}
                  </p>
                  {(() => {
                    const firstRowCount =
                      viewMode === "list" ? 1 : toolGridCols;
                    const firstSlice = displayedTools.slice(0, firstRowCount);
                    const restSlice = displayedTools.slice(firstRowCount);
                    const gridClass =
                      viewMode === "grid"
                        ? "grid min-w-0 grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                        : "flex min-w-0 flex-col gap-3";
                    return (
                      <>
                        <div
                          data-tutorial="tool-results-first-row"
                          className={gridClass}
                        >
                          {firstSlice.map((tool, index) => (
                            <ToolCard
                              key={tool.id}
                              tool={tool}
                              index={index}
                              layout={viewMode}
                            />
                          ))}
                        </div>
                        {restSlice.length > 0 ? (
                          <div className={gridClass}>
                            {restSlice.map((tool, index) => (
                              <ToolCard
                                key={tool.id}
                                tool={tool}
                                index={firstSlice.length + index}
                                layout={viewMode}
                              />
                            ))}
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                </>
              )}
            </div>
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

      <Dialog
        open={refreshAllOpen}
        onOpenChange={(open) => {
          if (!open && refreshModalBlockingRef.current) return;
          setRefreshAllOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>Refreshing tools</DialogTitle>
            <DialogDescription>
              Reloading the full list from the server. This may take a few
              seconds on slow connections.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p
              className="text-center text-2xl font-semibold tabular-nums tracking-tight"
              aria-live="polite"
            >
              {refreshAllStep.step}/{refreshAllStep.total}
            </p>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={refreshAllStep.step}
              aria-valuemin={0}
              aria-valuemax={refreshAllStep.total}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                style={{
                  width: `${(refreshAllStep.step / refreshAllStep.total) * 100}%`,
                }}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
