-- AI Betting Bot — closing-line-value (CLV) tracking.
-- Pro bettors grade themselves on CLV (did you beat the closing line?)
-- not just W/L, because over small samples CLV converges to true edge
-- much faster than ROI does.
--
-- Run once in the Supabase SQL editor. The settlement loop will start
-- populating these columns automatically — they'll be null on bets
-- placed before this migration ran.

alter table public.betting_bot_bet
  add column if not exists closing_odds_decimal numeric,
  add column if not exists closing_implied_pct numeric,
  add column if not exists clv_pct numeric;

-- CLV % > 0 means you got a better price than where the line closed.
-- Long-run +2% CLV is a profitable bettor regardless of recent W/L.
