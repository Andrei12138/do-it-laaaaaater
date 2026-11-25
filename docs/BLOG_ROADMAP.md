# 朋友圈博客（Moments Blog）架构与二期扩展路线图

## 一期已落地能力（Phase 1）

基于项目既有的 **Cloudflare Workers + D1 + R2** 原生架构（零额外云服务），已完成以下完整闭环：

- **博客作为默认公开首页 + 工作台收进 `/app`**：
  - `/`：朋友圈动态与长文混合信息流（访客免登录可读/点赞/留言；同时向下兼容 `/blog/*` 路径）
  - `/articles/:shortId`：公众号风格长文阅读页（自动生成目录 TOC、macOS 风格代码块与一键复制、图片灯箱、字数/阅读时长、上下篇导航、底部悬浮互动栏与精选留言）
  - `/moments/:shortId`：单条动态详情页与楼层评论
  - `/archives`：微信个人相册风格时间线归档（日期分栏 + 1~9 图迷你拼图）
  - `/app`：稍后阅读清单、计划与备忘录画布工作台（未登录时显示登录页；博客封面右上角人像按钮直达登录）
  - `/api/blog/feed.xml`：标准 RSS 2.0 订阅源
  - 登录后顶部导航新增 **「博客」** 一级 Tab，支持直接发布/编辑/置顶/管理评论，并在「稍后阅读」条目菜单支持 **「转摘到博客」**（自动将私有 R2 图片复制到公开 `blog_media` 桶路径）。
- **视觉语言**：融合微信朋友圈 620px 居中信息流交互手感与主站 Figma Design System（纯白画廊 + `#4d49fc` 电光靛蓝 + 四档圆角 + 极简无阴影卡片），支持一键切换亮/暗夜间模式。
- **权限与安全**：支持每篇动态/长文独立设置 `public`（公开）/ `private`（仅自己可见）/ `password`（PBKDF2 密码解锁，HttpOnly 解锁 Cookie 绑定密码哈希，改密即失效）。

---

## 二期预留扩展位与路线图（Phase 2 Backlog）

`migrations/0003_blog.sql` 已提前预留以下扩展字段，后续扩展无需破坏现有表结构：

1. **R2 音乐歌单与全局悬浮播放器**
   - `blog_media.kind` 已支持 `'audio'` 与 `'lyric'`；
   - `blog_posts.metadata_json` 预留 `music: { title, artist, coverUrl, audioUrl, lrcUrl }` 字段；
   - 后续可新增 `blog_music_tracks` 表 + 全局悬浮迷你播放器（参考 `zhjurz/pyq` 的 R2 歌单与 LRC 歌词同步）。
2. **多媒体增强：视频动态 & iOS Live Photo 实况图**
   - `blog_media.kind` 已支持 `'video'`，`blog_media.paired_media_id` 已预留实况图图片-视频配对引用；
   - `blog_posts.metadata_json` 预留 `video`（R2 直传 / Bilibili / 抖音卡片）与 `livePhotos` 配对数据。
3. **独立扩展展示页与友链**
   - `blog_settings.extensions_json` 预留导航开关与配置；
   - 后续可新增 `/blog/about`（关于）、`/blog/equipment`（装备清单）、`/blog/labs`（实验室项目展示）、`/blog/friends`（友链）及相关 D1 表。
4. **豆瓣书影音同步 & 邮件通知**
   - `blog_posts.metadata_json` 预留 `douban: { title, cover, link, rating, status }`；
   - 可利用 Cloudflare Workers Cron Triggers 定时同步豆瓣记录，以及在评论提交时接入 Resend / MailChannels 邮件提醒。
