import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeVideoCategory, videoSchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category");
    const youtuber = searchParams.get("youtuber");
    const search = searchParams.get("search");
    const source = searchParams.get("source"); // 'youtube' | 'tiktok'
    const sort = searchParams.get("sort") || "newest";
    const order = searchParams.get("order") || "desc";

    const admin = supabaseAdmin as any;

    let query = admin.from("video").select("*");

    if (category) {
      query = query.eq("category", category);
    }

    if (source === "youtube" || source === "tiktok") {
      query = query.eq("source", source);
    }

    if (youtuber) {
      query = query.ilike("youtuberName", youtuber);
    }

    // Sorting
    if (sort === "alphabetical") {
      query = query.order("title", { ascending: order === "asc" });
    } else if (sort === "subscribers") {
      query = query.order("subscriberCount", {
        ascending: order === "asc",
        nullsFirst: false,
      });
    } else {
      // newest
      query = query.order("createdAt", { ascending: order === "asc" });
    }

    const { data: videos, error } = await query;

    if (error) {
      console.error("❌ Supabase error fetching videos:", error);
      return NextResponse.json([], { status: 200 });
    }

    let filtered = videos || [];

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((video: any) => {
        return (
          video.title?.toLowerCase().includes(q) ||
          video.description?.toLowerCase().includes(q) ||
          video.tags?.toLowerCase().includes(q) ||
          video.youtuberName?.toLowerCase().includes(q)
        );
      });
    }

    filtered = filtered.map((video: any) => ({
      ...video,
      category: normalizeVideoCategory(video.category),
    }));

    return NextResponse.json(filtered);
  } catch (error) {
    console.error("❌ Error fetching videos:", error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = videoSchema.parse(body);

    const id = randomUUID();
    const now = new Date().toISOString();

    const admin = supabaseAdmin as any;

    const source = validated.source ?? "youtube";
    const baseData: Record<string, unknown> = {
      id,
      title: validated.title,
      url: validated.url,
      category: validated.category,
      source,
      youtuberName: validated.youtuberName ?? null,
      subscriberCount: validated.subscriberCount ?? null,
      tags: validated.tags ?? null,
      description: validated.description ?? null,
      createdAt: now,
      updatedAt: now,
    };
    const supabaseData: Record<string, unknown> = {
      ...baseData,
      channelThumbnailUrl: validated.channelThumbnailUrl ?? null,
      channelVideoCount: validated.channelVideoCount ?? null,
      verified: validated.verified ?? null,
    };

    // Prevent duplicate URLs
    const normalizedUrl = validated.url.trim().toLowerCase().replace(/\/$/, "");
    const { data: existing } = await admin
      .from("video")
      .select("id, url")
      .ilike("url", `%${normalizedUrl}%`);

    const existingArray = (existing || []) as Array<{ id: string; url: string }>;
    if (existingArray.length > 0) {
      const isDuplicate = existingArray.some((v) => {
        const existingNormalized = v.url.toLowerCase().replace(/\/$/, "");
        return existingNormalized === normalizedUrl;
      });

      if (isDuplicate) {
        return NextResponse.json(
          {
            error: "Duplicate URL",
            message: "A video with this URL already exists",
          },
          { status: 409 }
        );
      }
    }

    let { data: video, error } = await admin.from("video").insert(supabaseData).select().single();

    if (error) {
      console.error("❌ Supabase error creating video:", error);
      return NextResponse.json(
        { error: "Failed to create video", message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(video, { status: 201 });
  } catch (error: any) {
    console.error("❌ Error creating video:", error);

    if (error && typeof error === "object" && "issues" in error) {
      const zodError = error as {
        issues: Array<{ path: string[]; message: string }>;
      };
      const details = zodError.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ");

      return NextResponse.json(
        {
          error: "Validation error",
          details,
          issues: zodError.issues,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: "Failed to create video",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

