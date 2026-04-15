import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import {
  parseVideoCategoriesFromRow,
  videoSchema,
} from "@/lib/schemas";

function sortVideos(
  list: any[],
  sort: string,
  order: string,
): any[] {
  const asc = order === "asc";
  const copy = [...list];
  if (sort === "alphabetical") {
    copy.sort((a, b) => {
      const ta = (a.title || "").localeCompare(b.title || "");
      return asc ? ta : -ta;
    });
  } else if (sort === "subscribers") {
    copy.sort((a, b) => {
      const sa = a.subscriberCount ?? -1;
      const sb = b.subscriberCount ?? -1;
      return asc ? sa - sb : sb - sa;
    });
  } else {
    copy.sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      return asc ? ta - tb : tb - ta;
    });
  }
  return copy;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get("category");
    const youtuber = searchParams.get("youtuber");
    const search = searchParams.get("search");
    const source = searchParams.get("source"); // 'youtube' | 'tiktok'
    const sort = searchParams.get("sort") || "newest";
    const order = searchParams.get("order") || "desc";
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 48, 200) : null;
    const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0;

    const admin = supabaseAdmin as any;

    let filtered: any[] = [];

    if (category) {
      let rows: any[] | null = null;
      const { data: rpcData, error: rpcError } = await admin.rpc(
        "match_video_category",
        { p_cat: category },
      );
      if (!rpcError && Array.isArray(rpcData)) {
        rows = rpcData;
      } else {
        let q = admin.from("video").select("*").eq("category", category);
        if (source === "youtube" || source === "tiktok") {
          q = q.eq("source", source);
        }
        if (youtuber) {
          q = q.ilike("youtuberName", youtuber);
        }
        const { data: fb } = await q;
        rows = fb || [];
      }

      filtered = rows || [];

      if (source === "youtube" || source === "tiktok") {
        filtered = filtered.filter((v: any) => v.source === source);
      }
      if (youtuber) {
        filtered = filtered.filter(
          (v: any) =>
            v.youtuberName &&
            String(v.youtuberName).toLowerCase() === youtuber.toLowerCase(),
        );
      }

      filtered = sortVideos(filtered, sort, order);
    } else {
      let query = admin.from("video").select("*");

      if (source === "youtube" || source === "tiktok") {
        query = query.eq("source", source);
      }

      if (youtuber) {
        query = query.ilike("youtuberName", youtuber);
      }

      if (sort === "alphabetical") {
        query = query.order("title", { ascending: order === "asc" });
      } else if (sort === "subscribers") {
        query = query.order("subscriberCount", {
          ascending: order === "asc",
          nullsFirst: false,
        });
      } else {
        query = query.order("createdAt", { ascending: order === "asc" });
      }

      const { data: videos, error } = await query;

      if (error) {
        console.error("❌ Supabase error fetching videos:", error);
        return NextResponse.json([], { status: 200 });
      }

      filtered = videos || [];
    }

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

    const total = filtered.length;

    // Apply pagination after all filtering/sorting
    const paginated = limit !== null ? filtered.slice(offset, offset + limit) : filtered;

    const mapped = paginated.map((video: any) => {
      const cats = parseVideoCategoriesFromRow(video);
      return {
        ...video,
        category: cats[0] ?? "Other",
        categories: cats,
      };
    });

    return NextResponse.json({ videos: mapped, total, offset, limit });
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
      categories: validated.categories,
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

    const v = video as Record<string, unknown>;
    const cats = parseVideoCategoriesFromRow(v as { category?: string; categories?: unknown });
    return NextResponse.json(
      { ...v, category: cats[0] ?? "Other", categories: cats },
      { status: 201 }
    );
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
