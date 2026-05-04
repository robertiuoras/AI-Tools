import "server-only";
import type {
  BettingBookOdds,
  BettingLineMovement,
} from "@/lib/betting-bot";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Odds-snapshot store + line-movement reader.
 *
 * Why: the prompt's 14%-weight "Line movement & sharp action" factor needs
 * to know how the line opened vs where it sits now. Free odds APIs only
 * return the *current* price. We solve it by snapshotting on every bot
 * request — over time each fixture accumulates 5-50 snapshots and we can
 * compute the delta plus a cheap reverse-line-movement signal.
 *
 * Degrades silently: missing table or service-role key → snapshot writes
 * are no-ops and reads return null. The prompt section just says "no
 * historical snapshots yet."
 */

function admin() {
  return supabaseAdmin as unknown as { from: (t: string) => any };
}

/** Stable string key for one fixture across snapshots. */
export function eventKeyFor(input: {
  homeTeamName: string;
  awayTeamName: string;
  kickoffIso: string | null;
}): string {
  const home = input.homeTeamName.trim().toLowerCase();
  const away = input.awayTeamName.trim().toLowerCase();
  const kickoff = (input.kickoffIso ?? "").slice(0, 16); // minute precision
  return `${home}|${away}|${kickoff}`;
}

export async function snapshotOdds(input: {
  sport: string;
  eventKey: string;
  espnEventId: string | null;
  books: BettingBookOdds[];
}): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  if (!input.books.length) return;
  try {
    await admin().from("odds_snapshots").insert({
      sport: input.sport,
      event_key: input.eventKey,
      espn_event_id: input.espnEventId,
      books: input.books,
    });
  } catch {
    // swallow — snapshotting is best-effort
  }
}

interface SnapshotRow {
  captured_at: string;
  books: BettingBookOdds[];
}

/**
 * Pull all snapshots for one fixture (chronological) and synthesize the
 * line-movement summary the prompt cares about.
 */
export async function getLineMovement(
  eventKey: string,
): Promise<BettingLineMovement | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const { data, error } = await admin()
      .from("odds_snapshots")
      .select("captured_at, books")
      .eq("event_key", eventKey)
      .order("captured_at", { ascending: true });
    if (error || !Array.isArray(data) || data.length < 2) return null;
    const rows = data as SnapshotRow[];

    const open = rows[0]!;
    const current = rows[rows.length - 1]!;

    const consensus = (books: BettingBookOdds[]) => {
      const spreads = books
        .map((b) => b.spreadPoint)
        .filter((v): v is number => v != null);
      const totals = books.map((b) => b.total).filter((v): v is number => v != null);
      const homeMls = books
        .map((b) => b.moneylineHome)
        .filter((v): v is number => v != null);
      const avg = (xs: number[]) =>
        xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
      return { spread: avg(spreads), total: avg(totals), homeMl: avg(homeMls) };
    };

    const o = consensus(open.books);
    const c = consensus(current.books);

    const spreadMove = o.spread != null && c.spread != null ? c.spread - o.spread : null;
    const totalMove = o.total != null && c.total != null ? c.total - o.total : null;
    const homeMlMove = o.homeMl != null && c.homeMl != null ? c.homeMl - o.homeMl : null;

    // Cheap RLM heuristic: if the spread moved in the direction OPPOSITE
    // to the team that opened as a favorite, that's a sharp signal.
    let reverseLineMove = false;
    if (o.spread != null && c.spread != null) {
      if (o.spread < 0 && c.spread > o.spread) reverseLineMove = true; // home was fav, line moved toward away
      if (o.spread > 0 && c.spread < o.spread) reverseLineMove = true; // away was fav, line moved toward home
    }

    const pinnacleBook = current.books.find(
      (b) => b.key === "pinnacle" || /pinnacle/i.test(b.provider ?? ""),
    );
    const pinnacle = pinnacleBook
      ? {
          moneylineHome: pinnacleBook.moneylineHome,
          moneylineAway: pinnacleBook.moneylineAway,
          spreadPoint: pinnacleBook.spreadPoint,
          total: pinnacleBook.total,
        }
      : null;

    return {
      openCapturedAt: open.captured_at,
      currentCapturedAt: current.captured_at,
      snapshotCount: rows.length,
      spreadMove: spreadMove != null ? Number(spreadMove.toFixed(2)) : null,
      totalMove: totalMove != null ? Number(totalMove.toFixed(2)) : null,
      homeMlMove: homeMlMove != null ? Number(homeMlMove.toFixed(3)) : null,
      reverseLineMove,
      pinnacle,
    };
  } catch {
    return null;
  }
}

/**
 * H2H persistence: read all known meetings between two teams ordered
 * newest-first, optionally limited.
 */
export async function readH2HHistory(
  sport: string,
  teamAId: string,
  teamBId: string,
  limit = 10,
): Promise<
  Array<{
    game_date: string;
    home_id: string;
    away_id: string;
    home_score: number | null;
    away_score: number | null;
    venue: string | null;
    source: string;
  }>
> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  if (!teamAId || !teamBId) return [];
  const pairKey = [teamAId, teamBId].sort().join("|");
  try {
    const { data, error } = await admin()
      .from("h2h_history")
      .select("game_date, home_id, away_id, home_score, away_score, venue, source")
      .eq("sport", sport)
      .eq("pair_key", pairKey)
      .order("game_date", { ascending: false })
      .limit(limit);
    if (error || !Array.isArray(data)) return [];
    return data;
  } catch {
    return [];
  }
}

export async function writeH2HHistory(
  sport: string,
  rows: Array<{
    game_date: string;
    home_id: string;
    away_id: string;
    home_score: number | null;
    away_score: number | null;
    venue: string | null;
    source: string;
  }>,
): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  if (!rows.length) return;
  try {
    const upserts = rows.map((r) => ({
      sport,
      pair_key: [r.home_id, r.away_id].sort().join("|"),
      ...r,
    }));
    await admin()
      .from("h2h_history")
      .upsert(upserts, {
        onConflict: "sport,pair_key,game_date,home_id,away_id",
        ignoreDuplicates: true,
      });
  } catch {
    // swallow
  }
}
