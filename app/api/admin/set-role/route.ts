import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";

// Mark this route as dynamic
export const dynamic = "force-dynamic";

// Helper to get authenticated user
function getSupabaseClient(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  });

  return client;
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { userId, role } = body;

    if (!userId || !role || !["user", "admin"].includes(role)) {
      return NextResponse.json(
        { error: "Invalid request. userId and role (user/admin) required." },
        { status: 400 }
      );
    }

    // Check if requester is admin (optional - you might want to allow self-promotion for first user)
    // For now, we'll allow it if the user is setting their own role or if there are no admins yet
    const admin = supabaseAdmin as any;

    // Check if there are any admins
    const { count: adminCount } = await admin
      .from("user")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin");

    // Allow if: user is setting their own role, OR there are no admins yet
    const isSelfUpdate = session.user.id === userId;
    const noAdmins = !adminCount || adminCount === 0;

    if (!isSelfUpdate && !noAdmins) {
      // Check if requester is admin
      const { data: requesterData } = await admin
        .from("user")
        .select("role")
        .eq("id", session.user.id)
        .single();

      if (requesterData?.role !== "admin") {
        return NextResponse.json(
          { error: "Only admins can change other users' roles" },
          { status: 403 }
        );
      }
    }

    // Update user role
    const { data, error } = await admin
      .from("user")
      .update({ role })
      .eq("id", userId)
      .select()
      .single();

    if (error) {
      console.error("Error updating user role:", error);
      return NextResponse.json(
        { error: "Failed to update role" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      user: data,
    });
  } catch (error: any) {
    console.error("Error in set-role:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
