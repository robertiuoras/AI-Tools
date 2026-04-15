import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";

const WHITEBOARD_BUCKET = "user-whiteboard";

function getSupabaseClient(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getUserId(request: NextRequest): Promise<string | null> {
  const client = getSupabaseClient(request);
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await client.auth.getUser(token);
    if (user) return user.id;
  }
  const { data: { user } } = await client.auth.getUser();
  return user?.id ?? null;
}

async function ensureBucket() {
  const admin = supabaseAdmin as any;
  const { data: buckets } = await admin.storage.listBuckets();
  const exists = (buckets ?? []).some((b: { name: string }) => b.name === WHITEBOARD_BUCKET);
  if (!exists) {
    await admin.storage.createBucket(WHITEBOARD_BUCKET, {
      public: false,
      fileSizeLimit: 20 * 1024 * 1024,
    });
  }
}

export interface BoardMeta {
  id: string;
  name: string;
  updatedAt: string;
}

async function loadBoardsMeta(userId: string): Promise<BoardMeta[]> {
  const admin = supabaseAdmin as any;
  try {
    const { data, error } = await admin.storage
      .from(WHITEBOARD_BUCKET)
      .download(`${userId}/__boards__.json`);
    if (error || !data) return [];
    const text = await (data as Blob).text();
    return JSON.parse(text) as BoardMeta[];
  } catch {
    return [];
  }
}

async function saveBoardsMeta(userId: string, boards: BoardMeta[]) {
  const admin = supabaseAdmin as any;
  const bytes = new TextEncoder().encode(JSON.stringify(boards));
  await admin.storage
    .from(WHITEBOARD_BUCKET)
    .upload(`${userId}/__boards__.json`, bytes, {
      contentType: "application/json",
      upsert: true,
    });
}

/**
 * GET /api/whiteboard              → list all boards for user
 * GET /api/whiteboard?boardId=xxx  → load snapshot for that board
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const boardId = request.nextUrl.searchParams.get("boardId");

    if (!boardId) {
      // List boards
      const boards = await loadBoardsMeta(userId);
      // If no boards yet, seed a default one
      if (boards.length === 0) {
        const defaultBoard: BoardMeta = {
          id: "default",
          name: "Untitled Board",
          updatedAt: new Date().toISOString(),
        };
        return NextResponse.json({ boards: [defaultBoard] });
      }
      return NextResponse.json({ boards });
    }

    // Load specific board snapshot
    const admin = supabaseAdmin as any;
    const path = `${userId}/${boardId}.json`;
    const { data, error } = await admin.storage.from(WHITEBOARD_BUCKET).download(path);

    if (error || !data) {
      return NextResponse.json({ snapshot: null });
    }

    const text = await (data as Blob).text();
    const snapshot = JSON.parse(text);
    return NextResponse.json({ snapshot });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/**
 * POST /api/whiteboard
 * Body actions:
 *   { action: "save",   boardId, snapshot }   → save snapshot
 *   { action: "create", name }                 → create new board → { board: BoardMeta }
 *   { action: "rename", boardId, name }        → rename board
 *   { action: "delete", boardId }              → delete board + snapshot
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await ensureBucket();
    const admin = supabaseAdmin as any;
    const body = (await request.json()) as {
      action: "save" | "create" | "rename" | "delete";
      boardId?: string;
      name?: string;
      snapshot?: unknown;
    };

    if (body.action === "save") {
      if (!body.boardId || !body.snapshot) {
        return NextResponse.json({ error: "boardId and snapshot required" }, { status: 400 });
      }
      const path = `${userId}/${body.boardId}.json`;
      const bytes = new TextEncoder().encode(JSON.stringify(body.snapshot));
      const { error } = await admin.storage
        .from(WHITEBOARD_BUCKET)
        .upload(path, bytes, { contentType: "application/json", upsert: true });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // Update updatedAt in boards meta
      const boards = await loadBoardsMeta(userId);
      const updated = boards.map((b) =>
        b.id === body.boardId ? { ...b, updatedAt: new Date().toISOString() } : b
      );
      // If board isn't in meta (e.g. "default"), add it
      if (!updated.find((b) => b.id === body.boardId)) {
        updated.push({ id: body.boardId, name: "Untitled Board", updatedAt: new Date().toISOString() });
      }
      await saveBoardsMeta(userId, updated);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "create") {
      const name = (body.name ?? "Untitled Board").trim() || "Untitled Board";
      const id = `board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newBoard: BoardMeta = { id, name, updatedAt: new Date().toISOString() };
      const boards = await loadBoardsMeta(userId);
      // Seed default if empty
      if (boards.length === 0) {
        boards.push({ id: "default", name: "Untitled Board", updatedAt: new Date().toISOString() });
      }
      await saveBoardsMeta(userId, [...boards, newBoard]);
      return NextResponse.json({ board: newBoard });
    }

    if (body.action === "rename") {
      if (!body.boardId || !body.name?.trim()) {
        return NextResponse.json({ error: "boardId and name required" }, { status: 400 });
      }
      let boards = await loadBoardsMeta(userId);
      if (!boards.find((b) => b.id === body.boardId)) {
        boards = [{ id: body.boardId!, name: body.name!, updatedAt: new Date().toISOString() }, ...boards];
      } else {
        boards = boards.map((b) =>
          b.id === body.boardId ? { ...b, name: body.name!.trim() } : b
        );
      }
      await saveBoardsMeta(userId, boards);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "delete") {
      if (!body.boardId) return NextResponse.json({ error: "boardId required" }, { status: 400 });
      let boards = await loadBoardsMeta(userId);
      boards = boards.filter((b) => b.id !== body.boardId);
      // Must keep at least one board
      if (boards.length === 0) {
        boards = [{ id: "default", name: "Untitled Board", updatedAt: new Date().toISOString() }];
      }
      await saveBoardsMeta(userId, boards);
      // Delete the snapshot file (ignore error if not found)
      await admin.storage.from(WHITEBOARD_BUCKET).remove([`${userId}/${body.boardId}.json`]);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
