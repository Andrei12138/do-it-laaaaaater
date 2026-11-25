-- Personal Moments Blog Phase 2 Schema:
-- 1. R2 Music Playlist & Tracks (blog_music_tracks)
-- 2. Standalone Pages & Page Comments (/about, blog_pages, blog_page_comments)
-- 3. Catalog Items (/equipment & /labs, blog_catalog_items)
-- 4. Friend Links (/friends, blog_friends)

CREATE TABLE IF NOT EXISTS blog_music_tracks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  audio_media_id TEXT NOT NULL,
  cover_media_id TEXT,
  lrc_text TEXT NOT NULL DEFAULT '',
  duration_sec INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blog_music_tracks_user_order
  ON blog_music_tracks(user_id, sort_order ASC, created_at DESC);

CREATE TABLE IF NOT EXISTS blog_pages (
  slug TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  cover_media_id TEXT,
  allow_comments INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, slug)
);

CREATE TABLE IF NOT EXISTS blog_page_comments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_slug TEXT NOT NULL,
  parent_id TEXT REFERENCES blog_page_comments(id) ON DELETE CASCADE,
  reply_to_id TEXT,
  reply_to_name TEXT,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL DEFAULT '',
  author_website TEXT NOT NULL DEFAULT '',
  is_owner INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blog_page_comments_slug
  ON blog_page_comments(user_id, page_slug, created_at ASC);

CREATE TABLE IF NOT EXISTS blog_catalog_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK(section IN ('equipment', 'labs')),
  category TEXT NOT NULL DEFAULT '默认',
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  image_media_id TEXT,
  image_url TEXT,
  link_url TEXT NOT NULL DEFAULT '',
  tag TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blog_catalog_section_order
  ON blog_catalog_items(user_id, section, sort_order ASC, created_at DESC);

CREATE TABLE IF NOT EXISTS blog_friends (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  avatar_media_id TEXT,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blog_friends_user_order
  ON blog_friends(user_id, sort_order ASC, created_at DESC);
