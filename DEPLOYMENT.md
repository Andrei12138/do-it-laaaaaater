# 部署到 Cloudflare（Workers + D1 + R2）

Do It Laaaaaater 现已统一为纯网页 / PWA 架构，由 **Cloudflare Workers** 托管前端页面与 `/api/*` 后端接口，**Cloudflare D1** 保存账号、条目、分类和备忘录画布数据，**Cloudflare R2** 私有存储原图与缩略图。

旧版的 Windows 本机独立模式与 Vercel + Supabase 部署方式已移除。电脑和手机（含 iPhone 主屏幕 PWA）统一访问同一个 Cloudflare 网址，数据实时同步。

> [!IMPORTANT]
> 这是单用户应用。每个实例只能注册一个账号，第一个完成注册的人就是唯一所有者；注册成功后入口会自动关闭。在完成首次建号前，请不要公开你的网址。

## 部署前准备

开始前请准备：

- 一个 **Cloudflare 账号**（免费套餐即可；启用 R2 需要先在 Cloudflare 控制台开通 R2，个人使用通常在免费额度内）。
- 一台安装了 **Node.js `22.13` 至 `24.x`** 与 **Git** 的电脑（用于初次创建资源与部署）。
- （推荐）一个托管在 Cloudflare 的**自定义域名**，尤其是国内网络环境下访问更稳定，且会自动配置 HTTPS。

如果你之前使用旧版 **Vercel + Supabase** 部署过实例，请先阅读文末的[从旧版 Vercel 站点迁移数据](#从旧版-vercel-站点迁移数据)，先导出完整 ZIP 备份再开始迁移。

---

## 1. 获取代码并安装依赖

在终端中克隆或下载你 Fork 后的仓库，然后安装依赖：

```bash
git clone https://github.com/Andrei12138/do-it-laaaaaater.git
cd do-it-laaaaaater
npm install
```

## 2. 登录 Cloudflare CLI（Wrangler）

```bash
npx wrangler login
```

命令会自动打开浏览器，登录你的 Cloudflare 账号并点击授权即可。

## 3. 创建 D1 数据库

运行以下命令创建数据库（名称需与 `wrangler.jsonc` 中的 `database_name` 一致）：

```bash
npx wrangler d1 create do-it-laaaaaater-db
```

终端会输出一段配置信息，找到其中的 `database_id`（一串类似 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` 的 UUID）。

打开仓库根目录的 [`wrangler.jsonc`](wrangler.jsonc)，把 `REPLACE_WITH_D1_DATABASE_ID` 替换成你刚刚得到的 `database_id`：

```jsonc
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "do-it-laaaaaater-db",
      "database_id": "这里填入你的真实 database_id",
      "migrations_dir": "migrations"
    }
  ],
```

> [!TIP]
> `database_id` 只是资源标识，不是数据库密码；但如果你把仓库保持公开，也可以选择将修改后的 `wrangler.jsonc` 仅保留在私有 Fork 中。

## 4. 创建 R2 私有图片存储桶

先确保已在 Cloudflare 控制台左侧菜单进入 **R2 Object Storage** 完成开通，然后在终端运行：

```bash
npx wrangler r2 bucket create do-it-laaaaaater-images
```

**不要开启公开访问（R2.dev）**。所有图片都通过 Worker 的 `/api/*` 接口校验登录会话后按需返回，存储桶保持私有即可。

## 5. 初始化远端数据库表结构

执行 D1 迁移脚本，将 [`migrations/0001_init.sql`](migrations/0001_init.sql) 应用到远端数据库：

```bash
npm run db:migrate:remote
```

终端询问确认时输入 `y` 并回车。看到迁移成功提示后即完成建表，包含：

- 唯一账号与会话表（`users`、`sessions`）
- 分类、条目、偏好与 7 天回收站索引（`categories`、`items`、`user_preferences`）
- 图片元数据表（`assets`）
- 无限备忘录画布及画布图片表（`memo_canvases`、`memo_canvas_files`）

## 6. 可选：固定书签与快捷指令域名

如果打算绑定自定义域名，并希望“浏览器书签按钮”和“iPhone 快捷指令”始终生成该正式域名，可以在构建前复制 [`.env.example`](.env.example) 为 `.env.local` 并填写：

```text
VITE_PUBLIC_APP_URL=https://你的正式域名
```

不设置也没关系，应用会自动使用当前打开页面的网址。`.env.local` 已被 Git 忽略，不会被提交。

## 7. 构建并部署

运行一键构建与部署命令：

```bash
npm run deploy
```

该命令会依次执行前后端类型检查、`vite build` 打包前端，再通过 `wrangler deploy` 将静态页面与 Worker 接口一并发布到 Cloudflare。

部署完成后，终端会打印你的访问地址（例如 `https://do-it-laaaaaater.<你的子域>.workers.dev`）。

## 8. 推荐：绑定自定义域名

1. 登录 Cloudflare 控制台，进入 **Workers & Pages** → 点击 **`do-it-laaaaaater`**。
2. 打开 **Settings → Domains & Routes → Add → Custom Domain**。
3. 输入你在 Cloudflare 托管的域名（例如 `later.example.com`）并确认。
4. 等待约 1 分钟自动签发 HTTPS 证书后，即可直接用该域名访问。

## 9. 创建唯一账号

打开你的正式网址，立即注册唯一账号：

- 密码至少 10 个字符（服务端使用 PBKDF2-SHA256 加盐哈希保存）。
- 注册成功后会直接登录，注册入口随后自动关闭，其他人无法再注册，也无法访问你的数据。

---

## 从旧版 Vercel 站点迁移数据

如果你正在从旧版 **Vercel + Supabase** 实例迁移到新的 Cloudflare 实例，只需通过应用内置的 ZIP 备份与恢复功能即可无损搬家：

### 第一步：在旧版 Vercel 站点导出完整备份

1. 打开旧版 Vercel 网站并登录你的账号。
2. 点击顶部（或手机底部“更多”）进入 **账号 → 数据备份与恢复**。
3. 勾选 **包含全部原图**（条目原图、封面和无限备忘录画布及画布图片都会一起打包）。
4. 点击 **导出 ZIP 备份**，等待下载完成并妥善保存该 `.zip` 文件。

### 第二步：部署并初始化新的 Cloudflare 实例

1. 按上面的步骤 1～9 部署好你的 Cloudflare Workers + D1 + R2 实例。
2. 打开新的 Cloudflare 网址，注册你的唯一账号（可使用与旧站相同的邮箱和密码）。

### 第三步：在新站点导入 ZIP 备份

1. 登录新的 Cloudflare 实例，进入 **账号 → 数据备份与恢复**。
2. 选择刚才从旧版 Vercel 导出的 `.zip` 文件。
3. 恢复模式选择 **完整覆盖**（新实例为空时推荐，会完整还原分类、条目、状态、星标、计划日期、回收站、原图与备忘录画布；若新实例已录入少量内容想保留，可选择 **安全合并**）。
4. 点击开始恢复，等待进度完成并核对页面展示的恢复报告。

### 第四步：核对与收尾

1. 检查清单条目数量、原图与缩略图显示、分类、星标、计划日期和无限备忘录画布是否完整。
2. 在电脑浏览器重新拖入新的书签按钮；在 iPhone 更新快捷指令里的接收地址，并重新“添加到主屏幕”安装 PWA。
3. 确认新站稳定运行几天且本地留存了备份后，再停用或删除旧的 Vercel 项目与 Supabase 项目。

---

## 日常更新与升级

后续拉取仓库新版本时：

```bash
git pull
npm install
npm run db:migrate:remote
npm run deploy
```

- 升级前建议先在网页内导出一份包含全部原图的 ZIP 备份。
- `npm run db:migrate:remote` 只会执行尚未应用的新迁移文件，不会清空已有数据。

## 本机开发与调试

虽然不再提供 Windows 本机独立运行模式，但开发和调试时仍可使用 Wrangler 在本机模拟 Workers + D1 + R2：

```bash
# 首次运行先初始化本机模拟 D1 数据库
npm run db:migrate:local

# 方式 A：构建前端后通过 Wrangler 一体化预览（访问 http://127.0.0.1:8787）
npm run build
npm run dev

# 方式 B：前后端热更新开发（两个终端分别运行，访问 http://127.0.0.1:5173）
# 终端 1：
npm run dev
# 终端 2：
npm run dev:web
```

本机调试产生的模拟数据保存在 `.wrangler/` 目录中（已被 Git 忽略），不影响线上 Cloudflare 数据。

## 发布后检查清单

- 首次注册成功后刷新页面，确认注册入口已关闭，仅显示登录页。
- 保存网页链接、纯文本、单张与多张图片均正常，缩略图与原图均可打开。
- 重复网址自动去重，不会覆盖原条目或重置录入时间。
- 分类、星标、计划日期、智能优先、晚间处理、批量操作和 7 天回收站正常。
- 无限备忘录画布可正常绘制、贴图、拖入资料卡，刷新后保持一致。
- 含原图与不含原图的 ZIP 备份均可导出，恢复报告正常显示。
- 电脑与手机端均可安装 PWA：`/manifest.webmanifest`、`/sw.js` 与 `/icons/app-icon-512.png` 可正常访问；iPhone Safari 可通过“分享 → 添加到主屏幕”全屏使用。
- 联网加载后断网刷新，已同步清单与缓存图片仍可查看，离线新增内容在恢复网络后自动同步。

## 常见问题

### 为什么 `workers.dev` 域名打不开或很慢？

部分网络环境对 `*.workers.dev` 访问受限。请在 Cloudflare 控制台为该 Worker 绑定一个自定义域名（见第 8 步），访问速度和稳定性会明显提升。

### 为什么电脑和手机的数据没有同步？

确认两端打开的是同一个 Cloudflare 网址（同一个 Worker 实例）并登录了同一个账号。如果刚完成更新，点击页面提示的“更新并刷新”或重新进入主屏幕应用即可。

### 为什么添加到 iPhone 主屏幕后需要重新登录？

iOS 会将主屏幕 PWA 视为独立的浏览器存储空间，首次打开时重新登录一次即可，之后会通过会话 Cookie 保持 30 天登录状态。

### 为什么某些公司内网网页抓不到标题或封面？

网页元信息由 Cloudflare Worker 从公网抓取，无法访问仅限公司内网或需要登录的页面。这类网页仍可正常保存，配合浏览器书签按钮可以直接带回当前网页标题。

### 离线时可以打开保存过的外部网页吗？

应用会离线缓存条目的标题、网址、文本以及上传到 R2 的图片，不会抓取保存外部网页的完整正文。断网时可以整理清单、编辑备忘录和查看已缓存图片，打开外部原网页仍需要网络。
