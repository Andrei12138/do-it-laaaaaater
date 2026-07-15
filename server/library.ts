import { randomUUID } from 'node:crypto'
import type { AppContext } from './db.js'

type Row = Record<string, unknown>

function numberOrNull(value: unknown) {
  return value === null || value === undefined ? null : Number(value)
}

export function serializeItem(context: AppContext, userId: string, row: Row) {
  const category = row.category_id
    ? context.db.prepare('SELECT id,name,color FROM categories WHERE id = ? AND user_id = ?').get(
        String(row.category_id),
        userId
      ) as Row | undefined
    : undefined
  const tags = context.db.prepare(
    'SELECT t.id,t.name FROM tags t JOIN item_tags it ON it.tag_id=t.id WHERE it.item_id=? ORDER BY t.name COLLATE NOCASE'
  ).all(String(row.id)) as Row[]
  const assets = context.db.prepare(
    "SELECT * FROM assets WHERE item_id=? AND user_id=? ORDER BY CASE role WHEN 'web_cover' THEN 0 WHEN 'gallery' THEN 1 ELSE 2 END, sort_order, created_at"
  ).all(String(row.id), userId) as Row[]

  return {
    id: String(row.id),
    kind: String(row.kind),
    title: String(row.title),
    url: row.url ? String(row.url) : null,
    status: String(row.status),
    category: category
      ? { id: String(category.id), name: String(category.name), color: String(category.color) }
      : null,
    tags: tags.map((tag) => ({ id: String(tag.id), name: String(tag.name) })),
    assets: assets.map((asset) => ({
      id: String(asset.id),
      role: String(asset.role),
      originalName: String(asset.original_name),
      mimeType: String(asset.mime_type),
      size: Number(asset.size),
      width: numberOrNull(asset.width),
      height: numberOrNull(asset.height),
      sortOrder: Number(asset.sort_order),
      thumbUrl: '/api/assets/' + String(asset.id) + '?variant=thumb',
      originalUrl: '/api/assets/' + String(asset.id) + '?variant=original'
    })),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: numberOrNull(row.completed_at)
  }
}

export function getItem(context: AppContext, userId: string, itemId: string) {
  const row = context.db.prepare('SELECT * FROM items WHERE id=? AND user_id=?').get(itemId, userId) as Row | undefined
  return row ? serializeItem(context, userId, row) : null
}

export interface ItemFilters {
  status?: string
  kind?: string
  category?: string
  tag?: string
  date?: string
  q?: string
}

export function listItems(context: AppContext, userId: string, filters: ItemFilters) {
  const conditions = ['i.user_id = ?']
  const params: Array<string | number> = [userId]

  if (filters.status === 'pending' || filters.status === 'completed') {
    conditions.push('i.status = ?')
    params.push(filters.status)
  }
  if (filters.kind === 'link' || filters.kind === 'text' || filters.kind === 'image_group') {
    conditions.push('i.kind = ?')
    params.push(filters.kind)
  }
  if (filters.category) {
    if (filters.category === 'uncategorized') {
      conditions.push('i.category_id IS NULL')
    } else {
      conditions.push('i.category_id = ?')
      params.push(filters.category)
    }
  }
  if (filters.tag) {
    conditions.push('EXISTS (SELECT 1 FROM item_tags fit WHERE fit.item_id=i.id AND fit.tag_id=?)')
    params.push(filters.tag)
  }
  if (filters.date && /^\d{4}-\d{2}-\d{2}$/.test(filters.date)) {
    conditions.push("strftime('%Y-%m-%d', i.created_at / 1000, 'unixepoch', '+8 hours') = ?")
    params.push(filters.date)
  }
  const query = (filters.q || '').trim().toLowerCase()
  if (query) {
    const needle = '%' + query.replace(/[\\%_]/g, '\\$&') + '%'
    conditions.push([
      '(',
      "LOWER(i.title) LIKE ? ESCAPE '\\'",
      "OR LOWER(COALESCE(i.url,'')) LIKE ? ESCAPE '\\'",
      "OR EXISTS (SELECT 1 FROM categories qc WHERE qc.id=i.category_id AND LOWER(qc.name) LIKE ? ESCAPE '\\')",
      "OR EXISTS (SELECT 1 FROM item_tags qit JOIN tags qt ON qt.id=qit.tag_id WHERE qit.item_id=i.id AND LOWER(qt.name) LIKE ? ESCAPE '\\')",
      "OR EXISTS (SELECT 1 FROM assets qa WHERE qa.item_id=i.id AND LOWER(qa.original_name) LIKE ? ESCAPE '\\')",
      ')'
    ].join(' '))
    params.push(needle, needle, needle, needle, needle)
  }

  const sql = 'SELECT i.* FROM items i WHERE ' + conditions.join(' AND ') + ' ORDER BY i.created_at DESC, i.id DESC'
  const rows = context.db.prepare(sql).all(...params) as Row[]
  return rows.map((row) => serializeItem(context, userId, row))
}

export function ensureCategory(context: AppContext, userId: string, categoryId: string | null | undefined) {
  if (!categoryId) return null
  const row = context.db.prepare('SELECT id FROM categories WHERE id=? AND user_id=?').get(categoryId, userId)
  if (!row) throw new Error('所选类别不存在')
  return categoryId
}

function normalizeTagNames(input: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of input) {
    const value = raw.replace(/\s+/g, ' ').trim().slice(0, 40)
    const key = value.toLocaleLowerCase('zh-CN')
    if (value && !seen.has(key)) {
      seen.add(key)
      result.push(value)
    }
    if (result.length >= 20) break
  }
  return result
}

export function syncItemTags(context: AppContext, userId: string, itemId: string, input: string[]) {
  const names = normalizeTagNames(input)
  context.db.prepare('DELETE FROM item_tags WHERE item_id=?').run(itemId)
  for (const name of names) {
    let tag = context.db.prepare(
      'SELECT id FROM tags WHERE user_id=? AND LOWER(name)=LOWER(?) LIMIT 1'
    ).get(userId, name) as Row | undefined
    if (!tag) {
      const id = randomUUID()
      context.db.prepare('INSERT INTO tags (id,user_id,name,created_at) VALUES (?,?,?,?)').run(
        id,
        userId,
        name,
        Date.now()
      )
      tag = { id }
    }
    context.db.prepare('INSERT OR IGNORE INTO item_tags (item_id,tag_id) VALUES (?,?)').run(
      itemId,
      String(tag.id)
    )
  }
  removeUnusedTags(context, userId)
}

export function removeUnusedTags(context: AppContext, userId: string) {
  context.db.prepare(
    'DELETE FROM tags WHERE user_id=? AND NOT EXISTS (SELECT 1 FROM item_tags it WHERE it.tag_id=tags.id)'
  ).run(userId)
}

export function createTagId() {
  return randomUUID()
}
