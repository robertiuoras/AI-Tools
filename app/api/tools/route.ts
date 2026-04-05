import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { toolSchema } from "@/lib/schemas";
import { toolCategoryList, toolIsAgency } from "@/lib/tool-categories";
import { createClient } from "@supabase/supabase-js";
import {
  getLocalMonthStartIso,
  popularityScore,
} from "@/lib/tool-popularity";

/** Logged-in users see favorited tools first; order within each group is unchanged. */
function sortWithFavoritesFirst<T extends { userFavorited?: boolean }>(
  items: T[],
): T[] {
  const fav = items.filter((x) => x.userFavorited);
  const rest = items.filter((x) => !x.userFavorited);
  return [...fav, ...rest];
}

function jsonbCountsToMap(obj: unknown): Map<string, number> {
  const m = new Map<string, number>();
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isNaN(n)) m.set(k, n);
    }
  }
  return m;
}

/** One DB round-trip for all tools’ monthly vote totals (see supabase/sql/supabase-batch-vote-counts.sql). */
async function fetchMonthlyVoteCountMaps(
  admin: any,
  toolIds: string[],
  monthStartIso: string,
): Promise<{ up: Map<string, number>; down: Map<string, number> }> {
  const empty = () => ({
    up: new Map<string, number>(),
    down: new Map<string, number>(),
  });
  if (toolIds.length === 0) return empty();

  const { data: rpcData, error: rpcErr } = await admin.rpc(
    "batch_monthly_vote_counts",
    {
      p_tool_ids: toolIds,
      p_month_start: monthStartIso,
    },
  );

  if (!rpcErr && rpcData && typeof rpcData === "object") {
    const row = rpcData as { upvotes?: unknown; downvotes?: unknown };
    return {
      up: jsonbCountsToMap(row.upvotes),
      down: jsonbCountsToMap(row.downvotes),
    };
  }

  if (rpcErr?.message) {
    console.warn(
      "[tools GET] batch_monthly_vote_counts RPC skipped:",
      rpcErr.message,
    );
  }

  const upvoteCountMap = new Map<string, number>();
  const downvoteCountMap = new Map<string, number>();
  const [upvoteRes, downvoteRes] = await Promise.all([
    admin
      .from("upvote")
      .select("toolId")
      .in("toolId", toolIds)
      .gte("upvotedAt", monthStartIso),
    admin
      .from("downvote")
      .select("toolId")
      .in("toolId", toolIds)
      .gte("downvotedAt", monthStartIso),
  ]);

  if (upvoteRes.error) {
    console.error("❌ Upvote batch fetch failed:", upvoteRes.error);
  } else {
    (upvoteRes.data || []).forEach((row: { toolId: string }) => {
      upvoteCountMap.set(
        row.toolId,
        (upvoteCountMap.get(row.toolId) || 0) + 1,
      );
    });
  }

  if (downvoteRes.error) {
    console.error("❌ Downvote batch fetch failed:", downvoteRes.error);
  } else {
    (downvoteRes.data || []).forEach((row: { toolId: string }) => {
      downvoteCountMap.set(
        row.toolId,
        (downvoteCountMap.get(row.toolId) || 0) + 1,
      );
    });
  }

  return { up: upvoteCountMap, down: downvoteCountMap };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const categories = searchParams
      .getAll("category")
      .map((c) => c.trim())
      .filter(Boolean);
    const traffic = searchParams.getAll("traffic");
    const revenue = searchParams.getAll("revenue");
    const sort = searchParams.get("sort") || "popular";
    const order = searchParams.get("order") || "desc";
    const favoritesOnly = searchParams.get("favoritesOnly") === "true";
    const agenciesOnly = searchParams.get("agenciesOnly") === "true";

    // Get authorization header (used later for user authentication)
    const authHeader = request.headers.get("authorization");

    const userIdPromise = (async (): Promise<string | null> => {
      if (!authHeader) return null;
      try {
        const token = authHeader.replace("Bearer ", "");
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const {
          data: { user },
        } = await userClient.auth.getUser();
        return user?.id ?? null;
      } catch {
        return null;
      }
    })();

    // Type assertion to work around Proxy type issues
    const admin = supabaseAdmin as any;

    // Build Supabase query with upvote counts
    // Note: Supabase table names are case-sensitive. Use lowercase 'tool' if that's what's in your database
    let query = admin.from("tool").select("*");

    // Apply filters
    if (traffic.length > 0) {
      query = query.in("traffic", traffic);
    }

    if (revenue.length > 0) {
      query = query.in("revenue", revenue);
    }

    // DB ordering: use stable columns only. "popular" / "upvotes" are sorted in memory
    // after monthly upvote counts are attached (avoids bad SQL + null rating issues).
    if (sort === "alphabetical") {
      query = query.order("name", { ascending: order === "asc" });
    } else if (sort === "newest") {
      // desc = newest first (align with default order=desc when switching sort in UI)
      query = query.order("createdAt", { ascending: order === "asc" });
    } else if (sort === "traffic") {
      query = query.order("estimatedVisits", {
        ascending: false,
        nullsFirst: false,
      });
    } else if (sort === "traffic-low") {
      query = query.order("estimatedVisits", {
        ascending: true,
        nullsFirst: true,
      });
    } else if (sort === "popular" || sort === "upvotes") {
      query = query.order("createdAt", { ascending: false });
    }

    const [{ data: tools, error }, userId] = await Promise.all([
      query,
      userIdPromise,
    ]);

    if (error) {
      console.error("❌ Supabase error fetching tools:", error);
      // 200 + [] keeps the UI stable; check server logs for the real error
      return NextResponse.json([], { status: 200 });
    }

    // Search runs client-side on the home page (instant typing, no refetch per keystroke).
    let filteredTools = tools || [];

    // Category filter is evaluated in memory so it correctly matches any item in categories[].
    if (categories.length > 0) {
      const needles = new Set(categories.map((c) => c.toLowerCase()));
      filteredTools = filteredTools.filter((tool: any) =>
        toolCategoryList(tool).some((c) => needles.has(c.toLowerCase())),
      );
    }

    // Filter by favorites if requested (single auth resolution via userIdPromise)
    if (favoritesOnly) {
      if (!userId) {
        filteredTools = [];
      } else {
        const { data: favorites } = await admin
          .from("favorite")
          .select("toolId")
          .eq("userId", userId);

        const favoriteToolIds = new Set(
          (favorites || []).map((f: any) => f.toolId),
        );

        filteredTools = filteredTools.filter((tool: any) =>
          favoriteToolIds.has(tool.id),
        );
      }
    }

    if (agenciesOnly) {
      filteredTools = filteredTools.filter((tool: any) => toolIsAgency(tool));
    }

    if (filteredTools.length === 0) {
      return NextResponse.json([]);
    }

    // Monthly upvote window: `upvotedAt` in current local calendar month (matches UX).
    const monthStartIso = getLocalMonthStartIso();

    const toolIds = filteredTools.map((t: { id: string }) => t.id);

    const { up: upvoteCountMap, down: downvoteCountMap } =
      await fetchMonthlyVoteCountMaps(admin, toolIds, monthStartIso);

    let userUpvoteSet = new Set<string>();
    let userDownvoteSet = new Set<string>();
    let userFavoriteSet = new Set<string>();
    if (userId) {
      const today = new Date().toISOString().split("T")[0];
      const dayStart = `${today}T00:00:00.000Z`;
      const dayEnd = `${today}T23:59:59.999Z`;

      const [userUpRes, userDownRes, userFavRes] = await Promise.all([
        admin
          .from("upvote")
          .select("toolId")
          .eq("userId", userId)
          .in("toolId", toolIds)
          .gte("upvotedAt", dayStart)
          .lt("upvotedAt", dayEnd),
        admin
          .from("downvote")
          .select("toolId")
          .eq("userId", userId)
          .in("toolId", toolIds)
          .gte("downvotedAt", dayStart)
          .lt("downvotedAt", dayEnd),
        admin
          .from("favorite")
          .select("toolId")
          .eq("userId", userId)
          .in("toolId", toolIds),
      ]);

      (userUpRes.data || []).forEach((row: { toolId: string }) => {
        userUpvoteSet.add(row.toolId);
      });
      (userDownRes.data || []).forEach((row: { toolId: string }) => {
        userDownvoteSet.add(row.toolId);
      });
      (userFavRes.data || []).forEach((row: { toolId: string }) => {
        userFavoriteSet.add(row.toolId);
      });
    }

    const processedTools = filteredTools.map((tool: any) => {
      const cats = toolCategoryList(tool);
      return {
        ...tool,
        categories: cats,
        category: cats[0],
        upvoteCount: upvoteCountMap.get(tool.id) || 0,
      downvoteCount: downvoteCountMap.get(tool.id) || 0,
      userUpvoted: userUpvoteSet.has(tool.id),
      userDownvoted: userDownvoteSet.has(tool.id),
      userFavorited: userFavoriteSet.has(tool.id),
      };
    });

    if (sort === "upvotes") {
      processedTools.sort((a: { upvoteCount?: number }, b: { upvoteCount?: number }) => {
        const aCount = a.upvoteCount || 0;
        const bCount = b.upvoteCount || 0;
        return order === "desc" ? bCount - aCount : aCount - bCount;
      });
    }

    if (sort === "popular") {
      type Row = {
        upvoteCount?: number;
        estimatedVisits?: number | null;
        rating?: number | null;
      };
      processedTools.sort(
        (a: Row, b: Row) => popularityScore(b) - popularityScore(a),
      );
    }

    return NextResponse.json(sortWithFavoritesFirst(processedTools));
  } catch (error) {
    console.error("❌ Error fetching tools:", error);
    console.error(
      "Error type:",
      error instanceof Error ? error.name : typeof error
    );
    console.error(
      "Error message:",
      error instanceof Error ? error.message : String(error)
    );

    // Return empty array with 200 status to prevent frontend crashes
    // The frontend will show "No tools found" which is better UX than crashing
    // In production, you might want to log this to an error tracking service
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log("Received tool data:", body);

    const validatedData = toolSchema.parse(body);
    console.log("Validated data:", validatedData);

    // Generate ID for Supabase (Supabase doesn't auto-generate like Prisma)
    const id = randomUUID();

    // Prepare data for Supabase - ensure types match schema exactly
    const supabaseData: any = {
      id,
      name: validatedData.name,
      description: validatedData.description,
      url: validatedData.url,
      category: validatedData.category,
      categories: validatedData.categories,
      isAgency: validatedData.isAgency,
    };

    // Handle optional fields - convert empty strings to null
    if (validatedData.logoUrl && validatedData.logoUrl.trim()) {
      supabaseData.logoUrl = validatedData.logoUrl.trim();
    } else {
      supabaseData.logoUrl = null;
    }

    if (validatedData.tags && validatedData.tags.trim()) {
      supabaseData.tags = validatedData.tags.trim();
    } else {
      supabaseData.tags = null;
    }

    if (validatedData.traffic) {
      supabaseData.traffic = validatedData.traffic;
    } else {
      supabaseData.traffic = null;
    }

    if (validatedData.revenue) {
      supabaseData.revenue = validatedData.revenue;
    } else {
      supabaseData.revenue = null;
    }

    if (validatedData.rating !== undefined && validatedData.rating !== null) {
      supabaseData.rating = validatedData.rating;
    } else {
      supabaseData.rating = null;
    }

    if (
      validatedData.estimatedVisits !== undefined &&
      validatedData.estimatedVisits !== null
    ) {
      supabaseData.estimatedVisits = validatedData.estimatedVisits;
    } else {
      supabaseData.estimatedVisits = null;
    }

    // Add timestamps
    const now = new Date().toISOString();
    supabaseData.createdAt = now;
    supabaseData.updatedAt = now;

    console.log("Supabase data:", JSON.stringify(supabaseData, null, 2));

    // Type assertion to work around Proxy type issues
    const admin = supabaseAdmin as any;

    // Check for duplicate URL before inserting
    const normalizedUrl = validatedData.url
      .trim()
      .toLowerCase()
      .replace(/\/$/, "");
    const { data: existingTools } = await admin
      .from("tool")
      .select("id, url")
      .ilike("url", `%${normalizedUrl}%`);

    // Check if any existing tool has the same normalized URL
    const toolsArray = (existingTools || []) as Array<{
      id: string;
      url: string;
    }>;
    if (toolsArray.length > 0) {
      const isDuplicate = toolsArray.some((t) => {
        const existingNormalized = t.url.toLowerCase().replace(/\/$/, "");
        return existingNormalized === normalizedUrl;
      });

      if (isDuplicate) {
        return NextResponse.json(
          {
            error: "Duplicate URL",
            message: "A tool with this URL already exists",
            details: "Please use a different URL or edit the existing tool",
          },
          { status: 409 }
        );
      }
    }

    const { data: tool, error } = await admin
      .from("tool")
      .insert(supabaseData)
      .select()
      .single();

    if (error) {
      console.error("❌ Supabase error creating tool:", error);
      return NextResponse.json(
        {
          error: "Failed to create tool",
          message: error.message,
          details: error,
        },
        { status: 500 }
      );
    }

    console.log("Tool created successfully:", tool?.id);
    return NextResponse.json(tool, { status: 201 });
  } catch (error) {
    console.error("Error creating tool:", error);
    console.error("Error type:", typeof error);
    console.error(
      "Error name:",
      error instanceof Error ? error.name : "Unknown"
    );
    console.error(
      "Full error:",
      JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
    );

    // Handle Zod validation errors
    if (error && typeof error === "object" && "issues" in error) {
      const zodError = error as {
        issues: Array<{ path: string[]; message: string }>;
      };
      const errorMessages = zodError.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ");

      return NextResponse.json(
        {
          error: "Validation error",
          details: errorMessages,
          issues: zodError.issues,
        },
        { status: 400 }
      );
    }

    // Handle Supabase errors
    if (error instanceof Error) {
      console.error("Supabase error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });

      // Extract more details from Supabase errors
      let errorMessage = error.message;
      if (
        error.message.includes("Invalid") ||
        error.message.includes("violates")
      ) {
        errorMessage = `Database error: ${error.message}. Check that all required fields are provided and data types are correct.`;
      }

      return NextResponse.json(
        {
          error: "Failed to create tool",
          message: errorMessage,
          details: error.stack,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        error: "Failed to create tool",
        message: "Unknown error",
        details: String(error),
      },
      { status: 500 }
    );
  }
}
