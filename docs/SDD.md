# SDD — 个人博客

## 目标
个人博客站点，承载三类内容：自制小工具展示、学习笔记、AI Coding 经验分享。

## 技术选型
- **模板**：Fuwari（Astro + Tailwind + Svelte），clone 自 saicaca/fuwari，保留上游结构便于后续手动同步更新。
- **部署**：Cloudflare Pages，连 GitHub 仓库自动构建；先用 `*.pages.dev`，自定义域名申请下来后绑定。
- **包管理**：pnpm。

## 结构约定
- 文章：`src/content/posts/`，Markdown，学习笔记 / AI Coding 经验用分类（category）区分，不另设页面。
- 工具展示页：`src/pages/tools.astro`，数据来自 `src/data/tools.ts`（新增工具 = 加一条配置 + 可选截图放 `public/images/tools/`）。工具本体不在站内运行，只做介绍 + GitHub/下载链接。
- 站点配置集中在 `src/config.ts`（标题、语言 zh_CN、导航、个人资料）。

## 明确不做（要了再加）
- 评论系统（候选方案 giscus，零后端）
- 工具网页版站内运行、访问统计、英文版

## Changelog
- 2026-07-15：初版。确定 Fuwari + Cloudflare Pages 方案，新增 /tools 页与 tools.ts 数据约定。
