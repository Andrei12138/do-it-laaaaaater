-- Add per-track visual/audio reactivity configuration JSON to blog_music_tracks
ALTER TABLE blog_music_tracks ADD COLUMN visual_config_json TEXT NOT NULL DEFAULT '{}';
