#!/usr/bin/env node
/**
 * Build team-level corner priors from StatsBomb open-data.
 *
 * Output:
 *   data/statsbomb/corners-team-priors.json
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const RAW_BASE =
  "https://raw.githubusercontent.com/statsbomb/open-data/master/data";

const TARGET_COMPETITIONS = new Set([
  "Premier League",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "UEFA Champions League",
]);

const MAX_MATCHES_PER_COMP = 220;

function norm(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

function extractCorners(events, homeName, awayName) {
  let homeCorners = 0;
  let awayCorners = 0;
  for (const e of events) {
    if (!e || e.type?.name !== "Pass") continue;
    if (e.pass?.type?.name !== "Corner") continue;
    const teamName = e.team?.name ?? "";
    if (norm(teamName) === norm(homeName)) homeCorners += 1;
    if (norm(teamName) === norm(awayName)) awayCorners += 1;
  }
  return { homeCorners, awayCorners };
}

async function main() {
  const competitions = await getJson(`${RAW_BASE}/competitions.json`);
  const filtered = competitions.filter((c) =>
    TARGET_COMPETITIONS.has(c.competition_name),
  );
  const latestByComp = new Map();
  for (const c of filtered) {
    const key = c.competition_id;
    const prev = latestByComp.get(key);
    if (!prev || Number(c.season_id) > Number(prev.season_id)) {
      latestByComp.set(key, c);
    }
  }

  const teamAgg = new Map();
  for (const c of latestByComp.values()) {
    const matches = await getJson(
      `${RAW_BASE}/matches/${c.competition_id}/${c.season_id}.json`,
    );
    for (const m of matches.slice(0, MAX_MATCHES_PER_COMP)) {
      const home = m.home_team?.home_team_name;
      const away = m.away_team?.away_team_name;
      if (!home || !away) continue;
      const events = await getJson(`${RAW_BASE}/events/${m.match_id}.json`);
      const { homeCorners, awayCorners } = extractCorners(events, home, away);
      const add = (team, cf, ca) => {
        const k = norm(team);
        if (!k) return;
        const row = teamAgg.get(k) ?? {
          team,
          matches: 0,
          cornersFor: 0,
          cornersAgainst: 0,
        };
        row.matches += 1;
        row.cornersFor += cf;
        row.cornersAgainst += ca;
        if (row.team.length < String(team).length) row.team = team;
        teamAgg.set(k, row);
      };
      add(home, homeCorners, awayCorners);
      add(away, awayCorners, homeCorners);
    }
  }

  const teams = Array.from(teamAgg.values())
    .filter((t) => t.matches >= 5)
    .map((t) => ({
      team: t.team,
      matches: t.matches,
      cornersForAvg: Number((t.cornersFor / t.matches).toFixed(2)),
      cornersAgainstAvg: Number((t.cornersAgainst / t.matches).toFixed(2)),
    }))
    .sort((a, b) => b.matches - a.matches);

  const output = {
    generatedAt: new Date().toISOString(),
    source: "statsbomb/open-data",
    teams,
  };

  const outDir = path.join(process.cwd(), "data", "statsbomb");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "corners-team-priors.json"),
    JSON.stringify(output, null, 2),
    "utf8",
  );
  console.log(`Wrote ${teams.length} teams to data/statsbomb/corners-team-priors.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
