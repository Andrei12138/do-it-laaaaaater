-- Do It Laaaaaater Cloudflare D1 schema (SQLite)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_lower_name
  ON categories(user_id, LOWER(name));

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('link', 'text', 'image_group')),
  title TEXT NOT NULL,
  url TEXT,
  normalized_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  is_starred INTEGER NOT NULL DEFAULT 0,
  planned_for TEXT,
  trashed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_unique_url
  ON items(user_id, normalized_url) WHERE kind = 'link' AND normalized_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_user_status_date
  ON items(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_user_priority
  ON items(user_id, planned_for, is_starred, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_user_trash
  ON items(user_id, trashed_at, created_at DESC);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  quick_save_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('web_cover', 'attachment', 'gallery')),
  original_name TEXT NOT NULL,
  original_key TEXT NOT NULL UNIQUE,
  thumb_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  thumb_mime_type TEXT NOT NULL DEFAULT 'image/webp',
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_item_order
  ON assets(item_id, role, sort_order);
CREATE INDEX IF NOT EXISTS idx_assets_user
  ON assets(user_id);

CREATE TABLE IF NOT EXISTS memo_canvas (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  scene_json TEXT NOT NULL,
  background TEXT NOT NULL DEFAULT 'solid' CHECK(background IN ('solid', 'grid', 'dots', 'lines')),
  color_mode TEXT NOT NULL DEFAULT 'light' CHECK(color_mode IN ('light', 'dark')),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memo_assets (
  file_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, file_id)
);
CREATE INDEX IF NOT EXISTS idx_memo_assets_user_created
  ON memo_assets(user_id, created_at);
