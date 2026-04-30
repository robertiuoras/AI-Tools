import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeUserPromptsPayload } from "@/lib/prompt-data";

export const dynamic = "force-dynamic";

const MAX_PROMPTS = 2000;
const MAX_BODY_CHARS = 200_000;

function bearerToken(request: NextRequest): string | null {
  const h = request.headers.get("authorization");
  if (!h) return null;
  return h.replace(/^Bearer\s+/i, "");
}

async function getUserId(request: NextRequest): Promise<string | null> {
  const token = bearerToken(request);
  if (!token) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await client.auth.getUser(token);
  return data.user?.id ?? null;
}

/**
 * GET  /api/user/prompts → { prompts: UserPrompt[] }
 * PUT  /api/user/prompts → body { prompts: UserPrompt[] } replaces the library
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const admin = supabaseAdmin as any;
    const { data, error } = await admin
      .from("user_prompt_library")
      .select("prompts")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      if (/relation .* does not exist/i.test(error.message ?? "")) {
        return NextResponse.json(
          {
            error:
              "Prompt library table is not installed. Apply supabase-migration-user-prompts.sql in Supabase.",
          },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const raw = data?.prompts ?? [];
    const prompts = normalizeUserPromptsPayload(raw).slice(0, MAX_PROMPTS);
    return NextResponse.json({ prompts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const rawList =
      body &&
      typeof body === "object" &&
      body !== null &&
      "prompts" in body
        ? (body as { prompts: unknown }).prompts
        : body;

    let prompts = normalizeUserPromptsPayload(rawList);
    if (prompts.length > MAX_PROMPTS) {
      return NextResponse.json(
        { error: `At most ${MAX_PROMPTS} prompts allowed.` },
        { status: 400 },
      );
    }
    for (const p of prompts) {
      if (p.body.length > MAX_BODY_CHARS) {
        return NextResponse.json(
          { error: "One or more prompts exceed the maximum body length." },
          { status: 400 },
        );
      }
    }

    const admin = supabaseAdmin as any;
    const { error } = await admin.from("user_prompt_library").upsert(
      {
        user_id: userId,
        prompts,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (error) {
      if (/relation .* does not exist/i.test(error.message ?? "")) {
        return NextResponse.json(
          {
            error:
              "Prompt library table is not installed. Apply supabase-migration-user-prompts.sql in Supabase.",
          },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, prompts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
