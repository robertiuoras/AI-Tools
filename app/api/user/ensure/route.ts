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

    const user = session.user;
    const admin = supabaseAdmin as any;

    // Check if user record exists
    const { data: existingUser } = await admin
      .from("user")
      .select("id, role")
      .eq("id", user.id)
      .single();

    if (existingUser) {
      return NextResponse.json({
        success: true,
        user: existingUser,
        created: false,
      });
    }

    // Create user record using service role (bypasses RLS)
    const name =
      user.user_metadata?.name ||
      user.user_metadata?.full_name ||
      user.user_metadata?.display_name ||
      user.email?.split("@")[0] ||
      "User";

    const { data: newUser, error: insertError } = await admin
      .from("user")
      .insert([
        {
          id: user.id,
          email: user.email!,
          name: name,
          role: "user",
        },
      ])
      .select()
      .single();

    if (insertError) {
      console.error("Error creating user record:", insertError);
      return NextResponse.json(
        { error: "Failed to create user record", details: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      user: newUser,
      created: true,
    });
  } catch (error: any) {
    console.error("Error in ensure-user:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
}

