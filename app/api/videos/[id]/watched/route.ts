import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: videoId } = await params;
    const client = getSupabaseClient(request);
    const authHeader = request.headers.get("authorization");

    let userId: string | null = null;

    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser(token);
      if (!userError && user) {
        userId = user.id;
      }
    }

    if (!userId) {
      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser();
      if (!userError && user) {
        userId = user.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = supabaseAdmin as any;

    // Idempotent: if already watched, just return watched: true
    const { data: existing } = await admin
      .from("video_watch")
      .select("id")
      .eq("userId", userId)
      .eq("videoId", videoId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ watched: true });
    }

    const { error: insertError } = await admin.from("video_watch").insert([
      {
        userId,
        videoId,
      },
    ]);

    if (insertError) {
      console.error("Error marking watched:", insertError);
      return NextResponse.json(
        { error: "Failed to mark watched" },
        { status: 500 }
      );
    }

    return NextResponse.json({ watched: true });
  } catch (error: any) {
    console.error("Error in POST watched:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: videoId } = await params;
    const client = getSupabaseClient(request);
    const authHeader = request.headers.get("authorization");

    let userId: string | null = null;

    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser(token);
      if (!userError && user) {
        userId = user.id;
      }
    }

    if (!userId) {
      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser();
      if (!userError && user) {
        userId = user.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = supabaseAdmin as any;

    const { error: deleteError } = await admin
      .from("video_watch")
      .delete()
      .eq("userId", userId)
      .eq("videoId", videoId);

    if (deleteError) {
      console.error("Error clearing watched:", deleteError);
      return NextResponse.json(
        { error: "Failed to clear watched" },
        { status: 500 }
      );
    }

    return NextResponse.json({ watched: false });
  } catch (error: any) {
    console.error("Error in DELETE watched:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: videoId } = await params;
    const client = getSupabaseClient(request);
    const authHeader = request.headers.get("authorization");

    let userId: string | null = null;

    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser(token);
      if (!userError && user) {
        userId = user.id;
      }
    }

    if (!userId) {
      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser();
      if (!userError && user) {
        userId = user.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ watched: false });
    }

    const admin = supabaseAdmin as any;

    const { data: existing } = await admin
      .from("video_watch")
      .select("id")
      .eq("userId", userId)
      .eq("videoId", videoId)
      .maybeSingle();

    return NextResponse.json({ watched: !!existing });
  } catch (error: any) {
    console.error("Error in GET watched:", error);
    return NextResponse.json({ watched: false });
  }
}

