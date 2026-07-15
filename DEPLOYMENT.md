# 部署到 Vercel 与 Supabase

这个项目保留本机模式；只有在设置了两个 `VITE_SUPABASE_*` 环境变量时，网页才会切换为云端模式。

## 1. 创建 Supabase 项目

1. 在 Supabase 新建项目，项目名建议使用 `do-it-laaaaaater`。
2. 选择离日常使用地点较近的区域，例如 Singapore。
3. 数据库密码只保存在密码管理器中，不要写入项目或聊天。
4. 等待项目完成初始化。

## 2. 初始化数据库与图片空间

1. 打开 Supabase 项目的 **SQL Editor**。
2. 新建查询，复制并运行 [`supabase/schema.sql`](supabase/schema.sql) 的全部内容。
3. 确认执行成功且没有红色错误。

这段脚本会创建唯一账号保护、六个默认类别、条目表、图片记录、私人图片空间和访问限制。第二个人无法通过应用注册，也无法读取第一位用户的数据。

## 3. 取得公开连接信息

在 Supabase 项目设置的 API 页面取得：

- Project URL
- Publishable key；旧项目中可能显示为 anon public key

这两个值原本就会出现在浏览器中，可以填写到 Vercel；不要使用或泄露 `service_role` key。

本机调试时复制 `.env.example` 为 `.env.local` 并填写：

```text
VITE_SUPABASE_URL=你的 Project URL
VITE_SUPABASE_ANON_KEY=你的 Publishable key
```

`.env.local` 已被 Git 忽略，不会上传。

## 4. 在 Vercel 导入仓库

1. 在 Vercel 选择 **Add New → Project**。
2. 导入 GitHub 仓库 `Andrei12138/do-it-laaaaaater`。
3. Framework Preset 选择 Vite；其他构建设置由 `vercel.json` 提供。
4. 添加以下两个环境变量，并同时勾选 Production、Preview 和 Development：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. 开始部署。

## 5. 设置邮件跳转地址

Vercel 首次部署后会得到一个 `https://...vercel.app` 地址。在 Supabase 的 Authentication → URL Configuration 中：

1. 将 Site URL 设置为正式 Vercel 地址。
2. 在 Redirect URLs 添加正式地址和 `http://localhost:5173/**`。

完成后再打开正式网页创建唯一账号。如果 Supabase 开启了邮箱确认，需要先点击确认邮件再登录。

## 6. 发布后检查

- 首次账号创建及阻止第二个账号
- 登录、退出、修改密码和忘记密码邮件
- 粘贴网页、文字与多张图片
- 图片预览、排序和删除
- 搜索、筛选、类别和状态
- 书签按钮是否指向正式 Vercel 地址
- 公司和家庭网络是否都能稳定访问

公司内网页通常无法由云端读取封面；书签按钮仍会带回浏览器能够看到的网址和标题。
