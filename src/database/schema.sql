-- AI YouTube Analyst schema (PostgreSQL / Neon)
-- Applied automatically at runtime via db.js (idempotent). Kept here for manual setup.

CREATE TABLE IF NOT EXISTS channels (
  channel_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  username TEXT,
  subscriber_count BIGINT DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(channel_id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  is_short BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  lifetime_views BIGINT DEFAULT 0,
  lifetime_likes BIGINT DEFAULT 0,
  lifetime_comments INTEGER DEFAULT 0,
  tags JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS videos_channel_idx ON videos(channel_id, published_at DESC);
CREATE INDEX IF NOT EXISTS videos_short_idx ON videos(is_short);

CREATE TABLE IF NOT EXISTS channel_daily (
  channel_id TEXT NOT NULL REFERENCES channels(channel_id),
  date DATE NOT NULL,
  views BIGINT NOT NULL DEFAULT 0,
  estimated_minutes_watched BIGINT NOT NULL DEFAULT 0,
  average_view_duration_seconds INTEGER NOT NULL DEFAULT 0,
  average_view_percentage REAL,
  subscribers_gained INTEGER NOT NULL DEFAULT 0,
  subscribers_lost INTEGER NOT NULL DEFAULT 0,
  likes BIGINT NOT NULL DEFAULT 0,
  comments BIGINT NOT NULL DEFAULT 0,
  shares BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, date)
);

CREATE TABLE IF NOT EXISTS video_stats (
  video_id TEXT NOT NULL REFERENCES videos(video_id),
  sync_date DATE NOT NULL,
  window_days INTEGER NOT NULL,
  views BIGINT NOT NULL DEFAULT 0,
  estimated_minutes_watched BIGINT NOT NULL DEFAULT 0,
  average_view_duration_seconds INTEGER NOT NULL DEFAULT 0,
  average_view_percentage REAL,
  likes BIGINT NOT NULL DEFAULT 0,
  comments BIGINT NOT NULL DEFAULT 0,
  shares BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (video_id, sync_date, window_days)
);

CREATE TABLE IF NOT EXISTS channel_traffic (
  channel_id TEXT NOT NULL REFERENCES channels(channel_id),
  sync_date DATE NOT NULL,
  window_days INTEGER NOT NULL,
  traffic_source TEXT NOT NULL,
  views BIGINT NOT NULL DEFAULT 0,
  estimated_minutes_watched BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, sync_date, window_days, traffic_source)
);

CREATE TABLE IF NOT EXISTS ai_recommendations (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL,
  channel_id TEXT,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS recommendation_evaluations (
  id BIGSERIAL PRIMARY KEY,
  recommendation_id BIGINT NOT NULL REFERENCES ai_recommendations(id) ON DELETE CASCADE,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verdict TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_errors (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  context TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_updates (
  update_id BIGINT PRIMARY KEY,
  handled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
