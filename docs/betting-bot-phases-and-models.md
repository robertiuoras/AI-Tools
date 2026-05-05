# AI Betting Bot Phases and Model Logic

This document is the running reference for how the betting bot currently works and where to improve it.

## System flow

1. Parse user prompt into sport/fixture/market intent.
2. Resolve fixture and collect real data (ESPN, API-Football, weather, odds board, optional StatsBomb priors).
3. Run LLM for narrative + structured metrics.
4. Run server-side deterministic pricing/guardrails:
   - fair probability overrides (market specific)
   - edge, Kelly, confidence caps
   - verdict guardrails and hard gates
5. Return final payload with diagnostics in `realData.providerDiagnostics`.

## Phase 1 (completed): corners data groundwork

- Added StatsBomb open-data team corner priors (`cornersForAvg`, `cornersAgainstAvg`, `cornersSample`).
- Added strict corners gate diagnostics (`cornersGate`):
  - line availability
  - sample requirements
  - recent-match checks
  - lineup availability
  - line movement check

## Phase 2 (completed): deterministic corners pricing

- Added Poisson corners model for explicit `over/under X corners`.
- Added safe application behavior:
  - model applies only when both teams meet minimum corner sample requirement.
  - edge + Kelly are recomputed from final fair probability.
- Added diagnostics:
  - `cornersGate.modelApplied`
  - `cornersGate.modelFairPct`
  - `cornersGate.modelTotalCornersMean`
  - `providerDiagnostics.pricingModel` snapshot

## Phase 3 (completed): deterministic goals + BTTS pricing

- Added expected-goals mean estimation from real team data (xG when available, otherwise shrunk for/against rates).
- Added deterministic pricing for:
  - Goals totals (`over/under X goals`)
  - BTTS (`both teams to score yes/no`)
- Added unified pricing diagnostics under `providerDiagnostics.pricingModel`.

## Current strict verdict policy

- Odds missing -> no pricing edge, default conservative verdict.
- Numeric guardrails enforce verdict consistency with edge/confidence.
- Corners hard gate can force `pass` regardless of model signal when required conditions fail.

## Key files

- `app/api/projects/ai-betting-bot/route.ts`:
  - market parsers
  - deterministic probability functions
  - fair-probability overrides
  - edge/Kelly/verdict guardrails
- `lib/betting-bot.ts`:
  - payload/result interfaces and diagnostics schema
- `lib/statsbomb-corners.ts`:
  - StatsBomb priors loading and team matching
- `scripts/statsbomb-build-corners.mjs`:
  - build script for local priors dataset

## Improvement backlog (next best steps)

1. Add live corners market lines from a trusted source (Pinnacle preferred).
2. Add per-fixture corners history (recent 7-10 matches each team) instead of team-level priors only.
3. Add lineup/formation feed and use player-role impacts in pricing means.
4. Add calibration loop:
   - track closing line value by market
   - reweight model priors by observed CLV and Brier/log-loss
5. Add market-specific confidence model so confidence is not mostly LLM-driven.

## How to review in debug payload

Look at:

- `result.fairWinProbabilityPct`
- `result.edgePct`
- `result.kelly`
- `result.realData.providerDiagnostics.cornersGate`
- `result.realData.providerDiagnostics.pricingModel`

If those disagree logically (e.g. huge fair pct but negative edge), treat as a bug.
