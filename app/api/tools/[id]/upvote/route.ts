import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";

// Create a client that can read auth tokens from cookies
function getSupabaseClient(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // Get auth token from Authorization header or cookie
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  });

  return client;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Get user from session
    const client = getSupabaseClient(request);
    const {
      data: { session },
      error: sessionError,
    } = await client.auth.getSession();

    if (sessionError || !session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const toolId = params.id;

    // Type assertion to work around Proxy type issues
    const admin = supabaseAdmin as any;

    // Check if user has already upvoted this tool today
    const today = new Date().toISOString().split("T")[0];
    const { data: existing } = await admin
      .from("upvote")
      .select("id")
      .eq("userId", userId)
      .eq("toolId", toolId)
      .gte("upvotedAt", `${today}T00:00:00.000Z`)
      .lt("upvotedAt", `${today}T23:59:59.999Z`)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: "You have already upvoted this tool today" },
        { status: 400 }
      );
    }

    // Check if user has reached daily limit (3 upvotes per day)
    const { count: todayUpvoteCount } = await admin
      .from("upvote")
      .select("*", { count: "exact", head: true })
      .eq("userId", userId)
      .gte("upvotedAt", `${today}T00:00:00.000Z`)
      .lt("upvotedAt", `${today}T23:59:59.999Z`);

    if (todayUpvoteCount && todayUpvoteCount >= 3) {
      return NextResponse.json(
        {
          error: "Daily upvote limit reached",
          message:
            "You can upvote up to 3 different tools per day. Your upvotes will reset tomorrow.",
          limit: 3,
          used: todayUpvoteCount,
        },
        { status: 400 }
      );
    }

    // Get current month start date for monthly reset tracking
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split("T")[0];

    // Create upvote with timestamps
    const { error: insertError } = await admin.from("upvote").insert([
      {
        userId,
        toolId,
        upvotedAt: new Date().toISOString(),
        monthlyResetDate: monthStart,
      },
    ]);

    if (insertError) {
      console.error("Error creating upvote:", insertError);
      return NextResponse.json({ error: "Failed to upvote" }, { status: 500 });
    }

    // Get updated upvote count (only from current month)
    // Reuse monthStart variable defined above
    const { count } = await admin
      .from("upvote")
      .select("*", { count: "exact", head: true })
      .eq("toolId", toolId)
      .gte("monthlyResetDate", monthStart);

    return NextResponse.json({
      upvoteCount: count || 0,
      userUpvoted: true,
    });
  } catch (error: any) {
    console.error("Error in POST upvote:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Get user from session
    const client = getSupabaseClient(request);
    const {
      data: { session },
      error: sessionError,
    } = await client.auth.getSession();

    if (sessionError || !session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const toolId = params.id;

    // Type assertion to work around Proxy type issues
    const admin = supabaseAdmin as any;

    // Delete upvote (only today's upvote can be removed)
    const today = new Date().toISOString().split("T")[0];
    const { error: deleteError } = await admin
      .from("upvote")
      .delete()
      .eq("userId", userId)
      .eq("toolId", toolId)
      .gte("upvotedAt", `${today}T00:00:00.000Z`)
      .lt("upvotedAt", `${today}T23:59:59.999Z`);

    if (deleteError) {
      console.error("Error deleting upvote:", deleteError);
      return NextResponse.json(
        { error: "Failed to remove upvote" },
        { status: 500 }
      );
    }

    // Get updated upvote count (only from current month)
    const monthStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    )
      .toISOString()
      .split("T")[0];
    const { count } = await admin
      .from("upvote")
      .select("*", { count: "exact", head: true })
      .eq("toolId", toolId)
      .gte("monthlyResetDate", monthStart);

    // Check if user still has an upvote today (after deletion)
    const { count: userUpvoteCount } = await admin
      .from("upvote")
      .select("*", { count: "exact", head: true })
      .eq("userId", userId)
      .eq("toolId", toolId)
      .gte("upvotedAt", `${today}T00:00:00.000Z`)
      .lt("upvotedAt", `${today}T23:59:59.999Z`);

    return NextResponse.json({
      upvoteCount: count || 0,
      userUpvoted: (userUpvoteCount || 0) > 0,
    });
  } catch (error: any) {
    console.error("Error in DELETE upvote:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
