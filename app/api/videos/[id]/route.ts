import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeVideoCategory, videoSchema } from "@/lib/schemas";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const admin = supabaseAdmin as any;
    const { data: video, error } = await admin
      .from("video")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...video,
      category: normalizeVideoCategory((video as { category?: string }).category),
    });
  } catch (error) {
    console.error("❌ Error fetching video:", error);
    return NextResponse.json(
      { error: "Failed to fetch video" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = videoSchema.parse(body);

    const updateData: Record<string, unknown> = {
      title: validated.title,
      url: validated.url,
      category: validated.category,
      source: validated.source ?? "youtube",
      youtuberName: validated.youtuberName ?? null,
      subscriberCount: validated.subscriberCount ?? null,
      channelThumbnailUrl: validated.channelThumbnailUrl ?? null,
      channelVideoCount: validated.channelVideoCount ?? null,
      verified: validated.verified ?? null,
      tags: validated.tags ?? null,
      description: validated.description ?? null,
      updatedAt: new Date().toISOString(),
    };

    const admin = supabaseAdmin as any;
    const { data: video, error } = await admin
      .from("video")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("❌ Error updating video:", error);
      return NextResponse.json(
        { error: "Failed to update video", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(video);
  } catch (error: any) {
    console.error("❌ Error updating video:", error);
    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json(
        { error: "Validation error", details: error },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to update video" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const admin = supabaseAdmin as any;
    const { error } = await admin.from("video").delete().eq("id", id);

    if (error) {
      console.error("❌ Error deleting video:", error);
      return NextResponse.json(
        { error: "Failed to delete video", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("❌ Error deleting video:", error);
    return NextResponse.json(
      { error: "Failed to delete video" },
      { status: 500 }
    );
  }
}

