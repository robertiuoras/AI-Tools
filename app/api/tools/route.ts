import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { toolSchema } from "@/lib/schemas";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category");
    const traffic = searchParams.getAll("traffic");
    const revenue = searchParams.getAll("revenue");
    const search = searchParams.get("search");
    const sort = searchParams.get("sort") || "alphabetical";
    const order = searchParams.get("order") || "asc";
    const favoritesOnly = searchParams.get("favoritesOnly") === "true";

    // Get current user if authenticated
    const authHeader = request.headers.get("authorization");
    let userId: string | null = null;
    if (authHeader) {
      // In a real app, you'd verify the token here
      // For now, we'll get user from session in the frontend
    }

    // Type assertion to work around Proxy type issues
    const admin = supabaseAdmin as any;

    // Build Supabase query with upvote counts
    // Note: Supabase table names are case-sensitive. Use lowercase 'tool' if that's what's in your database
    let query = admin.from("tool").select("*");

    // Apply filters
    if (category) {
      query = query.eq("category", category);
    }

    if (traffic.length > 0) {
      query = query.in("traffic", traffic);
    }

    if (revenue.length > 0) {
      query = query.in("revenue", revenue);
    }

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      // Supabase doesn't support OR queries easily, so we'll filter in memory
      // For better performance, you could use full-text search if enabled
    }

    // Apply sorting
    if (sort === "alphabetical") {
      query = query.order("name", { ascending: order === "asc" });
    } else if (sort === "newest") {
      query = query.order("createdAt", { ascending: order !== "asc" });
    } else if (sort === "popular") {
      query = query.order("rating", {
        ascending: order === "asc",
        nullsFirst: false,
      });
    } else if (sort === "traffic") {
      // Highest traffic = highest visits = descending order
      query = query.order("estimatedVisits", {
        ascending: false, // false = descending = highest first
        nullsFirst: false,
      });
    } else if (sort === "traffic-low") {
      // Lowest traffic = lowest visits = ascending order
      query = query.order("estimatedVisits", {
        ascending: true, // true = ascending = lowest first
        nullsFirst: true, // nulls first for lowest traffic
      });
    } else if (sort === "upvotes") {
      // For upvotes, we'll sort in memory after getting the data
    }

    const { data: tools, error } = await query;

    if (error) {
      console.error("❌ Supabase error fetching tools:", error);
      return NextResponse.json([], { status: 200 });
    }

    // Apply case-insensitive search filter in memory
    let filteredTools = tools || [];
    if (search) {
      const searchLower = search.toLowerCase();
      filteredTools = filteredTools.filter(
        (tool: any) =>
          tool.name?.toLowerCase().includes(searchLower) ||
          tool.description?.toLowerCase().includes(searchLower) ||
          (tool.tags && tool.tags.toLowerCase().includes(searchLower))
      );
    }

    // Filter by favorites if requested
    if (favoritesOnly) {
      const authHeader = request.headers.get("authorization");
      if (authHeader) {
        const token = authHeader.replace("Bearer ", "");
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const {
          data: { user },
        } = await userClient.auth.getUser();

        if (user) {
          // Get user's favorite tool IDs
          const { data: favorites } = await admin
            .from("favorite")
            .select("toolId")
            .eq("userId", user.id);

          const favoriteToolIds = new Set(
            (favorites || []).map((f: any) => f.toolId)
          );

          // Filter tools to only show favorites
          filteredTools = filteredTools.filter((tool: any) =>
            favoriteToolIds.has(tool.id)
          );
        } else {
          // No user, return empty array
          filteredTools = [];
        }
      } else {
        // No auth header, return empty array
        filteredTools = [];
      }
    }

    // Process tools to add upvote counts and user upvote status
    // Only count upvotes from current month
    const monthStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    )
      .toISOString()
      .split("T")[0];
    
    // Get user if authenticated (once, not per tool)
    let userId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const {
        data: { user },
      } = await userClient.auth.getUser();
      if (user) {
        userId = user.id;
      }
    }

    // Batch fetch all upvote counts at once
    const toolIds = filteredTools.map((t: any) => t.id);
    const { data: upvoteCounts } = await admin
      .from("upvote")
      .select("toolId")
      .in("toolId", toolIds)
      .gte("monthlyResetDate", monthStart);

    // Count upvotes per tool
    const upvoteCountMap = new Map<string, number>();
    (upvoteCounts || []).forEach((upvote: any) => {
      upvoteCountMap.set(upvote.toolId, (upvoteCountMap.get(upvote.toolId) || 0) + 1);
    });

    // Batch fetch user upvotes if authenticated
    let userUpvoteSet = new Set<string>();
    let userFavoriteSet = new Set<string>();
    if (userId) {
      const today = new Date().toISOString().split("T")[0];
      const { data: userUpvotes } = await admin
        .from("upvote")
        .select("toolId")
        .eq("userId", userId)
        .in("toolId", toolIds)
        .gte("upvotedAt", `${today}T00:00:00.000Z`)
        .lt("upvotedAt", `${today}T23:59:59.999Z`);
      
      (userUpvotes || []).forEach((upvote: any) => {
        userUpvoteSet.add(upvote.toolId);
      });

      // Batch fetch user favorites
      const { data: userFavorites } = await admin
        .from("favorite")
        .select("toolId")
        .eq("userId", userId)
        .in("toolId", toolIds);
      
      (userFavorites || []).forEach((favorite: any) => {
        userFavoriteSet.add(favorite.toolId);
      });
    }

    // Map results to tools
    const processedTools = filteredTools.map((tool: any) => ({
      ...tool,
      upvoteCount: upvoteCountMap.get(tool.id) || 0,
      userUpvoted: userUpvoteSet.has(tool.id),
      userFavorited: userFavoriteSet.has(tool.id),
    }));

    // Sort by upvotes if requested
    if (sort === "upvotes") {
      processedTools.sort((a: any, b: any) => {
        const aCount = a.upvoteCount || 0;
        const bCount = b.upvoteCount || 0;
        return order === "desc" ? bCount - aCount : aCount - bCount;
      });
    }

    return NextResponse.json(processedTools);
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
