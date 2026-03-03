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

export async function GET(request: NextRequest) {
  try {
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
      return NextResponse.json({ watchedIds: [] });
    }

    const admin = supabaseAdmin as any;

    const { data, error } = await admin
      .from("video_watch")
      .select("videoId")
      .eq("userId", userId);

    if (error) {
      console.error("Error fetching watched videos:", error);
      return NextResponse.json({ watchedIds: [] });
    }

    const watchedIds = (data || []).map((row: any) => row.videoId);

    return NextResponse.json({ watchedIds });
  } catch (error: any) {
    console.error("Error in GET /api/videos/watched:", error);
    return NextResponse.json({ watchedIds: [] });
  }
}

