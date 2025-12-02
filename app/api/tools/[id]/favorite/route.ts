import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createClient } from "@supabase/supabase-js";

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
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return client;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const client = getSupabaseClient(request);
    const authHeader = request.headers.get("authorization");
    
    let userId: string | null = null;
    
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: userError } = await client.auth.getUser(token);
      if (!userError && user) {
        userId = user.id;
      }
    }
    
    if (!userId) {
      const { data: { user }, error: userError } = await client.auth.getUser();
      if (!userError && user) {
        userId = user.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const toolId = params.id;
    const admin = supabaseAdmin as any;

    // Check if already favorited
    const { data: existing } = await admin
      .from("favorite")
      .select("id")
      .eq("userId", userId)
      .eq("toolId", toolId)
      .single();

    if (existing) {
      return NextResponse.json({ favorited: true });
    }

    // Create favorite
    const { error: insertError } = await admin.from("favorite").insert([
      {
        userId,
        toolId,
      },
    ]);

    if (insertError) {
      console.error("Error creating favorite:", insertError);
      return NextResponse.json({ error: "Failed to favorite" }, { status: 500 });
    }

    return NextResponse.json({ favorited: true });
  } catch (error: any) {
    console.error("Error in POST favorite:", error);
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
    const client = getSupabaseClient(request);
    const authHeader = request.headers.get("authorization");
    
    let userId: string | null = null;
    
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: userError } = await client.auth.getUser(token);
      if (!userError && user) {
        userId = user.id;
      }
    }
    
    if (!userId) {
      const { data: { user }, error: userError } = await client.auth.getUser();
      if (!userError && user) {
        userId = user.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const toolId = params.id;
    const admin = supabaseAdmin as any;

    // Delete favorite
    const { error: deleteError } = await admin
      .from("favorite")
      .delete()
      .eq("userId", userId)
      .eq("toolId", toolId);

    if (deleteError) {
      console.error("Error deleting favorite:", deleteError);
      return NextResponse.json(
        { error: "Failed to unfavorite" },
        { status: 500 }
      );
    }

    return NextResponse.json({ favorited: false });
  } catch (error: any) {
    console.error("Error in DELETE favorite:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const client = getSupabaseClient(request);
    const authHeader = request.headers.get("authorization");
    
    let userId: string | null = null;
    
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: userError } = await client.auth.getUser(token);
      if (!userError && user) {
        userId = user.id;
      }
    }
    
    if (!userId) {
      const { data: { user }, error: userError } = await client.auth.getUser();
      if (!userError && user) {
        userId = user.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ favorited: false });
    }

    const toolId = params.id;
    const admin = supabaseAdmin as any;

    // Check if favorited
    const { data: existing } = await admin
      .from("favorite")
      .select("id")
      .eq("userId", userId)
      .eq("toolId", toolId)
      .single();

    return NextResponse.json({ favorited: !!existing });
  } catch (error: any) {
    console.error("Error in GET favorite:", error);
    return NextResponse.json({ favorited: false });
  }
}

