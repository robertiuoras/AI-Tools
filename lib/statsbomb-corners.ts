import "server-only";

import { readFile } from "fs/promises";
import path from "path";

type TeamPrior = {
  team: string;
  matches: number;
  cornersForAvg: number;
  cornersAgainstAvg: number;
};

type PriorsFile = {
  generatedAt: string;
  source: string;
  teams: TeamPrior[];
};

type TeamCornersProfile = {
  matches: number;
  cornersForAvg: number;
  cornersAgainstAvg: number;
};

let priorsCache: PriorsFile | null = null;

function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(fc|cf|ac|sc|afc|club|de|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadPriors(): Promise<PriorsFile | null> {
  if (priorsCache) return priorsCache;
  try {
    const filePath = path.join(
      process.cwd(),
      "data",
      "statsbomb",
      "corners-team-priors.json",
    );
    const raw = await readFile(filePath, "utf8");
    priorsCache = JSON.parse(raw) as PriorsFile;
    return priorsCache;
  } catch {
    return null;
  }
}

function bestMatch(teams: TeamPrior[], query: string): TeamPrior | null {
  const q = norm(query);
  if (!q) return null;
  let best: TeamPrior | null = null;
  let bestScore = -1;
  for (const t of teams) {
    const n = norm(t.team);
    if (!n) continue;
    let score = 0;
    if (n === q) score += 100;
    if (n.includes(q) || q.includes(n)) score += 40;
    const qTokens = q.split(" ").filter(Boolean);
    const nTokens = n.split(" ").filter(Boolean);
    score += qTokens.filter((tok) => nTokens.includes(tok)).length * 8;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return bestScore >= 8 ? best : null;
}

export async function getStatsbombCornersForTeam(
  teamName: string,
): Promise<TeamCornersProfile | null> {
  const priors = await loadPriors();
  if (!priors?.teams?.length) return null;
  const hit = bestMatch(priors.teams, teamName);
  if (!hit) return null;
  return {
    matches: hit.matches,
    cornersForAvg: hit.cornersForAvg,
    cornersAgainstAvg: hit.cornersAgainstAvg,
  };
}
