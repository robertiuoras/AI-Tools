import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/projects/ai-betting-bot/diagnostic
 *
 * Self-check endpoint so the user can verify production env / connectivity
 * without me needing log access. Returns:
 *
 *   - which env vars are configured (booleans only — never echoes the value)
 *   - whether each new Supabase table exists
 *   - a tiny live ping to api-football and OpenWeather to confirm the keys
 *     actually work (bad keys / wrong host / IP blocks all show up here)
 *
 * Hit it once after a deploy or env change to see why a provider is silent.
 */

export const dynamic = "force-dynamic";

async function pingApiFootball(): Promise<{
  reachable: boolean;
  status: number | null;
  remaining: string | null;
  note: string;
}> {
  const direct = process.env.API_FOOTBALL_KEY;
  const rapid = process.env.RAPIDAPI_KEY;
  if (!direct && !rapid) {
    return {
      reachable: false,
      status: null,
      remaining: null,
      note: "No API_FOOTBALL_KEY or RAPIDAPI_KEY set.",
    };
  }
  const url = direct
    ? "https://v3.football.api-sports.io/teams?search=Sevilla"
    : "https://api-football-v1.p.rapidapi.com/v3/teams?search=Sevilla";
  const headers: Record<string, string> = direct
    ? { "x-apisports-key": direct, Accept: "application/json" }
    : {
        "x-rapidapi-key": rapid!,
        "x-rapidapi-host": "api-football-v1.p.rapidapi.com",
        Accept: "application/json",
      };
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    const remaining =
      res.headers.get("x-ratelimit-requests-remaining") ??
      res.headers.get("x-ratelimit-remaining") ??
      null;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore parse failures
    }
    const data = body as {
      response?: unknown[];
      errors?: unknown;
      results?: number;
    } | null;
    const teamsHit =
      Array.isArray(data?.response) && (data!.response as unknown[]).length > 0;
    const note = !res.ok
      ? `HTTP ${res.status} — check key validity / plan limits`
      : teamsHit
        ? `OK — search returned ${data?.results ?? "?"} matches`
        : data?.errors
          ? `API responded but with errors: ${JSON.stringify(data.errors).slice(0, 200)}`
          : "Empty response — likely plan / season restriction";
    return {
      reachable: true,
      status: res.status,
      remaining,
      note,
    };
  } catch (e) {
    return {
      reachable: false,
      status: null,
      remaining: null,
      note: e instanceof Error ? e.message : String(e),
    };
  }
}

async function pingOpenWeather(): Promise<{
  reachable: boolean;
  status: number | null;
  note: string;
}> {
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) {
    return { reachable: false, status: null, note: "No OPENWEATHER_API_KEY set." };
  }
  try {
    // London — neutral test location.
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=London&appid=${key}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    return {
      reachable: true,
      status: res.status,
      note: res.ok ? "OK" : `HTTP ${res.status} — key may be invalid or not yet active`,
    };
  } catch (e) {
    return {
      reachable: false,
      status: null,
      note: e instanceof Error ? e.message : String(e),
    };
  }
}

async function checkTable(name: string): Promise<{ exists: boolean; note: string }> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { exists: false, note: "SUPABASE_SERVICE_ROLE_KEY not set" };
  }
  try {
    const { error } = await (supabaseAdmin as any)
      .from(name)
      .select("*", { count: "exact", head: true })
      .limit(1);
    if (error) {
      return {
        exists: false,
        note: error.message ?? "select failed",
      };
    }
    return { exists: true, note: "OK" };
  } catch (e) {
    return {
      exists: false,
      note: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function GET() {
  const env = {
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    API_FOOTBALL_KEY: !!process.env.API_FOOTBALL_KEY,
    RAPIDAPI_KEY: !!process.env.RAPIDAPI_KEY,
    OPENWEATHER_API_KEY: !!process.env.OPENWEATHER_API_KEY,
    ODDS_API_KEY: !!process.env.ODDS_API_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  const [apiFootball, openWeather, tables] = await Promise.all([
    pingApiFootball(),
    pingOpenWeather(),
    Promise.all([
      checkTable("sports_data_cache"),
      checkTable("elo_ratings"),
      checkTable("h2h_history"),
      checkTable("odds_snapshots"),
    ]),
  ]);

  return NextResponse.json({
    env,
    providers: {
      apiFootball,
      openWeather,
    },
    supabaseTables: {
      sports_data_cache: tables[0],
      elo_ratings: tables[1],
      h2h_history: tables[2],
      odds_snapshots: tables[3],
    },
    notes:
      "Empty provider responses (recent games, injuries, H2H) mean the auth key is missing, the plan doesn't include the league/season, or the daily quota is exhausted. Check apiFootball.note and apiFootball.remaining first.",
  });
}
