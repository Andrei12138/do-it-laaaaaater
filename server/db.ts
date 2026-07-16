import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface AppContext {
  db: DatabaseSync
  dataDir: string
  originalsDir: string
  thumbsDir: string
}

export const DEFAULT_CATEGORIES = [
  { name: '工作', color: '#2563eb' },
  { name: '技术', color: '#7c3aed' },
  { name: '资讯', color: '#0891b2' },
  { name: '灵感', color: '#d97706' },
  { name: '生活', color: '#16a34a' },
  { name: '其他', color: '#64748b' }
] as const

export function initializeDatabase(db: DatabaseSync) {
  db.exec([
    'PRAGMA foreign_keys = ON;',
    'PRAGMA journal_mode = WAL;',
    'PRAGMA busy_timeout = 5000;',
    'CREATE TABLE IF NOT EXISTS users (',
    '  id TEXT PRIMARY KEY,',
    '  email TEXT NOT NULL UNIQUE,',
    '  password_hash TEXT NOT NULL,',
    '  created_at INTEGER NOT NULL',
    ');',
    'CREATE TABLE IF NOT EXISTS sessions (',
    '  id_hash TEXT PRIMARY KEY,',
    '  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,',
    '  expires_at INTEGER NOT NULL,',
    '  created_at INTEGER NOT NULL',
    ');',
    'CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);',
    'CREATE TABLE IF NOT EXISTS categories (',
    '  id TEXT PRIMARY KEY,',
    '  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,',
    '  name TEXT NOT NULL,',
    '  color TEXT NOT NULL,',
    '  sort_order INTEGER NOT NULL DEFAULT 0,',
    '  created_at INTEGER NOT NULL,',
    '  UNIQUE(user_id, name)',
    ');',
    'CREATE TABLE IF NOT EXISTS items (',
    '  id TEXT PRIMARY KEY,',
    '  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,',
    "  kind TEXT NOT NULL CHECK(kind IN ('link', 'text', 'image_group')),",
    '  title TEXT NOT NULL,',
    '  url TEXT,',
    '  normalized_url TEXT,',
    "  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),",
    '  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,',
    '  created_at INTEGER NOT NULL,',
    '  updated_at INTEGER NOT NULL,',
    '  completed_at INTEGER,',
    '  is_starred INTEGER NOT NULL DEFAULT 0,',
    '  planned_for TEXT,',
    '  trashed_at INTEGER',
    ');',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_items_unique_url',
    "  ON items(user_id, normalized_url) WHERE kind = 'link' AND normalized_url IS NOT NULL;",
    'CREATE INDEX IF NOT EXISTS idx_items_user_status_date',
    '  ON items(user_id, status, created_at DESC);',
    'CREATE TABLE IF NOT EXISTS tags (',
    '  id TEXT PRIMARY KEY,',
    '  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,',
    '  name TEXT NOT NULL,',
    '  created_at INTEGER NOT NULL,',
    '  UNIQUE(user_id, name)',
    ');',
    'CREATE TABLE IF NOT EXISTS item_tags (',
    '  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,',
    '  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,',
    '  PRIMARY KEY(item_id, tag_id)',
    ');',
    'CREATE TABLE IF NOT EXISTS assets (',
    '  id TEXT PRIMARY KEY,',
    '  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,',
    '  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,',
    "  role TEXT NOT NULL CHECK(role IN ('web_cover', 'attachment', 'gallery')),",
    '  original_name TEXT NOT NULL,',
    '  file_name TEXT NOT NULL,',
    '  thumb_name TEXT NOT NULL,',
    '  mime_type TEXT NOT NULL,',
    '  size INTEGER NOT NULL,',
    '  width INTEGER,',
    '  height INTEGER,',
    '  sort_order INTEGER NOT NULL DEFAULT 0,',
    '  created_at INTEGER NOT NULL',
    ');',
    'CREATE INDEX IF NOT EXISTS idx_assets_item_order',
    '  ON assets(item_id, role, sort_order);'
  ].join('\n'))

  const itemsSchema = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='items'"
  ).get() as { sql?: string } | undefined
  if (itemsSchema?.sql && !itemsSchema.sql.includes("'text'")) {
    db.exec('PRAGMA foreign_keys = OFF;')
    try {
      db.exec([
        'BEGIN IMMEDIATE;',
        'CREATE TABLE items_next (',
        '  id TEXT PRIMARY KEY,',
        '  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,',
        "  kind TEXT NOT NULL CHECK(kind IN ('link', 'text', 'image_group')),",
        '  title TEXT NOT NULL,',
        '  url TEXT,',
        '  normalized_url TEXT,',
        "  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),",
        '  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,',
        '  created_at INTEGER NOT NULL,',
        '  updated_at INTEGER NOT NULL,',
        '  completed_at INTEGER,',
        '  is_starred INTEGER NOT NULL DEFAULT 0,',
        '  planned_for TEXT,',
        '  trashed_at INTEGER',
        ');',
        'INSERT INTO items_next (id,user_id,kind,title,url,normalized_url,status,category_id,created_at,updated_at,completed_at,is_starred,planned_for,trashed_at)',
        '  SELECT id,user_id,kind,title,url,normalized_url,status,category_id,created_at,updated_at,completed_at,0,NULL,NULL FROM items;',
        'DROP TABLE items;',
        'ALTER TABLE items_next RENAME TO items;',
        'CREATE UNIQUE INDEX idx_items_unique_url',
        "  ON items(user_id, normalized_url) WHERE kind = 'link' AND normalized_url IS NOT NULL;",
        'CREATE INDEX idx_items_user_status_date',
        '  ON items(user_id, status, created_at DESC);',
        'COMMIT;'
      ].join('\n'))
    } catch (error) {
      try {
        db.exec('ROLLBACK;')
      } catch {
        // The migration may have failed before opening a transaction.
      }
      throw error
    } finally {
      db.exec('PRAGMA foreign_keys = ON;')
    }
    const violations = db.prepare('PRAGMA foreign_key_check').all()
    if (violations.length) throw new Error('数据库升级后发现关联数据异常')
  }

  const itemColumns = new Set(
    (db.prepare('PRAGMA table_info(items)').all() as Array<{ name: string }>).map((column) => column.name)
  )
  if (!itemColumns.has('is_starred')) {
    db.exec('ALTER TABLE items ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0;')
  }
  if (!itemColumns.has('planned_for')) {
    db.exec('ALTER TABLE items ADD COLUMN planned_for TEXT;')
  }
  if (!itemColumns.has('trashed_at')) {
    db.exec('ALTER TABLE items ADD COLUMN trashed_at INTEGER;')
  }
  db.exec([
    'CREATE INDEX IF NOT EXISTS idx_items_user_priority',
    '  ON items(user_id, planned_for, is_starred, created_at DESC);',
    'CREATE INDEX IF NOT EXISTS idx_items_user_trash',
    '  ON items(user_id, trashed_at, created_at DESC);',
    'CREATE TABLE IF NOT EXISTS user_preferences (',
    '  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,',
    '  quick_save_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,',
    '  updated_at INTEGER NOT NULL',
    ');',
    'INSERT OR IGNORE INTO user_preferences (user_id,quick_save_category_id,updated_at)',
    "  SELECT u.id,(SELECT c.id FROM categories c WHERE c.user_id=u.id AND LOWER(c.name)=LOWER('其他') LIMIT 1),strftime('%s','now')*1000",
    '  FROM users u;'
  ].join('\n'))
}

export function createContext(dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data')): AppContext {
  const resolvedDataDir = path.resolve(dataDir)
  const originalsDir = path.join(resolvedDataDir, 'images', 'originals')
  const thumbsDir = path.join(resolvedDataDir, 'images', 'thumbs')
  mkdirSync(originalsDir, { recursive: true })
  mkdirSync(thumbsDir, { recursive: true })
  const db = new DatabaseSync(path.join(resolvedDataDir, 'do-it-laaaaaater.sqlite'))
  initializeDatabase(db)
  return { db, dataDir: resolvedDataDir, originalsDir, thumbsDir }
}

export function runTransaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
