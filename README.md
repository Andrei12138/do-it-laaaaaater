# Do It Laaaaaater

<div align="center">
  <img src="public/icons/app-icon-192.png" width="112" height="112" alt="Do It Laaaaaater 图标">
  <p><strong>把白天发现的网页、文字和图片集中起来，晚上再认真处理。</strong></p>
  <p>单用户 · 自托管 · 稍后阅读 · 图片收藏 · 无限备忘录画布 · PWA</p>
</div>

Do It Laaaaaater 是一个为个人使用设计的稍后阅读系统。它可以保存网页、纯文本、截图和图片组，也提供星标、计划日期、晚间处理、离线缓存、备份恢复和一张持续保存的无限画布。

你可以完全在 Windows 本机运行，也可以使用 **Vercel + Supabase** 部署自己的云端实例，在电脑和手机之间同步。

> [!IMPORTANT]
> 这是单用户应用。每个实例只能创建一个账号，第一个成功注册的人会成为唯一所有者。部署完成前不要把网址公开给其他人。

> [!NOTE]
> [do-it-laaaaaater.vercel.app](https://do-it-laaaaaater.vercel.app) 是作者的个人实例，不是公共演示站，也不开放注册。

| Flat Design 2013（默认） | Animal Island UI |
| --- | --- |
| ![Flat Design 2013 首页](docs/screenshots/flat-desktop.png) | ![Animal Island UI 添加窗口](docs/screenshots/animal-island.png) |

## 功能概览

- 保存网页、文字、PNG、JPEG 和 WebP 图片。
- 直接粘贴网址、文字或多张图片，不必先打开添加窗口。
- 自动读取网页标题和封面，失败时可以手动填写。
- 网址去重、类别、搜索、日期分组、状态、星标和计划日期。
- 智能优先、晚间处理模式、卡片快捷操作与批量处理。
- 7 天回收站、撤销、恢复和彻底删除。
- 一张全账号共享的无限备忘录画布，支持文字、图片、画笔、橡皮擦、缩放、旋转和多种背景。
- 画布中的资料卡与首页使用同一份数据，编辑、完成或删除会同步生效。
- ZIP 备份与恢复，可选择是否包含全部原图。
- PWA、iPhone 添加到主屏幕、剪贴板快捷指令和浏览器书签按钮。
- Flat Design 2013 与 Animal Island UI 两套可切换界面。

更完整的功能说明见下方的[使用与数据说明](#使用与数据说明)。

## 选择部署方式

| 方式 | 适合场景 | 数据位置 | 跨设备 |
| --- | --- | --- | --- |
| Windows 本机 | 只在一台电脑使用，或先试用 | 项目内的 `data` 文件夹 | 否 |
| Vercel + Supabase | 公司、家里和手机共同使用 | 你自己的 Supabase 项目 | 是 |

云端部署不需要 Docker。Vercel 负责运行网页，Supabase 负责账号、条目、偏好和私人图片。

## 交给 Codex 协助部署

如果你不熟悉 GitHub、Supabase 或 Vercel，可以把下面整段内容复制给 Codex。Codex 会帮助你准备项目并逐步说明操作；Supabase 建库和 Vercel 发布仍需要你在网页中亲自确认。

```text
请协助我部署 Do It Laaaaaater：
https://github.com/Andrei12138/do-it-laaaaaater

目标：部署一个只属于我的个人实例，使用 Vercel + Supabase，并保留以后从 GitHub 更新的能力。

请按以下规则协助：
1. 先阅读仓库中的 README.md、DEPLOYMENT.md、.env.example、vercel.json 和 supabase/schema.sql。
2. 帮我把项目 Fork 到自己的 GitHub 账号，并克隆到我指定的本机目录；不要直接修改上游仓库。
3. 检查 Node.js 是否为 22.13 至 24.x，安装依赖并确认项目可以构建。
4. 引导我在 Supabase 新建项目，并让我亲自在 SQL Editor 中运行 supabase/schema.sql。
5. 不要让我发送数据库密码、访问令牌或 service_role key。前端只使用 Project URL 和 Publishable key（旧项目可能叫 anon public key）。
6. 引导我在 Vercel 导入自己的 Fork，并让我亲自添加 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。
7. 引导我设置 Supabase Authentication 的 Site URL 和 Redirect URLs。
8. 部署后帮助我检查首次建号、登录、保存文字、图片、PWA 文件和手机页面。
9. 每次只告诉我当前需要完成的一个网页操作；等我回复“完成”或发送截图后再继续。
10. 不要删除、清空或重建我已有的 Supabase 数据。发现已有实例时，先让我导出包含原图的备份，再判断是否需要运行增量迁移。
```

## 云端自部署：Vercel + Supabase

### 准备

你需要：

- 一个 GitHub 账号；
- 一个 Supabase 账号；
- 一个 Vercel 账号；
- 大约 10～20 分钟。

### 1. 复制仓库

可以选择任一方式：

- 点击 GitHub 的 [Fork](https://github.com/Andrei12138/do-it-laaaaaater/fork)，再把自己的 Fork 导入 Vercel；
- 或先完成 Supabase 设置，再使用下面的 Vercel 部署按钮复制仓库。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAndrei12138%2Fdo-it-laaaaaater&env=VITE_SUPABASE_URL%2CVITE_SUPABASE_ANON_KEY&envDescription=Supabase%20Project%20URL%20and%20Publishable%20key&project-name=do-it-laaaaaater&repository-name=do-it-laaaaaater)

### 2. 建立 Supabase 数据库

1. 在 Supabase 创建一个新项目。
2. 打开 **SQL Editor**，新建查询。
3. 打开 [`supabase/schema.sql`](supabase/schema.sql)，复制全部内容并运行。
4. 确认页面显示成功且没有红色错误。

全新项目只运行 `schema.sql`，不需要再运行 `supabase/migrations` 中的历史升级文件。

### 3. 取得两项连接信息

在 Supabase 项目的 API 设置页面复制：

- `Project URL`
- `Publishable key`，旧项目中可能显示为 `anon public key`

它们需要分别填写到 Vercel：

```text
VITE_SUPABASE_URL=https://你的项目.supabase.co
VITE_SUPABASE_ANON_KEY=你的 Publishable key
```

这两项是浏览器使用的公开连接信息，真正的数据访问由 Supabase 行级权限控制。

> [!CAUTION]
> 不要把数据库密码、`service_role` key、Supabase Access Token 或任何私人密钥写入 GitHub、聊天记录或 `VITE_` 环境变量。

### 4. 在 Vercel 发布

1. 在 Vercel 选择 **Add New → Project**。
2. 导入你自己的 Fork。
3. Framework Preset 选择 **Vite**。
4. 在 **Settings → Environment Variables** 添加上面的两个变量。
5. 为 Production、Preview 和 Development 启用它们。
6. 点击 **Deploy**。

`vercel.json` 已经包含构建、输出目录和网页信息读取接口的配置，不需要填写其他构建命令。

可选变量：

```text
VITE_PUBLIC_APP_URL=https://你的正式域名
```

设置后，浏览器书签和 iPhone 快捷指令会始终指向该正式地址；不设置时会自动使用当前打开的网站地址。

### 5. 设置 Supabase 登录跳转

部署完成后，在 Supabase 打开 **Authentication → URL Configuration**：

- **Site URL**：填写你的正式 Vercel 地址。
- **Redirect URLs**：加入正式地址、需要使用的预览地址，以及 `http://localhost:5173/**`。

### 6. 创建唯一账号

打开你的正式网址并立即创建账号。密码至少 10 个字符。建号成功后注册会自动关闭，之后只显示登录页。

更详细的步骤、发布后检查和常见问题见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## Windows 本机运行

需要 Node.js `22.13` 至 `24.x`。

```bash
git clone https://github.com/Andrei12138/do-it-laaaaaater.git
cd do-it-laaaaaater
npm install
npm run dev
```

开发模式启动后访问 <http://127.0.0.1:5173>。

Windows 用户也可以直接双击根目录的 `启动 Do It Laaaaaater.cmd`。脚本会准备依赖、启动应用并打开浏览器。

本机数据保存在：

```text
data/do-it-laaaaaater.sqlite
data/images/originals
data/images/thumbs
data/memo-canvas/images
```

`data` 已被 Git 忽略。更换电脑时，请先停止应用，再完整复制 `data` 文件夹；也可以使用网页内的“数据备份与恢复”。

## 已有实例升级

升级前先在“账号 → 数据备份与恢复”中导出一份**包含全部原图**的 ZIP。

全新项目只需要当前的 `supabase/schema.sql`。较早部署的项目则按日期顺序，只运行尚未执行过的增量文件：

1. [`20260715_workflow_ux_upgrade.sql`](supabase/migrations/20260715_workflow_ux_upgrade.sql)
2. [`20260716_trash_ux_upgrade.sql`](supabase/migrations/20260716_trash_ux_upgrade.sql)
3. [`20260724_single_memo_canvas.sql`](supabase/migrations/20260724_single_memo_canvas.sql)

这些文件只增加新字段、索引、画布表和私人图片空间，不会主动清空账号、条目、类别或图片。不要为了回退网页界面而删除 Supabase 中的新字段。

推荐更新顺序：

1. 导出备份。
2. 阅读本次更新说明和新增迁移。
3. 在 Supabase SQL Editor 运行尚未执行的迁移。
4. 先检查 Vercel Preview。
5. 再合并到 `main`，由 Vercel 更新正式网站。

## 使用与数据说明

### 收集与处理

- 首页可以直接粘贴网址、文字和多张图片。
- 网页标题与封面会自动获取，失败不会阻止保存。
- 重复网址不会覆盖原条目或重置录入时间。
- “智能优先”依次显示逾期、今天、星标和其余内容；其余内容按中国时间的录入日期分组。
- 待处理条目显示“X 天未看”，已完成条目显示“X 天前看了”。
- 选择模式支持整张卡片点选和批量状态、类别、星标、计划及回收站操作。

### 图片与画布

- 单张图片不超过 20 MB，每组最多 30 张。
- 普通删除只移入 7 天回收站，彻底删除后才清理关联图片。
- 每个账号只有一张持续保存的无限画布。
- 画布卡片引用资料库原条目，不会复制出另一份内容。
- 备份格式可包含条目原图、画布内容和画布原图。

### 离线与 PWA

- PWA 只缓存网页外壳和版本化静态资源。
- 登录后的清单、文本和已同步图片会保存在按账号隔离的浏览器存储中。
- 离线修改会进入本机队列，恢复网络后按顺序同步。
- iPhone 使用 Safari 的“分享 → 添加到主屏幕”安装。

应用不会保存外部网页的完整正文。离线时仍可整理清单和查看已缓存图片，但打开原网页需要网络。

## 项目结构

```text
src/                    网页界面、主题、离线队列、备份和交互
server/                 本机账号、数据库、图片与网页信息读取
api/                    Vercel 网页信息读取入口
supabase/               全新建库脚本与增量升级脚本
public/                 PWA、应用图标和画布离线字体
tests/                  接口、数据和浏览器流程检查
docs/                   README 截图
licenses/               第三方许可文本
```

## 开发与检查

```bash
npm run typecheck       # 检查前后端类型
npm test                # 运行自动检查
npm run build           # 生成正式版本
npm run test:e2e        # 使用 Edge 操作完整流程
npm run check           # 类型检查 + 自动检查 + 正式构建
```

主要技术：React、TypeScript、Vite、Express、Supabase、Excalidraw、Vitest 和 Playwright。

## 安全边界

- Supabase 表启用了行级权限，图片空间为私人空间。
- 网页信息读取设置了超时、响应大小限制和危险地址拦截。
- ZIP 恢复会检查版本、文件类型、图片大小、组内数量、危险路径和清单一致性。
- `.env`、本机数据库、图片目录、构建产物和测试结果均已加入 `.gitignore`。
- Vercel Preview 与 Production 如果使用同一个 Supabase 项目，就会看到并修改同一份真实数据。

## 主题、素材与使用范围

- **Flat Design 2013**：基于 NovusGFX Retro Design System，MIT。
- **Animal Island UI**：组件与素材版本 `1.2.2`，CC BY-NC 4.0。
- **Excalidraw**：无限画布基础，MIT；相关离线字体保留各自许可。

由于 Animal Island UI 素材采用 **CC BY-NC 4.0**，包含这些素材的默认版本仅适合个人、非商业部署。请保留页面底部和仓库中的作者署名。商业使用前需要替换相关素材或另行取得授权。

本项目自身代码目前没有单独声明通用开源许可证。仓库公开主要用于展示、学习和个人非商业自部署；再分发、商用或将代码合入其他产品前，请先联系项目所有者并核对所有第三方许可。

完整来源、固定版本和许可文本见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [`licenses/`](licenses/)。
