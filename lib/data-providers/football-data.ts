import "server-only";

import type { EspnPastGame } from "@/lib/sports-data";
import { cached, SPORTS_CACHE_TTL } from "@/lib/sports-cache";

type FDTeam = { id: number; name: string; shortName?: string; tla?: string; crest?: string };
type FDMatch = {
  utcDate: string;
  status: string;
  homeTeam: FDTeam;
  awayTeam: FDTeam;
  score?: { fullTime?: { home?: number | null; away?: number | null } };
  competition?: { id?: number; name?: string };
};

function token(): string | null {
  return process.env.FOOTBALL_DATA_API_KEY ?? null;
}

async function fdGet<T>(path: string): Promise<T | null> {
  const t = token();
  if (!t) return null;
  try {
    const res = await fetch(`https://api.football-data.org/v4${path}`, {
      headers: { "X-Auth-Token": t, Accept: "application/json" },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function norm(s: string): string {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\batl\b/g, "atletico")
    .replace(/\s+/g, " ")
    .trim();
}

function pickTeamId(teams: FDTeam[], teamName: string): number | null {
  const q = norm(teamName);
  let best: number | null = null;
  let bestScore = -1;
  for (const t of teams) {
    const names = [t.name, t.shortName ?? "", t.tla ?? ""].map(norm).filter(Boolean);
    let score = 0;
    for (const n of names) {
      if (n === q) score += 100;
      if (n.includes(q) || q.includes(n)) score += 30;
      const qt = q.split(" ");
      const nt = n.split(" ");
      score += qt.filter((x) => nt.includes(x)).length * 6;
    }
    if (score > bestScore) {
      bestScore = score;
      best = t.id;
    }
  }
  return bestScore >= 8 ? best : null;
}

export async function footballDataRecentGames(
  teamName: string,
  limit = 10,
): Promise<EspnPastGame[]> {
  if (!token()) return [];
  return cached(`football-data:recent:${teamName.toLowerCase()}:${limit}`, SPORTS_CACHE_TTL.schedule, async () => {
    const teams = await fdGet<{ teams?: FDTeam[] }>(`/teams?limit=500`);
    const id = pickTeamId(teams?.teams ?? [], teamName);
    if (!id) return [];
    const data = await fdGet<{ matches?: FDMatch[] }>(`/teams/${id}/matches?status=FINISHED&limit=25`);
    const matches = data?.matches ?? [];
    const out: EspnPastGame[] = matches.map((m) => {
      const isHome = m.homeTeam?.id === id;
      const opp = isHome ? m.awayTeam : m.homeTeam;
      const my = isHome ? (m.score?.fullTime?.home ?? null) : (m.score?.fullTime?.away ?? null);
      const op = isHome ? (m.score?.fullTime?.away ?? null) : (m.score?.fullTime?.home ?? null);
      const result: "W" | "L" | "T" | null =
        my == null || op == null ? null : my > op ? "W" : my < op ? "L" : "T";
      return {
        id: `${m.utcDate}:${opp?.id ?? ""}`,
        date: m.utcDate,
        opponent: {
          id: String(opp?.id ?? ""),
          displayName: opp?.name ?? "",
          abbreviation: opp?.tla ?? (opp?.name ?? "").slice(0, 3).toUpperCase(),
          logo: opp?.crest ?? null,
        },
        homeAway: isHome ? "home" : "away",
        teamScore: my,
        oppScore: op,
        result,
      };
    });
    out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    return out.slice(0, limit);
  });
}

export async function footballDataTeamStanding(
  teamName: string,
): Promise<{ league: string | null; rank: number | null; points: number | null; form: string | null } | null> {
  if (!token()) return null;
  return cached(`football-data:standing:${teamName.toLowerCase()}`, SPORTS_CACHE_TTL.teamStats, async () => {
    const teams = await fdGet<{ teams?: FDTeam[] }>(`/teams?limit=500`);
    const id = pickTeamId(teams?.teams ?? [], teamName);
    if (!id) return null;
    const matches = await fdGet<{ matches?: FDMatch[] }>(`/teams/${id}/matches?status=FINISHED&limit=1`);
    const compId = matches?.matches?.[0]?.competition?.id;
    if (!compId) return null;
    const table = await fdGet<{
      competition?: { name?: string };
      standings?: Array<{ table?: Array<{ position?: number; points?: number; form?: string; team?: { id?: number } }> }>;
    }>(`/competitions/${compId}/standings`);
    const rows = table?.standings?.[0]?.table ?? [];
    const row = rows.find((r) => r.team?.id === id);
    if (!row) return null;
    return {
      league: table?.competition?.name ?? null,
      rank: row.position ?? null,
      points: row.points ?? null,
      form: row.form ?? null,
    };
  });
}
