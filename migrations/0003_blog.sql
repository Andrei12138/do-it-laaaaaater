-- Personal Moments Blog (朋友圈博客) schema for Cloudflare D1
-- Extensible for Phase 2 (music playlists, live photos, videos, douban cards, custom pages)

CREATE TABLE IF NOT EXISTS blog_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  site_name TEXT NOT NULL DEFAULT '朋友圈博客',
  nickname TEXT NOT NULL DEFAULT '博主',
  bio TEXT NOT NULL DEFAULT '记录日常灵感、阅读摘录与长文思考',
  avatar_media_id TEXT,
  cover_media_id TEXT,
  footer_text TEXT NOT NULL DEFAULT '',
  allow_comments INTEGER NOT NULL DEFAULT 1,
  extensions_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blog_media (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'image' CHECK(kind IN ('image', 'video', 'audio', 'lyric', 'file')),
  original_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  thumb_key TEXT,
  mime_type TEXT NOT NULL,
  thumb_mime_type TEXT,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  paired_media_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blog_media_user_created
  ON blog_media(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS blog_posts (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('moment', 'article')),
  title TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  cover_media_id TEXT,
  cover_url TEXT,
  category TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  images_json TEXT NOT NULL DEFAULT '[]',
  link_card_json TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  source_label TEXT NOT NULL DEFAULT '',
  source_item_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'private', 'password')),
  password_hash TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blog_posts_feed
  ON blog_posts(user_id, is_pinned DESC, published_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_type_pub
  ON blog_posts(user_id, type, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_short_id
  ON blog_posts(short_id);

CREATE TABLE IF NOT EXISTS blog_likes (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  visitor_key TEXT NOT NULL,
  author_name TEXT NOT NULL,
  is_owner INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(post_id, visitor_key)
);
CREATE INDEX IF NOT EXISTS idx_blog_likes_post
  ON blog_likes(post_id, created_at ASC);

CREATE TABLE IF NOT EXISTS blog_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES blog_comments(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_blog_comments_post
  ON blog_comments(post_id, created_at ASC);

CREATE TABLE IF NOT EXISTS blog_comment_likes (
  comment_id TEXT NOT NULL REFERENCES blog_comments(id) ON DELETE CASCADE,
  visitor_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(comment_id, visitor_key)
);
