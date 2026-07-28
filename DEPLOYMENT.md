# 部署到 Vercel 与 Supabase

Do It Laaaaaater 同时支持本机模式和云端模式。只有设置了 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY`，正式构建才会连接 Supabase；不设置时仍使用本机数据库与图片目录。

可选的 `VITE_PUBLIC_APP_URL` 用于指定书签按钮和 iPhone 快捷指令应打开的正式域名。不设置时，应用会自动使用当前打开的网站地址。

## 部署前准备

需要以下账号：

- GitHub：保存代码。
- Supabase：保存唯一账号、类别、条目、偏好和私人图片。
- Vercel：构建并托管网页。

不要把 Supabase 数据库密码、访问令牌或 `service_role` key 写入仓库、聊天或前端环境变量。

如果正在升级一个已经有内容的实例，请先在现有网页的“账号 → 数据备份与恢复”中导出一份**包含全部原图**的 ZIP 备份。

## 1. 准备 Supabase

### 全新项目

1. 在 Supabase 新建项目，区域选择靠近日常使用地点的位置，例如 Singapore。
2. 打开 **SQL Editor** 并新建查询。
3. 复制并运行 [`supabase/schema.sql`](supabase/schema.sql) 的全部内容。
4. 确认执行成功且没有红色错误。

脚本会创建：

- 唯一账号保护。
- 六个默认类别。
- 条目、图片和账号偏好表。
- 星标与今日计划字段和索引。
- 7 天回收站字段和索引。
- 唯一备忘录画布、画布图片记录及私人画布图片空间。
- 私人图片空间与访问限制。

### 已有项目升级

已经运行过旧版 `schema.sql` 的项目不要重建数据库，也不要再次创建账号。请按时间顺序在 **SQL Editor** 中运行尚未执行过的增量脚本：

[`supabase/migrations/20260715_workflow_ux_upgrade.sql`](supabase/migrations/20260715_workflow_ux_upgrade.sql)

[`supabase/migrations/20260716_trash_ux_upgrade.sql`](supabase/migrations/20260716_trash_ux_upgrade.sql)

[`supabase/migrations/20260724_single_memo_canvas.sql`](supabase/migrations/20260724_single_memo_canvas.sql)

这些是可重复执行的增量升级，会：

- 为已有条目增加星标与今日计划。
- 创建快速保存默认类别偏好。
- 补充索引和当前账号的访问规则。
- 把已有条目安全回填为“未星标、无今日计划”。
- 增加回收站时间与查询索引；已有条目保持在原清单中，不会自动进入回收站。
- 增加唯一画布、画布图片记录及其私人存储空间。

它不会删除或重建现有账号、类别、条目和图片。确认 SQL 执行成功后，再发布包含新功能的网页版本；否则新网页会因为缺少字段而无法正常读取数据。

## 2. 取得公开连接信息

在 Supabase 项目的 API 设置页面取得：

- **Project URL**
- **Publishable key**；旧项目中可能显示为 `anon public key`

这两个值本来就会出现在浏览器中，可以放入 Vercel。不要使用 `service_role` key。

本机连接云端调试时，可以把 `.env.example` 复制为 `.env.local`：

```text
VITE_SUPABASE_URL=你的 Project URL
VITE_SUPABASE_ANON_KEY=你的 Publishable key
```

`.env.local` 已被 Git 忽略。

## 3. 在 Vercel 导入仓库

1. 在 Vercel 选择 **Add New → Project**。
2. 导入你自己 Fork 后的仓库；也可以使用 README 中的 **Deploy with Vercel** 按钮复制项目。
3. Framework Preset 选择 **Vite**；构建与路由设置由 `vercel.json` 提供。
4. 在项目 **Settings → Environment Variables** 中添加：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. 为 Production、Preview 和 Development 三种环境启用这两个变量。
6. 点击 Deploy。

Vercel 会为 `main` 分支提供正式地址，并为其他分支或 Pull Request 生成预览地址。如果 Preview 和 Production 使用同一个 Supabase 项目，两者会看到同一份账号和数据。

如果希望所有预览地址生成的书签和 iPhone 快捷指令都回到同一个正式域名，可以额外设置：

```text
VITE_PUBLIC_APP_URL=https://你的正式域名
```

## 4. 设置邮件跳转地址

部署完成后，在 Supabase 的 **Authentication → URL Configuration** 中设置：

- **Site URL**：你的正式 Vercel 地址，例如 `https://do-it-laaaaaater.vercel.app`。
- **Redirect URLs**：加入正式地址、需要使用的 Vercel 预览地址，以及 `http://localhost:5173/**`。

如果开启了邮箱确认，首次创建账号后需要先点击确认邮件再登录。

## 5. 首次建号

打开正式网址并创建唯一账号。建号完成后注册会自动关闭，第二个人不能再通过应用注册，也不能读取第一个账号的数据。

如果这是从旧版本升级，继续使用原账号登录，不要重新建号。

## 6. 安全发布本次工作流升级

推荐顺序：

1. 从当前正式网页导出一份包含全部原图的 ZIP 备份。
2. 在 Supabase SQL Editor 按顺序运行尚未执行的增量迁移；当前最后一份是 `20260724_single_memo_canvas.sql`。
3. 确认没有错误后，先查看 Vercel Preview。
4. 验证登录、现有条目、现有图片、星标、计划日期、默认类别和回收站。
5. 再把功能分支合并到 `main`，由 Vercel 自动更新正式站。

如果只回退网页代码，新加的数据库字段可以安全保留，不需要删除。不要为了回退界面而手动清空 Supabase 表或图片空间。

## 7. 发布后检查

- 原账号可以登录，已有内容和图片仍然存在。
- 快速保存与保存并分类都在新窗口打开，来源网页不跳转。
- 重复网址只显示已有条目，不修改录入时间。
- 默认快速保存类别可以跨设备同步。
- 星标、今日、逾期、智能排序和快捷筛选正常。
- 明天、一周后、清除计划和计划日期排序正常。
- 晚间处理、卡片快捷修改和批量操作正常。
- 普通删除先进入回收站，撤销与恢复可用；彻底删除前有确认，回收站提示 7 天期限。
- 含原图与不含原图的 ZIP 都能导出。
- 安全合并和完整覆盖能显示正确恢复报告。
- 两套主题可以切换，刷新后仍记住选择。
- 在移动端确认底部“清单 / 筛选 / 添加 / 备忘录 / 更多”导航可用，选择模式会切换成紧凑批量栏，筛选和添加抽屉不会超出屏幕。
- 验证手机“识别剪贴板并保存”和账号设置中的 iPhone 快捷指令接收地址。
- 联网打开一次完整清单后断网刷新，确认清单、文本和图片仍可查看；确认首页不等待原图缓存，缓存面板可暂停、继续和重试；断网新增一条文本或图片，恢复联网后确认自动同步。
- `/manifest.webmanifest`、`/sw.js` 与 `/icons/app-icon-512.png` 可以访问。
- 支持安装提示的浏览器会显示“安装应用”；iPhone Safari 可以通过“分享 → 添加到主屏幕”全屏打开。

公司内网页通常无法由云端读取标题或封面；浏览器书签仍可带回当前网址和标题。

## 常见问题

### 两个 Vercel 地址都能打开，它们的数据互通吗？

只要两个地址使用同一组 Supabase 环境变量，并且登录同一个账号，就会读取同一份数据。Vercel 地址只负责加载网页，实际内容保存在 Supabase。

### 为什么 Vercel Preview 看不到新功能？

确认预览部署使用的是正确分支，并重新部署。若页面能打开但数据读取失败，先确认 Supabase 增量升级脚本已经成功执行。

### 为什么添加到主屏幕后需要重新登录？

iOS 可能把主屏幕应用视为单独的浏览环境，首次打开时重新登录一次即可。

### 更新后仍看到旧页面怎么办？

网页会提示有新版本可用。点击更新并刷新；必要时关闭所有已打开的标签页或主屏幕应用后重新进入。

### 离线时可以打开保存过的外部网页吗？

应用会离线保存条目的标题、网址、文本和上传到本工具的图片，但不会复制外部网站的正文。断网时可以整理清单和查看已同步图片；打开外部网页本身仍然需要网络。
