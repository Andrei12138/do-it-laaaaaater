import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'

async function selectAnimalOption(page: Page, name: string, option: string) {
  await page.getByRole('combobox', { name }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('从首次建号到直接粘贴网页、文字和图片的完整流程', async ({ page, context }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'flat-2013')
  await page.evaluate(() => localStorage.setItem('do-it-laaaaaater.theme.v1', 'unknown-theme'))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'flat-2013')
  await expect(page.getByRole('button', { name: '设计风格' })).toBeVisible()
  await page.getByRole('button', { name: '设计风格' }).click()
  const setupThemeDialog = page.getByRole('dialog', { name: '选择设计风格' })
  await page.screenshot({ path: 'test-results/flat-theme-picker.png', fullPage: true })
  await setupThemeDialog.getByRole('radio', { name: /Animal Island UI/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'animal-island')
  await page.screenshot({ path: 'test-results/animal-theme-picker.png', fullPage: true })
  await setupThemeDialog.getByRole('radio', { name: /Flat Design 2013/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'flat-2013')
  await setupThemeDialog.getByRole('button', { name: '关闭' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('do-it-laaaaaater.theme.v1'))).toBe('flat-2013')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'flat-2013')
  await expect(page.getByRole('heading', { name: 'Do It Laaaaaater' })).toBeVisible()
  await expect(page.locator('.auth-card')).toHaveCSS('background-image', 'none')
  await expect(page.locator('.auth-card')).toHaveCSS('box-shadow', 'none')
  await expect(page.locator('.auth-card')).toHaveCSS('border-radius', '0px')
  await expect(page.getByLabel(/^密码/)).toHaveCSS('border-top-width', '0px')
  await page.screenshot({ path: 'test-results/setup-screen.png', fullPage: true })
  await page.getByLabel('邮箱').fill('owner@example.com')
  await page.getByLabel(/^密码/).fill('a-secure-password')
  await page.getByLabel('再次输入密码').fill('a-secure-password')
  await page.getByRole('button', { name: '创建账号并开始使用' }).click()
  await expect(page.locator('.app-header')).toBeVisible()
  await expect(page.locator('.app-header')).toHaveCSS('background-image', 'none')
  await expect(page.locator('.toolbar')).toHaveCSS('box-shadow', 'none')

  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => navigator.clipboard.writeText('https://example.com/read-later'))
  await page.locator('.main-content').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+V')
  const linkDialog = page.getByRole('dialog', { name: '添加网页' })
  await expect(linkDialog.getByLabel('网页地址')).toHaveValue('https://example.com/read-later')
  await expect(linkDialog.locator(':scope > div')).toHaveCSS('clip-path', 'none')
  await expect(linkDialog).toHaveCSS('border-radius', '0px')
  await expect(linkDialog).toHaveCSS('box-shadow', 'none')
  await page.screenshot({ path: 'test-results/add-link-modal.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/mobile-add-link-modal.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await linkDialog.getByLabel('标题').fill('公司里待阅读的示例文章')
  await linkDialog.getByRole('button', { name: '保存网页' }).click()
  await expect(page.getByRole('heading', { name: '公司里待阅读的示例文章' })).toBeVisible()

  const imageBuffer = await sharp({
    create: {
      width: 160,
      height: 100,
      channels: 4,
      background: { r: 37, g: 99, b: 235, alpha: 1 }
    }
  }).png().toBuffer()
  await page.evaluate(async (base64) => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    const blob = new Blob([bytes], { type: 'image/png' })
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }, imageBuffer.toString('base64'))
  await page.locator('.main-content').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+V')

  const imageDialog = page.getByRole('dialog', { name: '保存图片' })
  await expect(imageDialog).toBeVisible()
  const dropzoneBox = await imageDialog.locator('.image-dropzone').boundingBox()
  expect(dropzoneBox?.height).toBeLessThanOrEqual(70)
  await expect(imageDialog.locator('.pending-image img')).toHaveCSS('width', '150px')
  await page.screenshot({ path: 'test-results/image-modal.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(imageDialog).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/mobile-image-modal.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await imageDialog.getByRole('button', { name: '保存图片组' }).click()
  let imageCard = page.locator('.item-card').filter({ hasText: '图片组' })
  await expect(imageCard).toBeVisible()
  await expect(imageCard.locator('.card-cover img')).toBeVisible()

  await imageCard.locator('.card-cover').click()
  const previewDialog = page.locator('[role="dialog"]').filter({ has: page.locator('.lightbox') })
  await expect(previewDialog.locator('.lightbox img')).toHaveAttribute('src', /variant=original/)
  await previewDialog.getByRole('button', { name: '关闭' }).click()

  await page.evaluate(() => navigator.clipboard.writeText('回家后整理这段纯文字'))
  await page.locator('.main-content').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+V')
  const textDialog = page.getByRole('dialog', { name: '保存文本' })
  await expect(textDialog.getByLabel('标题')).toHaveValue('回家后整理这段纯文字')
  await textDialog.getByLabel('类别').selectOption({ label: '生活' })
  await textDialog.getByRole('button', { name: '保存文本' }).click()
  await expect(page.getByRole('heading', { name: '回家后整理这段纯文字' })).toBeVisible()

  const search = page.getByRole('searchbox', { name: '搜索' })
  await search.fill('图片组')
  await expect(page.locator('.item-card')).toHaveCount(1)
  await expect(page.locator('.item-card')).toContainText('图片组')
  await search.fill('')

  await selectAnimalOption(page, '内容类型', '网页')
  await expect(page.locator('.item-card')).toHaveCount(1)
  await expect(page.locator('.item-card')).toContainText('公司里待阅读的示例文章')
  await selectAnimalOption(page, '内容类型', '文本')
  await expect(page.locator('.item-card')).toHaveCount(1)
  await expect(page.locator('.item-card')).toContainText('回家后整理这段纯文字')
  await selectAnimalOption(page, '内容类型', '图片')
  await expect(page.locator('.item-card')).toHaveCount(1)
  await expect(page.locator('.item-card')).toContainText('图片组')
  await page.getByRole('button', { name: '清除筛选' }).click()

  await selectAnimalOption(page, '类别', '其他')
  await expect(page.locator('.item-card')).toHaveCount(2)
  await selectAnimalOption(page, '类别', '生活')
  await expect(page.locator('.item-card')).toHaveCount(1)
  await expect(page.locator('.item-card')).toContainText('回家后整理这段纯文字')
  await page.getByRole('button', { name: '清除筛选' }).click()

  const chinaDate = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date()))
  await page.getByLabel('保存日期').fill(chinaDate)
  await expect(page.locator('.item-card')).toHaveCount(3)
  await page.getByRole('button', { name: '清除筛选' }).click()

  let linkCard = page.locator('.item-card').filter({ hasText: '公司里待阅读的示例文章' })
  await expect(linkCard.getByRole('link', { name: '公司里待阅读的示例文章' })).toHaveAttribute(
    'href',
    'https://example.com/read-later'
  )
  await linkCard.getByRole('button', { name: '编辑' }).click()
  const editDialog = page.getByRole('dialog', { name: '编辑条目' })
  await editDialog.getByLabel('标题').fill('公司里待阅读的示例文章（已编辑）')
  await editDialog.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByRole('heading', { name: '公司里待阅读的示例文章（已编辑）' })).toBeVisible()

  await page.locator('.app-header').getByRole('button', { name: '添加网页' }).click()
  const duplicateDialog = page.getByRole('dialog', { name: '添加网页' })
  await duplicateDialog.getByLabel('网页地址').fill('https://example.com/read-later#duplicate')
  await duplicateDialog.getByLabel('标题').fill('重复网页')
  await duplicateDialog.getByRole('button', { name: '保存网页' }).click()
  await expect(page.getByRole('dialog', { name: '编辑条目' })).toBeVisible()
  await page.getByRole('dialog', { name: '编辑条目' }).getByRole('button', { name: '关闭' }).click()

  linkCard = page.locator('.item-card').filter({ hasText: '公司里待阅读的示例文章（已编辑）' })
  await linkCard.getByRole('button', { name: '标记完成' }).click()
  await expect(page.getByRole('heading', { name: '公司里待阅读的示例文章（已编辑）' })).toHaveCount(0)
  await page.getByRole('tab', { name: '已完成', exact: true }).click()
  await expect(page.getByRole('heading', { name: '公司里待阅读的示例文章（已编辑）' })).toBeVisible()
  await page.locator('.item-card').filter({ hasText: '公司里待阅读的示例文章（已编辑）' })
    .getByRole('button', { name: '恢复待处理' }).click()
  await expect(page.getByRole('heading', { name: '公司里待阅读的示例文章（已编辑）' })).toHaveCount(0)
  await page.getByRole('tab', { name: '待处理', exact: true }).click()
  linkCard = page.locator('.item-card').filter({ hasText: '公司里待阅读的示例文章（已编辑）' })
  await expect(linkCard).toBeVisible()
  await linkCard.getByRole('button', { name: '标记完成' }).click()
  await page.getByRole('tab', { name: '已完成', exact: true }).click()

  await page.locator('.app-header').getByRole('button', { name: '书签按钮' }).click()
  const bookmarkDialog = page.getByRole('dialog', { name: '浏览器书签按钮' })
  const bookmarkLink = bookmarkDialog.getByRole('link', { name: '稍后保存（新标签）' })
  await expect(bookmarkLink).toHaveAttribute('href', /^javascript:/)
  const bookmarkCode = await bookmarkLink.getAttribute('href') as string
  expect(bookmarkCode).toContain("window.open(u,'_blank')")
  expect(bookmarkCode).not.toContain('location.href=u')
  expect(bookmarkCode).not.toContain('React has blocked')
  await bookmarkDialog.getByRole('button', { name: '关闭' }).click()

  const sourcePage = await context.newPage()
  await sourcePage.route('https://source.example/**', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><meta charset="utf-8"><title>书签来源网页</title><h1>来源网页</h1>'
  }))
  await sourcePage.goto('https://source.example/article')
  const sourceUrl = sourcePage.url()
  const [bookmarkPage] = await Promise.all([
    context.waitForEvent('page'),
    sourcePage.evaluate((script) => window.eval(script.replace(/^javascript:/, '')), bookmarkCode)
  ])
  await bookmarkPage.waitForLoadState('networkidle')
  await expect(sourcePage).toHaveURL(sourceUrl)
  const sourceDialog = bookmarkPage.getByRole('dialog', { name: '添加网页' })
  await expect(sourceDialog.getByLabel('网页地址')).toHaveValue('https://source.example/article')
  await expect(sourceDialog.getByLabel('标题')).toHaveValue('书签来源网页')
  await bookmarkPage.close()

  let blockedMessage = ''
  sourcePage.once('dialog', async (dialog) => {
    blockedMessage = dialog.message()
    await dialog.dismiss()
  })
  await sourcePage.evaluate((script) => {
    const open = window.open
    window.open = () => null
    try {
      window.eval(script.replace(/^javascript:/, ''))
    } finally {
      window.open = open
    }
  }, bookmarkCode)
  expect(blockedMessage).toContain('浏览器阻止了新标签页')
  await expect(sourcePage).toHaveURL(sourceUrl)
  await sourcePage.close()

  await page.getByRole('tab', { name: '全部', exact: true }).click()
  await expect(page.locator('.item-card')).toHaveCount(3)
  await expect(page.locator('.toast')).toHaveCount(0)
  await page.setViewportSize({ width: 1920, height: 1080 })
  const mainContentBox = await page.locator('.main-content').boundingBox()
  const headerButtonBox = await page.locator('.header-actions button').first().boundingBox()
  expect(mainContentBox?.width).toBeGreaterThanOrEqual(1550)
  expect(headerButtonBox?.height).toBeGreaterThanOrEqual(44)
  await page.screenshot({ path: 'test-results/desktop-home.png', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/laptop-home.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.app-header')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/mobile-home.png', fullPage: true })

  await page.setViewportSize({ width: 1440, height: 900 })
  const syncedPage = await context.newPage()
  await syncedPage.goto('/')
  await expect(syncedPage.locator('html')).toHaveAttribute('data-theme', 'flat-2013')
  await page.locator('.app-header').getByRole('button', { name: '设计风格' }).click()
  const themeDialog = page.getByRole('dialog', { name: '选择设计风格' })
  await themeDialog.getByRole('radio', { name: /Animal Island UI/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'animal-island')
  await expect(syncedPage.locator('html')).toHaveAttribute('data-theme', 'animal-island')
  await page.screenshot({ path: 'test-results/animal-home-with-picker.png', fullPage: true })
  await themeDialog.getByRole('button', { name: '关闭' }).click()
  await page.locator('.app-header').getByRole('button', { name: '添加网页' }).click()
  const animalDialog = page.getByRole('dialog', { name: '添加网页' })
  await expect(animalDialog.locator(':scope > div')).not.toHaveCSS('clip-path', 'none')
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/animal-add-link-modal.png', fullPage: true })
  await animalDialog.getByRole('button', { name: '关闭' }).click()
  await page.locator('.app-header').getByRole('button', { name: '设计风格' }).click()
  await page.getByRole('dialog', { name: '选择设计风格' }).getByRole('radio', { name: /Flat Design 2013/ }).click()
  await page.getByRole('dialog', { name: '选择设计风格' }).getByRole('button', { name: '关闭' }).click()
  await syncedPage.close()

  await page.locator('.app-header').getByRole('button', { name: '退出' }).click()
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
  await page.getByLabel('邮箱').fill('owner@example.com')
  await page.getByLabel(/^密码/).fill('a-secure-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.locator('.app-header')).toBeVisible()

  imageCard = page.locator('.item-card').filter({ hasText: '图片组' })
  await expect(imageCard).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await imageCard.getByRole('button', { name: '删除' }).click()
  await expect(page.locator('.item-card').filter({ hasText: '图片组' })).toHaveCount(0)
  expect(pageErrors).toEqual([])
})
