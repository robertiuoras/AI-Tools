import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  getSupabaseClient,
  getUserIdFromRequest,
  todayUtcRange,
  fetchVoteSnapshot,
} from "@/lib/vote-api-helpers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: toolId } = await params;
    const client = getSupabaseClient(request);
    const userId = await getUserIdFromRequest(request, client);

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = supabaseAdmin as any;
    const { start, end } = todayUtcRange();

    const [existingDown, todayDownvoteCount] = await Promise.all([
      admin
        .from("downvote")
        .select("id")
        .eq("userId", userId)
        .eq("toolId", toolId)
        .gte("downvotedAt", start)
        .lt("downvotedAt", end)
        .maybeSingle(),
      admin
        .from("downvote")
        .select("*", { count: "exact", head: true })
        .eq("userId", userId)
        .gte("downvotedAt", start)
        .lt("downvotedAt", end),
    ]);

    if (existingDown.data) {
      return NextResponse.json(
        { error: "You have already downvoted this tool today" },
        { status: 400 },
      );
    }

    if ((todayDownvoteCount.count ?? 0) >= 3) {
      return NextResponse.json(
        {
          error: "Daily downvote limit reached",
          message:
            "You can downvote up to 3 tools per day. Resets tomorrow.",
          limit: 3,
          used: todayDownvoteCount.count ?? 0,
        },
        { status: 400 },
      );
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split("T")[0];

    await admin
      .from("upvote")
      .delete()
      .eq("userId", userId)
      .eq("toolId", toolId)
      .gte("upvotedAt", start)
      .lt("upvotedAt", end);

    const { error: insertError } = await admin.from("downvote").insert([
      {
        userId,
        toolId,
        downvotedAt: new Date().toISOString(),
        monthlyResetDate: monthStart,
      },
    ]);

    if (insertError) {
      console.error("Error creating downvote:", insertError);
      return NextResponse.json(
        { error: "Failed to downvote" },
        { status: 500 },
      );
    }

    const snap = await fetchVoteSnapshot(admin, toolId, userId);
    return NextResponse.json(snap);
  } catch (error: unknown) {
    console.error("Error in POST downvote:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: toolId } = await params;
    const client = getSupabaseClient(request);
    const userId = await getUserIdFromRequest(request, client);

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = supabaseAdmin as any;
    const { start, end } = todayUtcRange();

    const { error: deleteError } = await admin
      .from("downvote")
      .delete()
      .eq("userId", userId)
      .eq("toolId", toolId)
      .gte("downvotedAt", start)
      .lt("downvotedAt", end);

    if (deleteError) {
      console.error("Error deleting downvote:", deleteError);
      return NextResponse.json(
        { error: "Failed to remove downvote" },
        { status: 500 },
      );
    }

    const snap = await fetchVoteSnapshot(admin, toolId, userId);
    return NextResponse.json(snap);
  } catch (error: unknown) {
    console.error("Error in DELETE downvote:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
