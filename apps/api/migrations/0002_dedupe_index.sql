-- Client-computed dedupe keys are unique per site (snippet includes a time bucket).
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_dedupe ON analytics_events(site_id, dedupe_hash) WHERE dedupe_hash IS NOT NULL;
