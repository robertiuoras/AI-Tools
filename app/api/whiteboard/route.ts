import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveWhiteboardAccess } from "@/lib/whiteboard-auth";

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

/**
 * Loads the boards metadata file.
 *
 * Returns:
 *   - { ok: true, boards }            — file exists and parsed cleanly (or genuinely missing → empty list)
 *   - { ok: false, error }            — read/parse failure we should NOT silently treat as "no boards"
 *
 * This distinction matters for delete: if the read transiently fails and we
 * treated it as "no boards", we'd then write an empty/seeded list back and
 * permanently lose every other board the user owns.
 */
async function loadBoardsMetaSafe(
  userId: string,
): Promise<{ ok: true; boards: BoardMeta[] } | { ok: false; error: string }> {
  const admin = supabaseAdmin as any;
  try {
    const { data, error } = await admin.storage
      .from(WHITEBOARD_BUCKET)
      .download(`${userId}/__boards__.json`);
    if (error) {
      const msg = String((error as { message?: string })?.message ?? error ?? "");
      // Supabase storage returns one of these when the object simply
      // doesn't exist yet (first-time user). Treat as empty list.
      if (/not\s*found|no such|object not found|404/i.test(msg)) {
        return { ok: true, boards: [] };
      }
      return { ok: false, error: msg || "load failed" };
    }
    if (!data) return { ok: true, boards: [] };
    const text = await (data as Blob).text();
    const parsed = JSON.parse(text) as BoardMeta[];
    return { ok: true, boards: Array.isArray(parsed) ? parsed : [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Back-compat helper for callers that don't need to react to read failures. */
async function loadBoardsMeta(userId: string): Promise<BoardMeta[]> {
  const r = await loadBoardsMetaSafe(userId);
  return r.ok ? r.boards : [];
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
 * GET /api/whiteboard                              → list all boards for user
 * GET /api/whiteboard?boardId=xxx                  → load snapshot (own board)
 * GET /api/whiteboard?boardId=xxx&ownerId=yyy      → load snapshot for a board
 *                                                    shared with you (the
 *                                                    ownerId is the storage
 *                                                    folder owner; resolve
 *                                                    via whiteboard_share
 *                                                    to check permission).
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const boardId = request.nextUrl.searchParams.get("boardId");
    const ownerHintParam = request.nextUrl.searchParams.get("ownerId");

    if (!boardId) {
      // List the user's boards verbatim. We deliberately do NOT seed a
      // virtual "default" when the list is empty — that historical
      // behavior caused two well-known bugs:
      //   1. Deleting the only board would resurrect it (the empty list
      //      was instantly back-filled with the virtual "default").
      //   2. The virtual default got persisted via an autosave the
      //      moment the user touched the canvas, so creating a real
      //      board afterwards left them with TWO Untitled boards.
      // The client now renders an explicit empty state instead.
      const boards = await loadBoardsMeta(userId);
      return NextResponse.json({ boards });
    }

    // Resolve which folder to read from. For your own board the storage
    // path is `${userId}/${boardId}.json`; for a board shared with you
    // it's `${ownerId}/${boardId}.json` and we must verify the share
    // before serving.
    const access = await resolveWhiteboardAccess(
      userId,
      boardId,
      ownerHintParam ?? userId,
    );
    if (access.kind === "none") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = supabaseAdmin as any;
    const path = `${access.ownerId}/${boardId}.json`;
    const { data, error } = await admin.storage.from(WHITEBOARD_BUCKET).download(path);

    if (error || !data) {
      return NextResponse.json({
        snapshot: null,
        access: {
          kind: access.kind,
          ownerId: access.ownerId,
          permission:
            access.kind === "owner"
              ? "edit"
              : access.kind === "share"
                ? access.permission
                : "view",
        },
      });
    }

    const text = await (data as Blob).text();
    const snapshot = JSON.parse(text);
    return NextResponse.json({
      snapshot,
      access: {
        kind: access.kind,
        ownerId: access.ownerId,
        permission:
          access.kind === "owner"
            ? "edit"
            : access.kind === "share"
              ? access.permission
              : "view",
      },
    });
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
      // Optional — when saving a board that's been shared WITH you, the
      // client passes the owner's id so we write to the right storage
      // folder. We re-verify the share on every write.
      ownerId?: string;
    };

    if (body.action === "save") {
      if (!body.boardId || !body.snapshot) {
        return NextResponse.json({ error: "boardId and snapshot required" }, { status: 400 });
      }

      // Resolve where to write. If ownerId === userId, fast path: own board.
      // If ownerId is someone else, must have an edit share. If no ownerId
      // given, fall back to "own" semantics (back-compat with older clients).
      const ownerHint = body.ownerId ?? userId;
      const isOwnBoard = ownerHint === userId;

      let resolvedOwnerId = userId;
      let resolvedPermission: "view" | "edit" = "edit";

      if (!isOwnBoard) {
        const access = await resolveWhiteboardAccess(
          userId,
          body.boardId,
          ownerHint,
        );
        if (access.kind === "none") {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        resolvedOwnerId = access.ownerId;
        resolvedPermission =
          access.kind === "owner"
            ? "edit"
            : access.kind === "share"
              ? access.permission
              : "view";
        if (resolvedPermission !== "edit") {
          return NextResponse.json(
            { error: "View-only access" },
            { status: 403 },
          );
        }
      }

      // Verify the board still exists in the OWNER's meta BEFORE we
      // upload anything. Two reasons:
      //   1. Snapshot files for deleted boards were getting orphaned in
      //      storage by trailing autosaves fired on unmount.
      //   2. Resurrecting a "default" entry from a stale save was the
      //      root cause of the "I deleted it but it came back" bug.
      // If the board is gone we return 410 Gone and the client suppresses
      // any further saves for that boardId.
      const boards = await loadBoardsMeta(resolvedOwnerId);
      const exists = boards.some((b) => b.id === body.boardId);
      if (!exists) {
        return NextResponse.json(
          { ok: false, gone: true, error: "Board no longer exists" },
          { status: 410 },
        );
      }

      const path = `${resolvedOwnerId}/${body.boardId}.json`;
      const bytes = new TextEncoder().encode(JSON.stringify(body.snapshot));
      const { error } = await admin.storage
        .from(WHITEBOARD_BUCKET)
        .upload(path, bytes, { contentType: "application/json", upsert: true });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const updated = boards.map((b) =>
        b.id === body.boardId ? { ...b, updatedAt: new Date().toISOString() } : b
      );
      await saveBoardsMeta(resolvedOwnerId, updated);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "create") {
      const name = (body.name ?? "Untitled Board").trim() || "Untitled Board";
      const id = `board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newBoard: BoardMeta = { id, name, updatedAt: new Date().toISOString() };
      const boards = await loadBoardsMeta(userId);
      // No virtual-default seeding here. Previously we pushed a "default"
      // entry when meta was empty, which caused the user to end up with
      // two Untitled boards after creating their first one.
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

      // Load with explicit error handling. If the meta file failed to load
      // for any reason other than "not found", abort — otherwise we'd save
      // a wiped/seeded list and permanently destroy the user's other
      // boards. The client can retry.
      const loaded = await loadBoardsMetaSafe(userId);
      if (!loaded.ok) {
        return NextResponse.json(
          { error: `Could not read boards metadata: ${loaded.error}` },
          { status: 503 },
        );
      }

      const before = loaded.boards;
      // Board not in meta? Just nuke any orphan snapshot file and return
      // the unchanged list. Don't attempt to "tolerate" a synthetic
      // default — the GET endpoint no longer fabricates one.
      if (before.length > 0 && !before.some((b) => b.id === body.boardId)) {
        await admin.storage
          .from(WHITEBOARD_BUCKET)
          .remove([`${userId}/${body.boardId}.json`]);
        return NextResponse.json({ ok: true, boards: before });
      }

      const next = before.filter((b) => b.id !== body.boardId);
      // Empty is a valid state — the client renders an empty placeholder
      // with a "Create your first board" prompt. We deliberately do NOT
      // re-seed a default entry here; doing so was the root cause of
      // "I deleted my board but it keeps coming back".
      await saveBoardsMeta(userId, next);
      await admin.storage
        .from(WHITEBOARD_BUCKET)
        .remove([`${userId}/${body.boardId}.json`]);
      return NextResponse.json({ ok: true, boards: next });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
