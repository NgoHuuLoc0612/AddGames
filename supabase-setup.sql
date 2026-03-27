-- ─────────────────────────────────────────────────────────────────────────────
-- ADDGAMES — Supabase Setup SQL
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Games table
CREATE TABLE IF NOT EXISTS public.games (
  id           uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz     NOT NULL DEFAULT now(),
  name         text            NOT NULL,
  slug         text            NOT NULL UNIQUE,
  icon         text            DEFAULT '🎮',
  description  text,
  author       text,
  game_url     text            NOT NULL,
  source_type  text            NOT NULL CHECK (source_type IN ('upload', 'github'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_games_slug       ON public.games (slug);
CREATE INDEX IF NOT EXISTS idx_games_created_at ON public.games (created_at DESC);

-- 2. Row Level Security — public read, public insert (no auth required)
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read games"
  ON public.games FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert games"
  ON public.games FOR INSERT
  WITH CHECK (true);

-- 3. Realtime — enable for the table
ALTER PUBLICATION supabase_realtime ADD TABLE public.games;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Storage bucket (run AFTER creating via Dashboard if needed)
-- Dashboard → Storage → New Bucket → name: "game-files" → Public: ON
-- Then run these policies:
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('game-files', 'game-files', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read game files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'game-files');

CREATE POLICY "Anyone can upload game files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'game-files');

CREATE POLICY "Anyone can update game files"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'game-files');
