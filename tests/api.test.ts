import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import request from 'supertest'
import sharp from 'sharp'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/app.js'
import { createContext, type AppContext } from '../server/db.js'
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_ITEM } from '../server/storage.js'

let PNG: Buffer

beforeAll(async () => {
  PNG = await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 4,
      background: { r: 37, g: 99, b: 235, alpha: 1 }
    }
  }).png().toBuffer()
})

describe('本地应用接口', () => {
  let directory: string
  let context: AppContext
  let agent: ReturnType<typeof request.agent>

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'do-it-later-test-'))
    context = createContext(directory)
    agent = request.agent(createApp(context))
  })

  afterEach(() => {
    context.db.close()
    rmSync(directory, { recursive: true, force: true })
  })

  async function setup() {
    const response = await agent.post('/api/auth/setup').send({
      email: 'owner@example.com',
      password: 'a-secure-password'
    })
    expect(response.status).toBe(201)
  }

  it('只允许创建一个账号，并可修改密码重新登录', async () => {
    await setup()
    const second = await agent.post('/api/auth/setup').send({
      email: 'second@example.com',
      password: 'another-password'
    })
    expect(second.status).toBe(409)

    const categories = await agent.get('/api/categories')
    expect(categories.status).toBe(200)
    expect(categories.body.map((entry: { name: string }) => entry.name)).toEqual([
      '工作',
      '技术',
      '资讯',
      '灵感',
      '生活',
      '其他'
    ])

    const changed = await agent.post('/api/auth/change-password').send({
      currentPassword: 'a-secure-password',
      newPassword: 'the-new-secure-password'
    })
    expect(changed.status).toBe(200)
    await agent.post('/api/auth/logout')
    expect((await agent.post('/api/auth/login').send({
      email: 'owner@example.com',
      password: 'a-secure-password'
    })).status).toBe(401)
    expect((await agent.post('/api/auth/login').send({
      email: 'owner@example.com',
      password: 'the-new-secure-password'
    })).status).toBe(200)
  })

  it('离线队列使用客户端 ID 幂等重放，并检测跨设备冲突', async () => {
    await setup()
    const categoryId = randomUUID()
    const categoryBody = { id: categoryId, name: '离线类别', color: '#123456' }
    expect((await agent.post('/api/categories').send(categoryBody)).body.id).toBe(categoryId)
    expect((await agent.post('/api/categories').send(categoryBody)).body.id).toBe(categoryId)

    const itemId = randomUUID()
    const createdAt = 1_700_000_000_000
    const first = await agent.post('/api/items/text').send({
      id: itemId,
      createdAt,
      title: '断网时写下的内容',
      categoryId
    })
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ id: itemId, createdAt })

    const replay = await agent.post('/api/items/text').send({
      id: itemId,
      createdAt,
      title: '断网时写下的内容',
      categoryId
    })
    expect(replay.status).toBe(200)
    expect(replay.body.id).toBe(itemId)

    const changed = await agent.patch('/api/items/' + itemId).send({
      baseUpdatedAt: first.body.updatedAt,
      isStarred: true
    })
    expect(changed.status).toBe(200)
    expect(changed.body.isStarred).toBe(true)

    const conflict = await agent.patch('/api/items/' + itemId).send({
      baseUpdatedAt: first.body.updatedAt,
      plannedFor: '2030-01-01'
    })
    expect(conflict.status).toBe(409)
    expect(conflict.body.details.conflict).toBe(true)
  })

  it('保存、搜索、去重并切换网页状态', async () => {
    await setup()
    const categories = (await agent.get('/api/categories')).body as Array<{ id: string; name: string }>
    const work = categories.find((category) => category.name === '工作') as { id: string }
    const created = await agent
      .post('/api/items/link')
      .field('url', 'https://example.com/article?q=1#section')
      .field('title', '待阅读的示例文章')
      .field('categoryId', work.id)
      .field('tags', JSON.stringify(['研究', '示例']))
    expect(created.status).toBe(201)
    expect(created.body.url).toBe('https://example.com/article?q=1')

    const duplicate = await agent
      .post('/api/items/link')
      .field('url', 'https://EXAMPLE.com/article?q=1')
      .field('title', '重复')
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.details.existingId).toBe(created.body.id)

    expect((await agent.delete('/api/items/' + created.body.id)).status).toBe(200)
    const duplicateInTrash = await agent
      .post('/api/items/link')
      .field('url', 'https://example.com/article?q=1')
      .field('title', '回收站重复')
    expect(duplicateInTrash.status).toBe(409)
    expect(duplicateInTrash.body.details.trashed).toBe(true)
    expect((await agent.post('/api/items/' + created.body.id + '/restore')).status).toBe(200)

    const search = await agent.get('/api/items').query({ status: 'pending', q: '研究' })
    expect(search.status).toBe(200)
    expect(search.body).toHaveLength(1)

    const completed = await agent.put('/api/items/' + created.body.id).send({
      title: created.body.title,
      url: created.body.url,
      categoryId: work.id,
      tags: ['研究', '示例'],
      status: 'completed'
    })
    expect(completed.status).toBe(200)
    expect(completed.body.status).toBe('completed')
    expect(completed.body.completedAt).toBeTypeOf('number')
    expect((await agent.get('/api/items').query({ status: 'pending' })).body).toHaveLength(0)
    expect((await agent.get('/api/items').query({ status: 'completed' })).body).toHaveLength(1)
  })

  it('可保存、筛选和编辑只有标题与类别的文本条目', async () => {
    await setup()
    const categories = (await agent.get('/api/categories')).body as Array<{ id: string; name: string }>
    const life = categories.find((category) => category.name === '生活') as { id: string }
    const created = await agent.post('/api/items/text').send({
      title: '下班后继续处理这段文字',
      categoryId: life.id
    })
    expect(created.status).toBe(201)
    expect(created.body.kind).toBe('text')
    expect(created.body.url).toBeNull()
    expect(created.body.category.name).toBe('生活')

    const filtered = await agent.get('/api/items').query({ kind: 'text', q: '下班后' })
    expect(filtered.status).toBe(200)
    expect(filtered.body).toHaveLength(1)
    expect(filtered.body[0].id).toBe(created.body.id)

    const updated = await agent.put('/api/items/' + created.body.id).send({
      title: '已经修改的文本',
      categoryId: life.id,
      status: 'completed'
    })
    expect(updated.status).toBe(200)
    expect(updated.body.title).toBe('已经修改的文本')
    expect(updated.body.status).toBe('completed')

    const rejectedImage = await agent
      .post('/api/items/' + created.body.id + '/assets')
      .attach('images', PNG, { filename: 'not-needed.png', contentType: 'image/png' })
    expect(rejectedImage.status).toBe(400)
    expect(rejectedImage.body.error).toContain('文本条目')
  })

  it('保存图片组、增加图片、限制最后一张并清理文件', async () => {
    await setup()
    const created = await agent
      .post('/api/items/image-group')
      .field('title', '截图资料')
      .field('tags', JSON.stringify(['截图']))
      .attach('images', PNG, { filename: 'first.png', contentType: 'image/png' })
    expect(created.status).toBe(201)
    expect(created.body.assets).toHaveLength(1)
    const first = created.body.assets[0]
    expect(existsSync(path.join(context.originalsDir, path.basename(first.originalUrl)))).toBe(false)
    expect(readdirSync(context.originalsDir)).toHaveLength(1)
    expect(readdirSync(context.thumbsDir)).toHaveLength(1)
    expect(readFileSync(path.join(context.originalsDir, readdirSync(context.originalsDir)[0]))).toEqual(PNG)

    const imageResponse = await agent.get(first.thumbUrl)
    expect(imageResponse.status).toBe(200)
    expect(imageResponse.headers['content-type']).toContain('image/webp')

    const added = await agent
      .post('/api/items/' + created.body.id + '/assets')
      .attach('images', PNG, { filename: 'second.png', contentType: 'image/png' })
    expect(added.status).toBe(201)
    expect(added.body.assets).toHaveLength(2)

    const orderedIds = added.body.assets.map((asset: { id: string }) => asset.id).reverse()
    const ordered = await agent
      .put('/api/items/' + created.body.id + '/assets/order')
      .send({ ids: orderedIds })
    expect(ordered.status).toBe(200)
    expect(ordered.body.assets[0].id).toBe(orderedIds[0])

    expect((await agent.delete('/api/assets/' + ordered.body.assets[1].id)).status).toBe(200)
    expect((await agent.delete('/api/assets/' + ordered.body.assets[0].id)).status).toBe(400)
    expect((await agent.delete('/api/items/' + created.body.id)).status).toBe(200)
    expect(readdirSync(context.originalsDir)).toHaveLength(1)
    expect(readdirSync(context.thumbsDir)).toHaveLength(1)
    expect((await agent.get('/api/items?status=all')).body).toHaveLength(0)
    expect((await agent.get('/api/items?status=all&trash=only')).body).toHaveLength(1)
    expect((await agent.post('/api/items/' + created.body.id + '/restore')).status).toBe(200)
    expect((await agent.get('/api/items?status=all')).body).toHaveLength(1)
    expect((await agent.delete('/api/items/' + created.body.id)).status).toBe(200)
    expect((await agent.delete('/api/items/' + created.body.id + '/permanent')).status).toBe(200)
    expect(readdirSync(context.originalsDir)).toHaveLength(0)
    expect(readdirSync(context.thumbsDir)).toHaveLength(0)
  })

  it('回收站满 7 天后在下次打开清单时自动清理图片', async () => {
    await setup()
    const created = await agent
      .post('/api/items/image-group')
      .field('title', '过期回收站图片')
      .attach('images', PNG, { filename: 'expired.png', contentType: 'image/png' })
    expect(created.status).toBe(201)
    expect((await agent.delete('/api/items/' + created.body.id)).status).toBe(200)
    context.db.prepare('UPDATE items SET trashed_at=? WHERE id=?').run(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
      created.body.id
    )
    const trash = await agent.get('/api/items?status=all&trash=only')
    expect(trash.status).toBe(200)
    expect(trash.body).toHaveLength(0)
    expect(readdirSync(context.originalsDir)).toHaveLength(0)
    expect(readdirSync(context.thumbsDir)).toHaveLength(0)
  })

  it('链接可携带截图，并拒绝无效、过大的图片和超过数量上限的附件', async () => {
    await setup()

    const invalid = await agent
      .post('/api/items/image-group')
      .field('title', '无效图片')
      .attach('images', Buffer.from('not-an-image'), { filename: 'fake.png', contentType: 'image/png' })
    expect(invalid.status).toBe(400)
    expect(invalid.body.error).toContain('只支持')
    expect(readdirSync(context.originalsDir)).toHaveLength(0)
    expect(readdirSync(context.thumbsDir)).toHaveLength(0)

    const tooLarge = await agent
      .post('/api/items/image-group')
      .field('title', '过大图片')
      .attach('images', Buffer.alloc(MAX_IMAGE_BYTES + 1), {
        filename: 'too-large.png',
        contentType: 'image/png'
      })
    expect(tooLarge.status).toBe(400)
    expect(tooLarge.body.error).toContain('20 MB')

    let linkRequest = agent
      .post('/api/items/link')
      .field('url', 'https://example.com/with-screenshots')
      .field('title', '带截图的网页')
    for (let index = 0; index < MAX_IMAGES_PER_ITEM; index += 1) {
      linkRequest = linkRequest.attach('images', PNG, {
        filename: `screenshot-${index + 1}.png`,
        contentType: 'image/png'
      })
    }
    const link = await linkRequest
    expect(link.status).toBe(201)
    expect(link.body.assets).toHaveLength(MAX_IMAGES_PER_ITEM)
    expect(link.body.assets.every((asset: { role: string }) => asset.role === 'attachment')).toBe(true)

    const overflow = await agent
      .post('/api/items/' + link.body.id + '/assets')
      .attach('images', PNG, { filename: 'one-too-many.png', contentType: 'image/png' })
    expect(overflow.status).toBe(400)
    expect(overflow.body.error).toContain('最多保存 30 张')
  })

  it('关闭并重新打开数据库后，账号、链接和图片仍然保留', async () => {
    await setup()
    const created = await agent
      .post('/api/items/link')
      .field('url', 'https://example.com/persistent')
      .field('title', '重启后仍保留')
      .field('tags', JSON.stringify(['持久保存']))
      .attach('images', PNG, { filename: 'persistent.png', contentType: 'image/png' })
    expect(created.status).toBe(201)
    const itemId = created.body.id as string

    context.db.close()
    context = createContext(directory)
    agent = request.agent(createApp(context))

    const login = await agent.post('/api/auth/login').send({
      email: 'owner@example.com',
      password: 'a-secure-password'
    })
    expect(login.status).toBe(200)
    const items = await agent.get('/api/items').query({ q: '持久保存' })
    expect(items.status).toBe(200)
    expect(items.body).toHaveLength(1)
    expect(items.body[0].id).toBe(itemId)
    expect(items.body[0].assets).toHaveLength(1)
    expect(readdirSync(context.originalsDir)).toHaveLength(1)
    expect(readdirSync(context.thumbsDir)).toHaveLength(1)
    expect((await agent.get(items.body[0].assets[0].originalUrl)).status).toBe(200)
  })

  it('可新增、修改并删除类别，内网网页抓取会被拦截', async () => {
    await setup()
    const added = await agent.post('/api/categories').send({ name: '稍后研究', color: '#123456' })
    expect(added.status).toBe(201)
    expect((await agent.put('/api/categories/' + added.body.id).send({
      name: '重点研究',
      color: '#654321'
    })).status).toBe(200)
    expect((await agent.delete('/api/categories/' + added.body.id)).status).toBe(200)

    const blocked = await agent.post('/api/metadata').send({ url: 'http://127.0.0.1/private' })
    expect(blocked.status).toBe(422)
    expect(blocked.body.error).toContain('内网')
  })

  it('默认类别、星标、今日计划、智能排序和批量操作保持一致', async () => {
    await setup()
    const categories = (await agent.get('/api/categories')).body as Array<{ id: string; name: string }>
    const other = categories.find((category) => category.name === '其他') as { id: string }
    expect((await agent.get('/api/preferences')).body.quickSaveCategoryId).toBe(other.id)

    const overdue = (await agent.post('/api/items/text').send({ title: '逾期', categoryId: other.id })).body
    const todayItem = (await agent.post('/api/items/text').send({ title: '今天', categoryId: other.id })).body
    const starred = (await agent.post('/api/items/text').send({ title: '星标', categoryId: other.id })).body
    const ordinary = (await agent.post('/api/items/text').send({ title: '普通', categoryId: other.id })).body
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date())

    expect((await agent.patch('/api/items/' + overdue.id).send({ plannedFor: '2020-01-01' })).status).toBe(200)
    expect((await agent.patch('/api/items/' + todayItem.id).send({ plannedFor: today })).status).toBe(200)
    expect((await agent.patch('/api/items/' + starred.id).send({ isStarred: true })).status).toBe(200)
    const ordered = await agent.get('/api/items').query({ status: 'pending', sort: 'smart' })
    expect(ordered.body.map((item: { id: string }) => item.id)).toEqual([
      overdue.id,
      todayItem.id,
      starred.id,
      ordinary.id
    ])
    expect((await agent.get('/api/items').query({ priority: 'planned' })).body).toHaveLength(2)
    expect((await agent.get('/api/items').query({ priority: 'starred' })).body[0].id).toBe(starred.id)

    const bulk = await agent.post('/api/items/bulk').send({
      ids: [starred.id, ordinary.id],
      changes: { isStarred: true, plannedFor: today }
    })
    expect(bulk.status).toBe(200)
    expect(bulk.body.succeededIds).toEqual([starred.id, ordinary.id])
    expect(bulk.body.failed).toEqual([])

    const completed = await agent.patch('/api/items/' + todayItem.id).send({ status: 'completed' })
    expect(completed.body.status).toBe('completed')
    expect(completed.body.plannedFor).toBeNull()
    expect(completed.body.completedAt).toBeTypeOf('number')

    expect((await agent.delete('/api/categories/' + other.id)).status).toBe(200)
    expect((await agent.get('/api/preferences')).body.quickSaveCategoryId).toBeNull()
  })

  it('重复网址不会修改原条目，备份条目可安全合并并完整清理', async () => {
    await setup()
    const original = await agent.post('/api/items/link')
      .field('url', 'https://example.com/no-touch')
      .field('title', '原条目')
    expect(original.status).toBe(201)
    const before = context.db.prepare('SELECT created_at,updated_at,title FROM items WHERE id=?').get(original.body.id) as {
      created_at: number
      updated_at: number
      title: string
    }
    const duplicate = await agent.post('/api/items/link')
      .field('url', 'https://EXAMPLE.com/no-touch#fragment')
      .field('title', '不应覆盖')
    expect(duplicate.status).toBe(409)
    expect(context.db.prepare('SELECT created_at,updated_at,title FROM items WHERE id=?').get(original.body.id)).toEqual(before)

    const categories = (await agent.get('/api/categories')).body as Array<{ id: string; name: string }>
    const categoryId = categories.find((category) => category.name === '技术')?.id as string
    const backupId = randomUUID()
    const backupItem = {
      id: backupId,
      kind: 'image_group',
      title: '从备份恢复的图片组',
      url: null,
      status: 'pending',
      createdAt: Date.now() - 1000,
      updatedAt: Date.now() - 500,
      completedAt: null,
      isStarred: true,
      plannedFor: '2026-07-15',
      assets: [{
        role: 'gallery',
        originalName: 'backup.png',
        mimeType: 'image/png',
        size: PNG.length,
        sortOrder: 0,
        path: 'images/item/backup.png'
      }]
    }
    const restored = await agent.post('/api/backup/item')
      .field('item', JSON.stringify(backupItem))
      .field('categoryId', categoryId)
      .attach('images', PNG, { filename: 'backup.png', contentType: 'image/png' })
    expect(restored.status).toBe(201)
    expect(restored.body.status).toBe('added')
    const repeated = await agent.post('/api/backup/item')
      .field('item', JSON.stringify(backupItem))
      .field('categoryId', categoryId)
      .attach('images', PNG, { filename: 'backup.png', contentType: 'image/png' })
    expect(repeated.body.status).toBe('skipped')
    const restoredItem = (await agent.get('/api/items/' + backupId)).body
    expect(restoredItem.isStarred).toBe(true)
    expect(restoredItem.assets).toHaveLength(1)

    const cleared = await agent.post('/api/backup/clear').send({ confirmed: true })
    expect(cleared.status).toBe(200)
    expect((await agent.get('/api/items')).body).toHaveLength(0)
    expect((await agent.get('/api/categories')).body).toHaveLength(0)
    expect(readdirSync(context.originalsDir)).toHaveLength(0)
    expect((await agent.get('/api/auth/status')).body.authenticated).toBe(true)
  })
})

describe('数据库升级', () => {
  it('升级旧数据结构时保留原有条目并支持文本类型', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'do-it-later-migration-'))
    const databasePath = path.join(directory, 'do-it-laaaaaater.sqlite')
    const legacy = new DatabaseSync(databasePath)
    legacy.exec([
      'CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL);',
      'CREATE TABLE items (',
      'id TEXT PRIMARY KEY,',
      'user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,',
      "kind TEXT NOT NULL CHECK(kind IN ('link', 'image_group')),",
      'title TEXT NOT NULL,url TEXT,normalized_url TEXT,',
      "status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),",
      'category_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,completed_at INTEGER',
      ');',
      "INSERT INTO users VALUES ('user-1','owner@example.com','hash',1);",
      "INSERT INTO items VALUES ('item-1','user-1','link','原有网页','https://example.com/','https://example.com/','pending',NULL,1,1,NULL);"
    ].join('\n'))
    legacy.close()

    const migrated = createContext(directory)
    try {
      const schema = migrated.db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='items'"
      ).get() as { sql: string }
      expect(schema.sql).toContain("'text'")
      expect(schema.sql).toContain('is_starred')
      expect(schema.sql).toContain('planned_for')
      expect((migrated.db.prepare('SELECT title FROM items WHERE id=?').get('item-1') as { title: string }).title)
        .toBe('原有网页')
      expect(() => migrated.db.prepare(
        "INSERT INTO items (id,user_id,kind,title,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)"
      ).run('item-2', 'user-1', 'text', '新文本', 'pending', 2, 2)).not.toThrow()
      expect(migrated.db.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0)
      expect(migrated.db.prepare('SELECT quick_save_category_id FROM user_preferences WHERE user_id=?').get('user-1'))
        .toEqual({ quick_save_category_id: null })
    } finally {
      migrated.db.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
