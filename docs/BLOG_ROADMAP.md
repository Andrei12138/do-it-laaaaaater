# 朋友圈博客（Moments Blog）架构与演进路线图

## 已落地能力（Phase 1 & Phase 2）

基于项目既有的 **Cloudflare Workers + D1 + R2** 原生架构（零额外云服务），已完成一期与二期核心功能闭环：

### 一期：朋友圈与公众号双形态信息流（Phase 1）
- **博客作为默认公开首页 + 工作台收进 `/app`**：
  - `/`：朋友圈动态与长文混合信息流（访客免登录可读/点赞/留言；同时向下兼容 `/blog/*` 路径）
  - `/articles/:shortId`：公众号风格长文阅读页（自动生成目录 TOC、macOS 风格代码块与一键复制、图片灯箱、字数/阅读时长、上下篇导航、底部悬浮互动栏与精选留言）
  - `/moments/:shortId`：单条动态详情页与楼层评论
  - `/archives`：微信个人相册风格时间线归档（日期分栏 + 1~9 图迷你拼图）
  - `/app`：稍后阅读清单、计划与备忘录画布工作台（未登录时显示登录页；博客封面右上角人像按钮直达登录）
  - `/api/blog/feed.xml`：标准 RSS 2.0 订阅源
  - 登录后顶部导航内置 **「博客」** 一级 Tab，支持直接发布/编辑/置顶/管理评论，并在「稍后阅读」条目菜单支持 **「转摘到博客」**（自动将私有 R2 图片复制到公开 `blog_media` 桶路径）。
- **视觉语言**：融合微信朋友圈 620px 居中信息流交互手感与主站 Figma Design System（纯白画廊 + `#4d49fc` 电光靛蓝 + 四档圆角 + 极简无阴影卡片），支持一键切换亮/暗夜间模式。
- **权限与安全**：支持每篇动态/长文独立设置 `public`（公开）/ `private`（仅自己可见）/ `password`（PBKDF2 密码解锁，HttpOnly 解锁 Cookie 绑定密码哈希，改密即失效）。

### 二期：R2 全局歌单、富媒体实况与数字花园独立页（Phase 2）
- **R2 音乐歌单与全局悬浮播放器（`blog_music_tracks`）**：
  - 媒体接口支持原生音频上传与 HTTP `Range`（`206 Partial Content` + `Accept-Ranges: bytes` + `ETag`）流式拖动播放；
  - 全局 `<BlogMusicProvider>` 跨全站博客路由持续不断流播放，配备左下角黑胶旋转胶囊、LRC 时间轴同步歌词滚动抽屉与博主歌单管理弹窗；
  - 支持在朋友圈动态与长文中插入音乐分享卡片，一键联动全局播放器试听。
- **多媒体增强：视频动态 & iOS Live Photo 实况图**：
  - 支持 R2 原生视频（MP4 / MOV / WebM）流式上传播放，以及 Bilibili / YouTube 外链卡片按需懒加载内嵌播放；
  - 支持九宫格图片配对实况短视频（`liveVideoMediaId` / `liveVideoUrl`），桌面端悬停、移动端按压丝滑播放 Live Photo 实况画面并展示 `LIVE` 徽章。
- **数字花园独立展示页与友链（`blog_pages` / `blog_page_comments` / `blog_catalog_items` / `blog_friends`）**：
  - 封面头部内置单行栏目导航条，打通 `动态`（`/`）、`相册`（`/archives`）、`关于`（`/about`）、`装备`（`/equipment`）、`实验室`（`/labs`）、`友链`（`/friends`）及对应 `/blog/*` 兼容路径；
  - `/about`：支持 Markdown 自由排版、横幅封面与独立访客留言板；
  - `/equipment` & `/labs`：支持分类筛选、规格标签、外链跳转与博主可视化增删改排序；
  - `/friends`：双列友链名片墙，支持头像上传/外链与访客一键随机换序。

---

## 后续可选演进待办（Future Backlog）

1. **豆瓣书影音同步**
   - `blog_posts.metadata_json` 已预留 `douban: { title, cover, link, rating, status }`；
   - 可利用 Cloudflare Workers Cron Triggers 定时同步豆瓣在读/在看/已看记录并生成卡片动态。
2. **评论邮件通知**
   - 当访客在动态、长文或「关于」页留言板提交新评论/回复时，接入 Resend / MailChannels 向博主或被回复访客发送邮件提醒。
3. **R2 存储用量与媒体资产统计面板**
   - 在博客设置或工作台提供 `blog_media` 与私有图片的 R2 占用体积、各类型文件计数（图片/音频/视频）及孤儿媒体清理工具。
