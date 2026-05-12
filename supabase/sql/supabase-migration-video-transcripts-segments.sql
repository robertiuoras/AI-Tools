-- Add timestamped transcript segments to the video_transcripts cache.
-- Each segment: { text: string, startSec: number, endSec: number }
-- Old rows without this column render as a single unsegmented block in the UI
-- (chapters/timestamps are only available after a fresh fetch).
-- Run once in the Supabase SQL editor.

alter table public.video_transcripts
  add column if not exists segments jsonb;
