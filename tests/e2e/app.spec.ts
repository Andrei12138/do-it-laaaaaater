import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'
import sharp from 'sharp'

async function selectDashboardOption(page: Page, name: string, option: string) {
  const combobox = page.getByRole('combobox', { name, exact: true })
  if (await combobox.evaluate((element) => element.tagName === 'SELECT')) {
    await combobox.selectOption({ label: option })
    return
  }
  await combobox.click()
  await page.locator('[class*="animal-dropdown-"]:visible').getByRole('option', { name: option, exact: true }).click()
}

async function openDesktopAdd(page: Page, kind: '网页' | '文本' | '图片') {
  await page.locator('.app-header').getByRole('button', { name: '添加', exact: true }).click()
  await page
    .getByRole('menu', { name: '选择添加类型' })
    .getByRole('menuitem', { name: new RegExp(`添加${kind}`) })
    .click()
}

test('从首次建号到直接粘贴网页、文字和图片的完整流程', async ({ page, context }) => {
  const pageErrors: string[] = []
  const memoAssetFailures: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('response', (response) => {
    if (response.url().includes('/excalidraw-assets/') && !response.ok()) {
      memoAssetFailures.push(`${response.status()} ${response.url()}`)
    }
  })
  await page.addInitScript(() => {
    delete (window as Window & { showOpenFilePicker?: unknown }).showOpenFilePicker
  })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'flat-2013')
  await page.evaluate(() => localStorage.setItem('do-it-laaaaaater.theme.v1', 'unknown-theme'))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'flat-2013')
  await expect(page.getByRole('button', { name: '设计风格' })).toBeVisible()
  await page.getByRole('button', { name: '设计风格' }).click()
  const setupThemeDialog = page.getByRole('dialog', { name: '选择设计风格' })
  await expect(setupThemeDialog.getByRole('radio')).toHaveCount(2)
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

  await page.locator('.app-header').getByRole('button', { name: '账号' }).click()
  const flatAccountDialog = page.getByRole('dialog', { name: '账号设置' })
  const flatQuickCategory = flatAccountDialog.getByLabel('快速保存默认类别')
  await expect(flatQuickCategory).toBeVisible()
  expect(await flatQuickCategory.evaluate((element) => element.tagName)).toBe('SELECT')
  await flatQuickCategory.selectOption({ label: '生活' })
  await flatAccountDialog.getByRole('button', { name: '保存默认类别' }).click()
  await expect(flatAccountDialog.getByText('快速保存的默认类别已同步')).toBeVisible()
  await expect(flatAccountDialog.locator('.backup-panel').first()).toHaveCSS('border-radius', '0px')
  await expect(flatAccountDialog.getByRole('heading', { name: '安装与 iPhone' })).toBeVisible()
  await expect(flatAccountDialog.getByRole('heading', { name: 'iPhone 剪贴板快捷保存' })).toBeVisible()
  await expect(flatAccountDialog.getByRole('heading', { name: '离线与缓存' })).toBeVisible()
  await expect(flatAccountDialog.getByText('原图后台缓存')).toBeVisible()
  await expect(flatAccountDialog.getByText('iPhone 15 Pro Max')).toHaveCount(0)
  await flatAccountDialog.getByRole('button', { name: '关闭' }).first().click()
  await expect(page.getByRole('heading', { name: '开始建立你的稍后阅读清单' })).toBeVisible()
  await expect(page.getByRole('button', { name: '添加文本' })).toBeVisible()

  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => navigator.clipboard.writeText('https://example.com/read-later'))
  await page.locator('.main-content').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+V')
  const linkDialog = page.getByRole('dialog', { name: '添加网页' })
  await expect(linkDialog.getByLabel('网页地址')).toHaveValue('https://example.com/read-later')
  await expect(linkDialog.locator(':scope > div')).toHaveCSS('clip-path', 'none')
  await expect(linkDialog).toHaveCSS('border-radius', '0px')
  await expect(linkDialog).toHaveCSS('box-shadow', 'none')
  await expect(linkDialog.getByRole('button', { name: '添加相关截图（可选）' })).toHaveAttribute('aria-expanded', 'false')
  await linkDialog.getByRole('button', { name: '添加相关截图（可选）' }).click()
  await expect(linkDialog.locator('.image-dropzone')).toBeVisible()
  await page.screenshot({ path: 'test-results/add-link-modal.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/mobile-add-link-modal.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await linkDialog.getByLabel('标题').fill('公司里待阅读的示例文章')
  await linkDialog.getByRole('button', { name: '新增类别' }).click()
  await linkDialog.getByLabel('新类别名称').fill('精读')
  await linkDialog.getByLabel('新类别颜色').fill('#8b5cf6')
  await linkDialog.getByRole('button', { name: '添加并选中' }).click()
  await expect(linkDialog.getByLabel('类别', { exact: true })).toHaveValue(/.+/)
  await expect(linkDialog.getByLabel('类别', { exact: true }).locator('option:checked')).toHaveText('精读')
  await page.screenshot({ path: 'test-results/category-quick-add-link.png', fullPage: true })
  await linkDialog.getByRole('button', { name: '保存网页' }).click()
  await expect(page.getByRole('heading', { name: '公司里待阅读的示例文章' })).toBeVisible()
  const freshLinkCard = page.locator('.item-card').filter({ hasText: '公司里待阅读的示例文章' })
  await expect(freshLinkCard.locator('.item-age')).toHaveText('0天未看')
  await expect(freshLinkCard.locator('.kind-tag')).toHaveCSS('flex-direction', 'row')
  const kindTagBox = await freshLinkCard.locator('.kind-tag').boundingBox()
  const kindLabelBox = await freshLinkCard.locator('.kind-tag-label').boundingBox()
  expect(kindTagBox?.height).toBeLessThanOrEqual(28)
  expect(Math.abs((kindTagBox?.y || 0) + (kindTagBox?.height || 0) / 2 - ((kindLabelBox?.y || 0) + (kindLabelBox?.height || 0) / 2))).toBeLessThan(3)

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

  const imageDialog = page.getByRole('dialog', { name: '添加图片' })
  await expect(imageDialog).toBeVisible()
  await expect(imageDialog.getByRole('button', { name: '新增类别' })).toBeVisible()
  const dropzoneBox = await imageDialog.locator('.image-dropzone').boundingBox()
  expect(dropzoneBox?.height).toBeLessThanOrEqual(70)
  await expect(imageDialog.locator('.pending-image img')).toHaveCSS('width', '150px')
  await imageDialog.locator('input[type="file"]').setInputFiles({
    name: 'second.png',
    mimeType: 'image/png',
    buffer: imageBuffer
  })
  await expect(imageDialog.locator('.pending-image')).toHaveCount(2)
  await imageDialog.locator('.pending-image').first().getByRole('button', { name: '后移' }).click()
  await expect(imageDialog.locator('.pending-image').first()).toContainText('second.png')
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
  await expect(previewDialog.getByRole('button', { name: '放大' })).toBeVisible()
  await previewDialog.getByRole('button', { name: '放大' }).click()
  await expect(previewDialog.getByText('150%')).toBeVisible()
  await expect(previewDialog.getByRole('link', { name: '打开原图' })).toBeVisible()
  await expect(previewDialog.getByRole('link', { name: '保存原图' })).toBeVisible()
  await previewDialog.getByRole('button', { name: '关闭' }).click()

  await page.evaluate(() => navigator.clipboard.writeText('回家后整理这段纯文字'))
  await page.locator('.main-content').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+V')
  const textDialog = page.getByRole('dialog', { name: '添加文本' })
  await expect(textDialog.getByLabel('标题')).toHaveValue('回家后整理这段纯文字')
  await expect(textDialog.getByRole('button', { name: '新增类别' })).toBeVisible()
  await textDialog.getByLabel('类别').selectOption({ label: '生活' })
  await textDialog.getByRole('button', { name: '保存文本' }).click()
  await expect(page.getByRole('heading', { name: '回家后整理这段纯文字' })).toBeVisible()

  const search = page.getByRole('searchbox', { name: '搜索' })
  await search.fill('图片组')
  await expect(page.locator('.item-card')).toHaveCount(1)
  await expect(page.locator('.item-card')).toContainText('图片组')
  await search.fill('')
  await search.fill('绝对找不到的内容')
  await expect(page.getByRole('heading', { name: '当前条件下没有结果' })).toBeVisible()
  await expect(page.getByText(/资料库里仍有 3 条内容/)).toBeVisible()
  await page.getByLabel('当前筛选条件').getByRole('button', { name: /搜索：绝对找不到的内容/ }).click()
  await expect(page.locator('.item-card')).toHaveCount(3)

  await expect(page.getByRole('combobox', { name: '内容类型', exact: true })).toHaveJSProperty('tagName', 'SELECT')
  await expect(page.getByRole('combobox', { name: '优先筛选', exact: true })).toHaveJSProperty('tagName', 'SELECT')
  await expect(page.getByRole('combobox', { name: '类别', exact: true })).toHaveJSProperty('tagName', 'SELECT')
  await expect(page.getByRole('combobox', { name: '排序方式', exact: true })).toHaveJSProperty('tagName', 'SELECT')
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.screenshot({ path: 'test-results/flat-filter-controls.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })

  await selectDashboardOption(page, '内容类型', '网页')
  await expect(page.locator('.item-card')).toHaveCount(1)
  await expect(page.locator('.item-card')).toContainText('公司里待阅读的示例文章')
  await selectDashboardOption(page, '内容类型', '文本')
  await expect(page.locator('.item-card')).toHaveCount(1)
  await expect(page.locator('.item-card')).toContainText('回家后整理这段纯文字')
  await selectDashboardOption(page, '内容类型', '图片')
  await expect(page.locator('.item-card')).toHaveCount(1)
  await expect(page.locator('.item-card')).toContainText('图片组')
  await page.getByRole('button', { name: '清除筛选' }).click()

  await selectDashboardOption(page, '类别', '其他')
  await expect(page.locator('.item-card')).toHaveCount(1)
  await expect(page.locator('.item-card')).toContainText('图片组')
  await selectDashboardOption(page, '类别', '全部类别')
  await expect(page.locator('.item-card')).toHaveCount(3)
  await selectDashboardOption(page, '类别', '生活')
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
  await editDialog.getByRole('button', { name: '新增类别' }).click()
  await editDialog.getByLabel('新类别名称').fill('已整理')
  await editDialog.getByRole('button', { name: '添加并选中' }).click()
  await expect(editDialog.getByLabel('类别', { exact: true }).locator('option:checked')).toHaveText('已整理')
  await editDialog.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByRole('heading', { name: '公司里待阅读的示例文章（已编辑）' })).toBeVisible()

  await openDesktopAdd(page, '网页')
  const duplicateDialog = page.getByRole('dialog', { name: '添加网页' })
  await duplicateDialog.getByLabel('网页地址').fill('https://example.com/read-later#duplicate')
  await duplicateDialog.getByLabel('标题').fill('重复网页')
  await duplicateDialog.getByRole('button', { name: '保存网页' }).click()
  await expect(duplicateDialog.getByText('原条目没有被修改，录入时间也保持不变。')).toBeVisible()
  await duplicateDialog.getByRole('button', { name: '查看已有条目' }).click()
  await expect(page.getByRole('dialog', { name: '编辑条目' })).toBeVisible()
  await page.getByRole('dialog', { name: '编辑条目' }).getByRole('button', { name: '关闭' }).click()

  linkCard = page.locator('.item-card').filter({ hasText: '公司里待阅读的示例文章（已编辑）' })
  await linkCard.getByRole('button', { name: '星标', exact: true }).click()
  await expect(linkCard.getByRole('button', { name: '取消星标', exact: true })).toBeVisible()
  await linkCard.getByRole('button', { name: '安排处理', exact: true }).click()
  await linkCard.getByRole('menu', { name: '安排处理时间' }).getByRole('button', { name: '今天', exact: true }).click()
  await expect(linkCard.getByRole('button', { name: '计划 今天', exact: true })).toBeVisible()
  await selectDashboardOption(page, '优先筛选', '今日 / 逾期')
  await expect(page.locator('.item-card')).toHaveCount(1)
  await expect(page.locator('.item-card')).toContainText('公司里待阅读的示例文章（已编辑）')
  await page.getByRole('button', { name: '清除筛选' }).click()
  await linkCard.getByRole('button', { name: '计划 今天', exact: true }).click()
  await linkCard.getByRole('menu', { name: '安排处理时间' }).getByRole('button', { name: '明天', exact: true }).click()
  await expect(linkCard.getByRole('button', { name: '计划 明天', exact: true })).toBeVisible()
  await selectDashboardOption(page, '排序方式', '计划日期')
  await expect(page.locator('.item-card').first()).toContainText('公司里待阅读的示例文章（已编辑）')

  await selectDashboardOption(page, '排序方式', '最久未看')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('do-it-laaaaaater.item-sort.v1'))).toBe('oldest')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('do-it-laaaaaater.active-draft.v1'))).toBeNull()
  await page.reload()
  await expect(page.getByText('发现一份未完成草稿')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '排序方式' })).toContainText('最久未看')
  await selectDashboardOption(page, '排序方式', '智能优先')

  await page.getByRole('button', { name: '开始处理' }).click()
  const focusDialog = page.getByRole('dialog', { name: '晚间处理模式' })
  await expect(focusDialog.getByRole('heading', { name: '公司里待阅读的示例文章（已编辑）' })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(focusDialog.getByRole('heading', { name: /图片组/ })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(focusDialog.getByRole('heading', { name: '回家后整理这段纯文字' })).toBeVisible()
  await page.keyboard.press('s')
  await expect(focusDialog.getByRole('button', { name: '取消星标' })).toBeEnabled()
  await page.keyboard.press('s')
  await expect(focusDialog.getByRole('button', { name: '加星标' })).toBeEnabled()
  await page.waitForTimeout(250)
  await page.keyboard.press('t')
  await expect(focusDialog.getByRole('button', { name: '清除计划 · 今天' })).toBeVisible()
  await expect(focusDialog.getByRole('button', { name: '清除计划 · 今天' })).toBeEnabled()
  await page.waitForTimeout(250)
  await page.keyboard.press('Space')
  await expect(focusDialog.getByRole('heading', { name: '回家后整理这段纯文字' })).toHaveCount(0)
  await expect(focusDialog.locator('.focus-content h2')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(focusDialog).toHaveCount(0)

  await page.getByRole('tab', { name: '已完成', exact: true }).click()
  const completedTextCard = page.locator('.item-card').filter({ hasText: '回家后整理这段纯文字' })
  await expect(completedTextCard).toBeVisible()
  await completedTextCard.getByRole('button', { name: '恢复待处理' }).click()
  await page.getByRole('tab', { name: '待处理', exact: true }).click()

  await page.getByRole('button', { name: '选择条目' }).click()
  const bulkToolbar = page.getByRole('toolbar', { name: '批量操作' })
  const flatSelectionShell = page.locator('.item-card-shell').first()
  const flatSelectionCard = flatSelectionShell.locator('.item-card')
  const flatSelectionToggle = flatSelectionShell.locator('.item-card-selection-toggle')
  await expect(page.locator('.item-card-shell input[type="checkbox"]')).toHaveCount(0)
  await expect(flatSelectionCard).toHaveAttribute('inert', '')
  await expect(flatSelectionToggle).toBeVisible()
  await expect(flatSelectionToggle).toHaveAttribute('aria-pressed', 'false')
  const flatShellBox = await flatSelectionShell.boundingBox()
  const flatToggleBox = await flatSelectionToggle.boundingBox()
  expect(Math.abs((flatShellBox?.x || 0) - (flatToggleBox?.x || 0))).toBeLessThanOrEqual(1)
  expect(Math.abs((flatShellBox?.y || 0) - (flatToggleBox?.y || 0))).toBeLessThanOrEqual(1)
  expect(Math.abs((flatShellBox?.width || 0) - (flatToggleBox?.width || 0))).toBeLessThanOrEqual(1)
  expect(Math.abs((flatShellBox?.height || 0) - (flatToggleBox?.height || 0))).toBeLessThanOrEqual(1)
  await flatSelectionToggle.click()
  await expect(flatSelectionToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(flatSelectionCard).toHaveCSS('background-color', 'rgb(217, 244, 238)')
  await expect(bulkToolbar).toContainText('已选 1 条')
  await page.screenshot({ path: 'test-results/flat-card-selection.png', fullPage: true })
  await page.setViewportSize({ width: 430, height: 932 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await flatSelectionToggle.click()
  await expect(flatSelectionToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(bulkToolbar).toContainText('已选 0 条')
  await flatSelectionToggle.click()
  await expect(flatSelectionToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(bulkToolbar).toContainText('已选 1 条')
  await page.screenshot({ path: 'test-results/flat-card-selection-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await bulkToolbar.getByRole('button', { name: '全选当前结果' }).click()
  await expect(bulkToolbar).toContainText('已选 3 条')
  await bulkToolbar.getByRole('button', { name: '加星标' }).click()
  await expect(page.locator('.flat-notification')).toContainText('已批量加星标（3 条）')
  await bulkToolbar.getByRole('button', { name: '全选当前结果' }).click()
  await bulkToolbar.getByRole('button', { name: '取消星标' }).click()
  await expect(page.locator('.flat-notification')).toContainText('已批量取消星标（3 条）')
  await page.getByRole('button', { name: '退出选择' }).click()

  linkCard = page.locator('.item-card').filter({ hasText: '公司里待阅读的示例文章（已编辑）' })
  await linkCard.getByRole('button', { name: '标记完成' }).click()
  await expect(page.locator('.flat-notification')).toContainText('已标记完成')
  await expect(page.locator('.flat-notification')).toHaveCSS('border-radius', '0px')
  await expect(page.getByRole('heading', { name: '公司里待阅读的示例文章（已编辑）' })).toHaveCount(0)
  await page.getByRole('tab', { name: '已完成', exact: true }).click()
  await expect(page.getByRole('heading', { name: '公司里待阅读的示例文章（已编辑）' })).toBeVisible()
  await expect(page.locator('.item-card').filter({ hasText: '公司里待阅读的示例文章（已编辑）' }).locator('.item-age')).toHaveText('0天前看了')
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
  const quickBookmarkLink = bookmarkDialog.getByRole('link', { name: '快速保存' })
  await expect(quickBookmarkLink).toHaveAttribute('href', /^javascript:/)
  const quickBookmarkCode = await quickBookmarkLink.getAttribute('href') as string
  expect(quickBookmarkCode).toContain('?capture=quick')
  expect(quickBookmarkCode).toContain("window.open(u,'doitlaterQuick'")
  expect(quickBookmarkCode).not.toContain('location.href=u')
  const bookmarkLink = bookmarkDialog.getByRole('link', { name: '保存并分类' })
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

  const [quickCapturePage] = await Promise.all([
    context.waitForEvent('page'),
    sourcePage.evaluate((script) => window.eval(script.replace(/^javascript:/, '')), quickBookmarkCode)
  ])
  await expect(quickCapturePage.locator('.quick-capture-message')).toContainText(/已经保存|保存完成/)
  await expect(sourcePage).toHaveURL(sourceUrl)
  await quickCapturePage.waitForEvent('close', { timeout: 8_000 })

  const [duplicateQuickPage] = await Promise.all([
    context.waitForEvent('page'),
    sourcePage.evaluate((script) => window.eval(script.replace(/^javascript:/, '')), quickBookmarkCode)
  ])
  await expect(duplicateQuickPage.locator('.quick-capture-message')).toContainText('已经保存过了')
  await expect(duplicateQuickPage.locator('.quick-capture-summary')).toContainText('书签来源网页')
  await Promise.all([
    duplicateQuickPage.waitForEvent('close'),
    duplicateQuickPage.getByRole('button', { name: '关闭窗口' }).click()
  ])
  await sourcePage.close()

  await page.reload()
  await expect(page.getByText('发现一份未完成草稿')).toBeVisible()
  await page.getByRole('button', { name: '丢弃' }).click()
  const quickSavedCard = page.locator('.item-card').filter({ hasText: '书签来源网页' })
  await expect(quickSavedCard).toBeVisible()
  await expect(quickSavedCard).toContainText('生活')

  await page.getByRole('tab', { name: '全部', exact: true }).click()
  await expect(page.locator('.item-card')).toHaveCount(4)
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
  await expect(page.locator('.mobile-bottom-nav')).toBeVisible()
  await expect(page.locator('.mobile-bottom-nav').getByRole('button')).toHaveCount(5)
  const compactHeaderBox = await page.locator('.app-header').boundingBox()
  const compactToolbarBox = await page.locator('.toolbar').boundingBox()
  expect(compactHeaderBox?.height).toBeLessThanOrEqual(100)
  expect(compactToolbarBox?.height).toBeLessThanOrEqual(155)
  await page.locator('.mobile-bottom-nav').getByRole('button', { name: '筛选' }).click()
  await expect(page.getByRole('dialog', { name: '筛选与排序' })).toBeVisible()
  await page.getByRole('dialog', { name: '筛选与排序' }).getByRole('button', { name: '查看结果' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/mobile-home.png', fullPage: true })
  await page.setViewportSize({ width: 430, height: 932 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/iphone-15-pro-max-home.png', fullPage: true })

  await page.setViewportSize({ width: 1440, height: 900 })

  const manifestResponse = await page.request.get('/manifest.webmanifest')
  expect(manifestResponse.ok()).toBe(true)
  expect(await manifestResponse.json()).toMatchObject({ display: 'standalone', start_url: '/' })
  const serviceWorkerResponse = await page.request.get('/sw.js')
  expect(serviceWorkerResponse.ok()).toBe(true)
  const serviceWorkerSource = await serviceWorkerResponse.text()
  expect(serviceWorkerSource).toContain("url.pathname.startsWith('/api/')")
  expect(serviceWorkerSource).not.toContain('supabase.co')
  const iconResponse = await page.request.get('/icons/app-icon-512.png')
  const iconBytes = Buffer.from(await iconResponse.body())
  const iconMetadata = await sharp(iconBytes).metadata()
  const iconStats = await sharp(iconBytes).stats()
  expect(iconMetadata).toMatchObject({ width: 512, height: 512 })
  expect(iconStats.channels[3]?.min ?? 255).toBe(255)

  const memoFontResponse = await page.request.get('/excalidraw-assets/fonts/Assistant/Assistant-Regular.woff2')
  expect(memoFontResponse.ok()).toBe(true)
  await page.locator('.app-header').getByRole('button', { name: '备忘录' }).click()
  let memoDialog = page.getByRole('dialog', { name: '备忘录无限画布' })
  await expect(memoDialog).toBeVisible()
  await expect(memoDialog.getByText('画布已同步')).toBeVisible({ timeout: 15_000 })
  await expect(memoDialog.locator('[data-testid="toolbar-selection"]')).toBeVisible()
  await expect(memoDialog.locator('[data-testid="toolbar-text"]')).toBeVisible()
  await expect(memoDialog.locator('[data-testid="toolbar-freedraw"]')).toBeVisible()
  await expect(memoDialog.locator('[data-testid="toolbar-eraser"]')).toBeVisible()
  await expect(memoDialog.locator('[data-testid="toolbar-image"]')).toBeVisible()

  const backgroundGroup = memoDialog.getByRole('group', { name: '画布背景' })
  await backgroundGroup.getByRole('button', { name: '网格' }).click()
  await expect(memoDialog.locator('.memo-canvas-stage')).toHaveClass(/memo-bg-grid/)
  await expect(backgroundGroup.getByRole('button', { name: '网格' })).toHaveAttribute('aria-pressed', 'true')
  await backgroundGroup.getByRole('button', { name: '点阵' }).click()
  await expect(memoDialog.locator('.memo-canvas-stage')).toHaveClass(/memo-bg-dots/)
  await expect(memoDialog.locator('.memo-pattern-layer')).toHaveCSS('z-index', '0')
  await backgroundGroup.getByRole('button', { name: '横线' }).click()
  await expect(memoDialog.locator('.memo-canvas-stage')).toHaveClass(/memo-bg-lines/)
  await backgroundGroup.getByRole('button', { name: '纯色' }).click()
  await expect(memoDialog.locator('.memo-pattern-layer')).toHaveCount(0)
  await backgroundGroup.getByRole('button', { name: '点阵' }).click()
  await memoDialog.getByRole('button', { name: '切换到夜间画布' }).click()
  await expect(memoDialog).toHaveClass(/memo-mode-dark/)
  await expect(memoDialog.getByRole('button', { name: '切换到昼间画布' })).toBeVisible()

  await memoDialog.getByRole('button', { name: '资料库' }).click()
  const memoLibrary = memoDialog.locator('.memo-library-pane')
  await expect(memoLibrary).toBeVisible()
  await memoLibrary.getByRole('searchbox', { name: '搜索资料库' }).fill('图片组')
  await memoLibrary.getByRole('button', { name: '放到画布' }).click()
  await expect(memoDialog.locator('.memo-reference-card')).toHaveCount(1)
  let memoInspector = memoDialog.locator('.memo-inspector-pane')
  await expect(memoInspector.getByRole('heading', { name: '图片组' })).toBeVisible()
  await expect(memoDialog.getByRole('button', { name: '重置缩放' })).toContainText('100%')

  const referenceCard = memoDialog.locator('.memo-reference-card')
  const referenceInitial = await referenceCard.boundingBox()
  expect(referenceInitial).toBeTruthy()
  await memoInspector.getByRole('button', { name: '选中卡片并调整位置、大小或角度' }).click()
  await expect(referenceCard).toHaveClass(/is-selected/)
  const referenceBefore = await referenceCard.boundingBox()
  expect(referenceBefore).toBeTruthy()
  await page.mouse.move(
    (referenceBefore?.x || 0) + 4,
    (referenceBefore?.y || 0) + (referenceBefore?.height || 0) * 0.25
  )
  await page.mouse.down()
  await page.mouse.move(
    (referenceBefore?.x || 0) + 74,
    (referenceBefore?.y || 0) + (referenceBefore?.height || 0) * 0.25 + 35,
    { steps: 8 }
  )
  await page.mouse.up()
  await expect.poll(async () => (await referenceCard.boundingBox())?.x || 0).toBeGreaterThan((referenceBefore?.x || 0) + 30)

  await memoInspector.getByRole('button', { name: '选中卡片并调整位置、大小或角度' }).click()
  const referenceMoved = await referenceCard.boundingBox()
  expect(referenceMoved).toBeTruthy()
  await page.mouse.move(
    (referenceMoved?.x || 0) + (referenceMoved?.width || 0) + 8,
    (referenceMoved?.y || 0) + (referenceMoved?.height || 0) + 8
  )
  await page.mouse.down()
  await page.mouse.move(
    (referenceMoved?.x || 0) + (referenceMoved?.width || 0) + 78,
    (referenceMoved?.y || 0) + (referenceMoved?.height || 0) + 53,
    { steps: 8 }
  )
  await page.mouse.up()
  await expect.poll(async () => (await referenceCard.boundingBox())?.width || 0).toBeGreaterThan((referenceMoved?.width || 0) + 30)

  await memoInspector.getByRole('button', { name: '选中卡片并调整位置、大小或角度' }).click()
  const referenceResized = await referenceCard.boundingBox()
  expect(referenceResized).toBeTruthy()
  await page.mouse.move(
    (referenceResized?.x || 0) + (referenceResized?.width || 0) / 2,
    (referenceResized?.y || 0) - 24
  )
  await page.mouse.down()
  await page.mouse.move(
    (referenceResized?.x || 0) + (referenceResized?.width || 0) / 2 + 80,
    (referenceResized?.y || 0) + 26,
    { steps: 8 }
  )
  await page.mouse.up()
  await expect.poll(async () => {
    const rotated = await referenceCard.boundingBox()
    if (!rotated || !referenceResized) return 0
    return Math.max(
      Math.abs(rotated.width - referenceResized.width),
      Math.abs(rotated.height - referenceResized.height)
    )
  }).toBeGreaterThan(10)

  await memoInspector.getByRole('button', { name: '查看图片' }).click()
  const memoPreview = page.locator('[role="dialog"]').filter({ has: page.locator('.lightbox') })
  await expect(memoPreview.locator('.lightbox img')).toBeVisible()
  await memoPreview.getByRole('button', { name: '关闭' }).click()
  await memoInspector.getByLabel('修改类别').selectOption({ label: '生活' })
  await expect(memoInspector.getByLabel('修改类别')).toHaveValue(/.+/)
  await memoInspector.getByRole('button', { name: '加星标' }).click()
  await expect(memoInspector.getByRole('button', { name: '取消星标' })).toBeVisible()
  await memoInspector.getByRole('button', { name: '取消星标' }).click()
  await memoInspector.getByRole('button', { name: '已完成' }).click()
  await expect(memoInspector.getByRole('button', { name: '恢复待处理' })).toBeVisible()
  await memoInspector.getByRole('button', { name: '恢复待处理' }).click()
  await memoInspector.getByRole('button', { name: '安排处理' }).click()
  await memoInspector.locator('.memo-plan-menu').getByRole('button', { name: '明天' }).click()
  await expect(memoInspector.getByRole('button', { name: '明天' })).toBeVisible()
  await memoInspector.getByRole('button', { name: '明天' }).click()
  await memoInspector.locator('.memo-plan-menu').getByRole('button', { name: '清除计划' }).click()

  await memoInspector.getByRole('button', { name: '编辑标题、网址或图片' }).click()
  const memoEditDialog = page.getByRole('dialog', { name: '编辑条目' })
  await expect(memoEditDialog).toBeVisible()
  await memoEditDialog.getByLabel('标题').fill('图片组（画布同步）')
  await memoEditDialog.getByRole('button', { name: '保存修改' }).click()
  await expect(memoInspector.getByRole('heading', { name: '图片组（画布同步）' })).toBeVisible()
  await memoInspector.getByRole('button', { name: '移到回收站' }).click()
  await expect(memoInspector.getByText('回收站')).toBeVisible()
  await memoInspector.getByRole('button', { name: '恢复条目' }).click()
  await expect(memoInspector.getByRole('button', { name: '移到回收站' })).toBeVisible()

  await memoInspector.getByRole('button', { name: '从画布移除' }).click()
  await expect(memoDialog.locator('.memo-reference-card')).toHaveCount(0)
  await memoDialog.getByRole('button', { name: '资料库' }).click()
  await memoDialog.locator('.memo-library-pane').getByRole('button', { name: '放到画布' }).click()
  await expect(memoDialog.locator('.memo-reference-card')).toHaveCount(1)
  await memoDialog.getByRole('button', { name: '资料库' }).click()
  await memoDialog.locator('.memo-library-pane').getByRole('button', { name: '放到画布' }).click()
  await expect(memoDialog.locator('.memo-reference-card')).toHaveCount(1)
  await memoDialog.getByRole('button', { name: '关闭编辑面板' }).click()

  const memoStage = memoDialog.locator('.memo-canvas-stage')
  const memoStageBox = await memoStage.boundingBox()
  expect(memoStageBox).toBeTruthy()
  await memoDialog.locator('[data-testid="toolbar-text"]').check({ force: true })
  await page.mouse.click(
    (memoStageBox?.x || 0) + (memoStageBox?.width || 0) * 0.72,
    (memoStageBox?.y || 0) + (memoStageBox?.height || 0) * 0.32
  )
  await page.keyboard.type('画布内文字')
  await page.keyboard.press('Escape')
  await memoDialog.locator('[data-testid="toolbar-freedraw"]').check({ force: true })
  await page.mouse.move(
    (memoStageBox?.x || 0) + (memoStageBox?.width || 0) * 0.56,
    (memoStageBox?.y || 0) + (memoStageBox?.height || 0) * 0.60
  )
  await page.mouse.down()
  await page.mouse.move(
    (memoStageBox?.x || 0) + (memoStageBox?.width || 0) * 0.72,
    (memoStageBox?.y || 0) + (memoStageBox?.height || 0) * 0.72,
    { steps: 8 }
  )
  await page.mouse.up()
  await expect(memoDialog.getByRole('button', { name: '撤销' })).toBeEnabled()
  await memoDialog.getByRole('button', { name: '撤销' }).click()
  await expect(memoDialog.getByRole('button', { name: '重做' })).toBeEnabled()
  await memoDialog.getByRole('button', { name: '重做' }).click()

  const canvasImageBuffer = await sharp({
    create: {
      width: 120,
      height: 80,
      channels: 4,
      background: { r: 240, g: 140, b: 40, alpha: 1 }
    }
  }).png().toBuffer()
  const canvasFileChooser = page.waitForEvent('filechooser')
  await memoDialog.locator('[data-testid="toolbar-image"]').locator('..').click()
  await (await canvasFileChooser).setFiles({
    name: 'canvas-note.png',
    mimeType: 'image/png',
    buffer: canvasImageBuffer
  })
  await page.mouse.click(
    (memoStageBox?.x || 0) + (memoStageBox?.width || 0) * 0.76,
    (memoStageBox?.y || 0) + (memoStageBox?.height || 0) * 0.62
  )
  await page.keyboard.press('Escape')
  await expect(memoDialog.getByText('画布已同步')).toBeVisible({ timeout: 15_000 })

  type MemoTestSnapshot = {
    scene: { elements: Array<{ type?: string; text?: string; isDeleted?: boolean }> }
    background: string
    colorMode: string
    assets: unknown[]
  }
  await expect.poll(async () => {
    const response = await page.request.get('/api/memo-canvas')
    const snapshot = await response.json() as MemoTestSnapshot
    return snapshot.assets.length
  }, { timeout: 15_000 }).toBe(1)
  const memoSnapshot = await (await page.request.get('/api/memo-canvas')).json() as MemoTestSnapshot
  expect(memoSnapshot.background).toBe('dots')
  expect(memoSnapshot.colorMode).toBe('dark')
  expect(memoSnapshot.scene.elements.some((element) => !element.isDeleted && element.type === 'embeddable')).toBe(true)
  expect(memoSnapshot.scene.elements.some((element) => !element.isDeleted && element.type === 'text' && element.text === '画布内文字')).toBe(true)
  expect(memoSnapshot.scene.elements.some((element) => !element.isDeleted && element.type === 'freedraw')).toBe(true)
  expect(memoSnapshot.scene.elements.some((element) => !element.isDeleted && element.type === 'image')).toBe(true)
  expect(memoAssetFailures).toEqual([])
  await page.screenshot({ path: 'test-results/flat-memo-canvas-dark-dots.png' })

  await page.setViewportSize({ width: 430, height: 932 })
  await memoDialog.getByRole('button', { name: '资料库' }).click()
  await memoDialog.locator('.memo-library-pane').getByRole('button', { name: '放到画布' }).click()
  memoInspector = memoDialog.locator('.memo-inspector-pane')
  await expect(memoInspector).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const mobileMemoControls = await memoDialog.locator('.memo-canvas-controls').boundingBox()
  const mobileMemoStatus = await memoDialog.locator('.memo-save-state').boundingBox()
  expect(mobileMemoStatus?.y).toBeGreaterThanOrEqual(
    (mobileMemoControls?.y || 0) + (mobileMemoControls?.height || 0) - 1
  )
  await page.screenshot({ path: 'test-results/flat-memo-canvas-mobile.png' })
  await memoDialog.getByRole('button', { name: '关闭备忘录' }).click()

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('.item-card').filter({ hasText: '图片组（画布同步）' })).toContainText('生活')
  await page.locator('.app-header').getByRole('button', { name: '设计风格' }).click()
  const memoThemeDialog = page.getByRole('dialog', { name: '选择设计风格' })
  await memoThemeDialog.getByRole('radio', { name: /Animal Island UI/ }).click()
  await memoThemeDialog.getByRole('button', { name: '关闭' }).click()
  await page.locator('.app-header').getByRole('button', { name: '添加', exact: true }).click()
  await expect(page.getByRole('menu', { name: '选择添加类型' })).not.toHaveCSS('border-radius', '0px')
  await page.keyboard.press('Escape')
  await page.locator('.app-header').getByRole('button', { name: '备忘录' }).click()
  memoDialog = page.getByRole('dialog', { name: '备忘录无限画布' })
  await expect(memoDialog).toHaveClass(/memo-site-animal-island/)
  await expect(memoDialog).toHaveClass(/memo-mode-dark/)
  await memoDialog.getByRole('button', { name: '资料库' }).click()
  await expect(memoDialog.locator('.memo-library-pane')).not.toHaveCSS('border-radius', '0px')
  await memoDialog.locator('.memo-library-pane').getByRole('searchbox', { name: '搜索资料库' }).fill('图片组')
  await memoDialog.locator('.memo-library-pane').getByRole('button', { name: '放到画布' }).click()
  await expect(memoDialog.locator('.memo-reference-card')).not.toHaveCSS('border-radius', '0px')
  await page.screenshot({ path: 'test-results/animal-memo-canvas-dark-dots.png' })
  await page.setViewportSize({ width: 430, height: 932 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const animalMobileInspector = await memoDialog.locator('.memo-inspector-pane').boundingBox()
  expect(animalMobileInspector?.height).toBeLessThanOrEqual(570)
  await page.screenshot({ path: 'test-results/animal-memo-canvas-mobile.png' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await memoDialog.getByRole('button', { name: '切换到昼间画布' }).click()
  await expect(memoDialog).toHaveClass(/memo-mode-light/)
  await expect(memoDialog.getByText('画布已同步')).toBeVisible({ timeout: 15_000 })
  await memoDialog.getByRole('button', { name: '关闭备忘录' }).click()
  await page.locator('.app-header').getByRole('button', { name: '设计风格' }).click()
  await page.getByRole('dialog', { name: '选择设计风格' }).getByRole('radio', { name: /Flat Design 2013/ }).click()
  await page.getByRole('dialog', { name: '选择设计风格' }).getByRole('button', { name: '关闭' }).click()

  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined })
  })
  await page.locator('.app-header').getByRole('button', { name: '账号' }).click()
  const backupDialog = page.getByRole('dialog', { name: '账号设置' })
  const exportButton = backupDialog.getByRole('button', { name: '导出 ZIP 备份' })
  const [fullDownload] = await Promise.all([
    page.waitForEvent('download'),
    exportButton.click()
  ])
  const fullBackupPath = await fullDownload.path()
  expect(fullBackupPath).toBeTruthy()
  const fullBackupBytes = await readFile(fullBackupPath as string)
  const fullArchive = unzipSync(new Uint8Array(fullBackupBytes))
  const fullManifest = JSON.parse(strFromU8(fullArchive['manifest.json'])) as {
    version: number
    includeOriginals: boolean
    items: unknown[]
    memoCanvas: {
      background: string
      colorMode: string
      scene: { elements: Array<{ type?: string }> }
      assets: Array<{ path: string }>
    }
  }
  expect(fullManifest.version).toBe(3)
  expect(fullManifest.includeOriginals).toBe(true)
  expect(fullManifest.items).toHaveLength(4)
  expect(Object.keys(fullArchive).some((name) => name.startsWith('images/'))).toBe(true)
  expect(fullManifest.memoCanvas.background).toBe('dots')
  expect(fullManifest.memoCanvas.colorMode).toBe('light')
  expect(fullManifest.memoCanvas.scene.elements.some((element) => element.type === 'image')).toBe(true)
  expect(fullManifest.memoCanvas.assets).toHaveLength(1)
  expect(fullArchive[fullManifest.memoCanvas.assets[0].path]).toBeTruthy()

  const includeOriginalsCheckbox = backupDialog.getByRole('checkbox', { name: '包含全部原图（推荐）' })
  await includeOriginalsCheckbox.uncheck()
  const [compactDownload] = await Promise.all([
    page.waitForEvent('download'),
    exportButton.click()
  ])
  const compactBackupPath = await compactDownload.path()
  const compactArchive = unzipSync(new Uint8Array(await readFile(compactBackupPath as string)))
  const compactManifest = JSON.parse(strFromU8(compactArchive['manifest.json'])) as {
    includeOriginals: boolean
    memoCanvas: { scene: { elements: Array<{ type?: string }> }; assets: unknown[] }
  }
  expect(compactManifest.includeOriginals).toBe(false)
  expect(compactManifest.memoCanvas.scene.elements.some((element) => element.type === 'image')).toBe(false)
  expect(compactManifest.memoCanvas.assets).toHaveLength(0)
  expect(Object.keys(compactArchive)).toEqual(['manifest.json'])
  await includeOriginalsCheckbox.check()

  await backupDialog.locator('input[type="file"]').setInputFiles({
    name: fullDownload.suggestedFilename(),
    mimeType: 'application/zip',
    buffer: fullBackupBytes
  })
  await expect(backupDialog.getByText('备份检查通过，可以选择恢复方式。')).toBeVisible()
  await expect(backupDialog.locator('.backup-summary')).toContainText('4 条内容')
  await backupDialog.getByRole('button', { name: '开始安全合并' }).click()
  await expect(backupDialog.locator('.restore-report')).toContainText('新增 0 · 跳过 4 · 失败 0')

  await backupDialog.getByRole('radio', { name: /完整覆盖/ }).click()
  page.once('dialog', (dialog) => dialog.accept())
  const [safetyDownload] = await Promise.all([
    page.waitForEvent('download'),
    backupDialog.getByRole('button', { name: '生成安全备份并完整覆盖' }).click()
  ])
  expect(await safetyDownload.path()).toBeTruthy()
  await expect(backupDialog.getByText(/恢复处理完成：新增 4 条，跳过 0 条/)).toBeVisible({ timeout: 15_000 })
  await backupDialog.getByRole('button', { name: '关闭' }).first().click()
  await expect(page.locator('.item-card')).toHaveCount(4)
  const restoredMemoResponse = await page.request.get('/api/memo-canvas')
  const restoredMemo = await restoredMemoResponse.json() as {
    background: string
    colorMode: string
    scene: { elements: Array<{ type?: string }> }
    assets: unknown[]
  }
  expect(restoredMemo).toMatchObject({ background: 'dots', colorMode: 'light' })
  expect(restoredMemo.assets).toHaveLength(1)
  expect(restoredMemo.scene.elements.some((element) => element.type === 'image')).toBe(true)

  await openDesktopAdd(page, '网页')
  const draftDialog = page.getByRole('dialog', { name: '添加网页' })
  await draftDialog.getByLabel('网页地址').fill('https://draft.example/unfinished')
  await draftDialog.getByLabel('标题').fill('刷新后恢复的草稿')
  await page.waitForTimeout(700)
  await page.reload()
  await expect(page.getByText('发现一份未完成草稿')).toBeVisible()
  await page.getByRole('button', { name: '恢复草稿' }).click()
  const restoredDraftDialog = page.getByRole('dialog', { name: '添加网页' })
  await expect(restoredDraftDialog.getByLabel('网页地址')).toHaveValue('https://draft.example/unfinished')
  await expect(restoredDraftDialog.getByLabel('标题')).toHaveValue('刷新后恢复的草稿')
  await restoredDraftDialog.getByRole('button', { name: '取消' }).click()
  await expect(page.getByText('发现一份未完成草稿')).toHaveCount(0)

  await page.evaluate(() => navigator.serviceWorker.ready)
  let offlineCard = page.locator('.item-card').filter({ hasText: '书签来源网页' })
  await context.setOffline(true)
  await offlineCard.getByRole('button', { name: '星标', exact: true }).click()
  await expect(offlineCard.getByRole('button', { name: '取消星标', exact: true })).toBeVisible()
  await expect(page.locator('.sync-indicator')).toContainText('离线模式')
  await expect(page.locator('.sync-indicator')).toContainText('1 项待同步')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.mobile-bottom-nav').getByRole('button', { name: '添加' }).click()
  const mobileAddSheet = page.getByRole('dialog', { name: '添加内容' })
  await mobileAddSheet.getByRole('button', { name: '添加文本' }).click()
  const offlineTextDialog = page.getByRole('dialog', { name: '添加文本' })
  await offlineTextDialog.getByLabel('标题').fill('断网时写下的内容')
  await offlineTextDialog.getByRole('button', { name: '保存文本' }).click()
  await expect(page.getByRole('heading', { name: '断网时写下的内容' })).toBeVisible()
  await expect(page.locator('.sync-indicator')).toContainText('2 项待同步')

  await page.locator('.mobile-bottom-nav').getByRole('button', { name: '添加' }).click()
  await page.getByRole('dialog', { name: '添加内容' }).getByRole('button', { name: '添加图片' }).click()
  const offlineImageDialog = page.getByRole('dialog', { name: '添加图片' })
  await offlineImageDialog.getByLabel('标题').fill('断网保存的图片')
  await offlineImageDialog.locator('input[type="file"]').setInputFiles({
    name: 'offline.png',
    mimeType: 'image/png',
    buffer: imageBuffer
  })
  await offlineImageDialog.getByRole('button', { name: '保存图片组' }).click()
  await expect(page.locator('.item-card').filter({ hasText: '断网保存的图片' })).toBeVisible()
  await expect(page.locator('.sync-indicator')).toContainText('3 项待同步')

  await page.reload()
  await expect(page.locator('.app-header')).toBeVisible()
  await expect(page.getByRole('heading', { name: '断网时写下的内容' })).toBeVisible()
  offlineCard = page.locator('.item-card').filter({ hasText: '书签来源网页' })
  await offlineCard.getByRole('button', { name: '更多', exact: true }).click()
  await expect(offlineCard.getByRole('menu', { name: '更多条目操作' }).getByRole('button', { name: '取消星标', exact: true })).toBeVisible()
  const cachedImage = page.locator('.item-card').filter({ hasText: '图片组' }).locator('.card-cover img')
  await expect(cachedImage).toBeVisible()
  await expect(cachedImage).toHaveAttribute('src', /^blob:/)
  const queuedImage = page.locator('.item-card').filter({ hasText: '断网保存的图片' }).locator('.card-cover img')
  await expect(queuedImage).toBeVisible()
  await expect(queuedImage).toHaveAttribute('src', /^blob:/)

  await context.setOffline(false)
  await expect(page.locator('.sync-indicator')).toContainText('数据已同步', { timeout: 15_000 })

  const offlineSyncedPage = await context.newPage()
  await offlineSyncedPage.goto('/')
  await expect(offlineSyncedPage.getByRole('heading', { name: '断网时写下的内容' })).toBeVisible()
  await expect(offlineSyncedPage.locator('.item-card').filter({ hasText: '断网保存的图片' })).toBeVisible()
  await expect(offlineSyncedPage.locator('.item-card').filter({ hasText: '书签来源网页' })
    .getByRole('button', { name: '取消星标', exact: true })).toBeVisible()
  await offlineSyncedPage.close()

  await page.setViewportSize({ width: 1440, height: 900 })
  await offlineCard.getByRole('button', { name: '取消星标', exact: true }).click()
  await expect(offlineCard.getByRole('button', { name: '星标', exact: true })).toBeVisible()

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

  await page.getByRole('button', { name: '选择条目' }).click()
  const animalBulkToolbar = page.getByRole('toolbar', { name: '批量操作' })
  const animalSelectionShell = page.locator('.item-card-shell').first()
  const animalSelectionCard = animalSelectionShell.locator('.item-card')
  const animalSelectionToggle = animalSelectionShell.locator('.item-card-selection-toggle')
  await expect(page.locator('.item-card-shell input[type="checkbox"]')).toHaveCount(0)
  await expect(animalSelectionToggle).toHaveAttribute('aria-pressed', 'false')
  await animalSelectionToggle.click()
  await expect(animalSelectionToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(animalSelectionCard).toHaveCSS('background-color', 'rgb(230, 249, 246)')
  await expect(animalBulkToolbar).toContainText('已选 1 条')
  await page.screenshot({ path: 'test-results/animal-card-selection.png', fullPage: true })
  await animalSelectionToggle.click()
  await expect(animalSelectionToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(animalBulkToolbar).toContainText('已选 0 条')

  await page.setViewportSize({ width: 430, height: 932 })
  const mobileSelectionBar = page.getByRole('toolbar', { name: '移动端批量操作' })
  await expect(mobileSelectionBar).toBeVisible()
  await expect(page.locator('.mobile-bottom-nav')).toBeHidden()
  await animalSelectionToggle.click()
  await expect(animalSelectionToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(mobileSelectionBar).toContainText('已选 1 条')
  await page.screenshot({ path: 'test-results/animal-card-selection-mobile.png', fullPage: true })
  await animalSelectionToggle.click()
  await expect(animalSelectionToggle).toHaveAttribute('aria-pressed', 'false')
  await mobileSelectionBar.getByRole('button', { name: '退出', exact: true }).click()
  await expect(page.locator('.item-card-selection-toggle')).toHaveCount(0)
  await expect(page.locator('.mobile-bottom-nav')).toBeVisible()
  await page.screenshot({ path: 'test-results/animal-mobile-home.png', fullPage: true })
  await page.locator('.mobile-bottom-nav').getByRole('button', { name: '筛选' }).click()
  const animalFilterDrawer = page.getByRole('dialog', { name: '筛选与排序' })
  await expect(animalFilterDrawer).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/animal-mobile-filter-drawer.png' })
  await animalFilterDrawer.getByRole('button', { name: '关闭' }).click()
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.locator('.app-header').getByRole('button', { name: '账号' }).click()
  const animalAccountDialog = page.getByRole('dialog', { name: '账号设置' })
  const animalQuickCategory = animalAccountDialog.getByRole('combobox', { name: '快速保存默认类别' })
  await expect(animalQuickCategory).toBeVisible()
  expect(await animalQuickCategory.evaluate((element) => element.tagName)).toBe('DIV')
  await expect(animalAccountDialog.getByRole('radio')).toHaveCount(2)
  await expect(animalAccountDialog.locator('.backup-panel').first()).not.toHaveCSS('background-image', 'none')
  await page.screenshot({ path: 'test-results/animal-account-workflow.png', fullPage: true })
  await animalAccountDialog.getByRole('button', { name: '关闭' }).first().click()

  const animalTextCard = page.locator('.item-card').filter({ hasText: '回家后整理这段纯文字' })
  await animalTextCard.getByRole('button', { name: '星标', exact: true }).click()
  await expect(page.locator('.animal-notification-host')).toContainText('已加星标')
  await openDesktopAdd(page, '网页')
  const animalDialog = page.getByRole('dialog', { name: '添加网页' })
  await expect(animalDialog.locator(':scope > div')).not.toHaveCSS('clip-path', 'none')
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/animal-add-link-modal.png', fullPage: true })
  await animalDialog.getByRole('button', { name: '关闭' }).click()
  await page.locator('.app-header').getByRole('button', { name: '设计风格' }).click()
  await page.getByRole('dialog', { name: '选择设计风格' }).getByRole('radio', { name: /Flat Design 2013/ }).click()
  await expect(syncedPage.locator('html')).toHaveAttribute('data-theme', 'flat-2013')
  await page.getByRole('dialog', { name: '选择设计风格' }).getByRole('button', { name: '关闭' }).click()
  await syncedPage.close()

  await page.locator('.app-header').getByRole('button', { name: '退出' }).click()
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
  await page.getByLabel('邮箱').fill('owner@example.com')
  await page.getByLabel(/^密码/).fill('a-secure-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.locator('.app-header')).toBeVisible()

  const shortcutPage = await context.newPage()
  await shortcutPage.goto('/#quick-clipboard=' + encodeURIComponent('快捷指令保存的文字'))
  await expect(shortcutPage.getByRole('heading', { name: '快捷指令保存的文字' })).toBeVisible()
  await expect.poll(() => shortcutPage.evaluate(() => location.hash)).toBe('')
  await shortcutPage.close()

  await page.setViewportSize({ width: 430, height: 932 })
  await page.evaluate(() => navigator.clipboard.writeText('手机剪贴板一键保存'))
  await page.locator('.mobile-bottom-nav').getByRole('button', { name: '添加' }).click()
  await page.getByRole('dialog', { name: '添加内容' }).getByRole('button', { name: '识别剪贴板并保存' }).click()
  await expect(page.getByRole('heading', { name: '手机剪贴板一键保存' })).toBeVisible()
  await page.locator('.mobile-bottom-nav').getByRole('button', { name: '更多' }).click()
  await expect(page.getByRole('dialog', { name: '更多功能' }).getByRole('button', { name: '书签按钮' })).toHaveCount(0)
  await page.getByRole('dialog', { name: '更多功能' }).getByRole('button', { name: '关闭' }).click()
  await page.setViewportSize({ width: 1440, height: 900 })

  imageCard = page.locator('.item-card').filter({ hasText: '图片组' })
  await expect(imageCard).toBeVisible()
  await imageCard.getByRole('button', { name: '删除' }).click()
  await expect(page.locator('.item-card').filter({ hasText: '图片组' })).toHaveCount(0)
  const undoBar = page.locator('.delete-undo-bar')
  await expect(undoBar).toContainText('已移到回收站')
  await undoBar.getByRole('button', { name: '撤销', exact: true }).click()
  imageCard = page.locator('.item-card').filter({ hasText: '图片组' })
  await expect(imageCard).toBeVisible()

  await imageCard.getByRole('button', { name: '删除' }).click()
  await page.locator('.app-header').getByRole('button', { name: /回收站/ }).click()
  const trashedImageCard = page.locator('.item-card').filter({ hasText: '图片组' })
  await expect(trashedImageCard).toContainText(/还可恢复 \d 天/)
  await trashedImageCard.getByRole('button', { name: '恢复', exact: true }).click()
  await expect(trashedImageCard).toHaveCount(0)
  await page.locator('.app-header').getByRole('button', { name: '返回清单' }).click()
  imageCard = page.locator('.item-card').filter({ hasText: '图片组' })
  await imageCard.getByRole('button', { name: '删除' }).click()
  await page.locator('.app-header').getByRole('button', { name: /回收站/ }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('.item-card').filter({ hasText: '图片组' }).getByRole('button', { name: '彻底删除' }).click()
  await expect(page.getByRole('heading', { name: '回收站是空的' })).toBeVisible()
  expect(pageErrors).toEqual([])
})
