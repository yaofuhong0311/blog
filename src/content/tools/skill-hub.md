---
title: skill-hub
description: macOS 桌面应用，把散落在各处的 AI Agent skill 收进一个可视化看板；Tauri 2 实现，dmg 约 3MB，无后端。
tags: [Tauri, 桌面应用, AI Coding]
github: https://github.com/yaofuhong0311/skill-hub
---

## 这是什么

skill-hub 把散落在本地各处的 AI Agent skill（Claude Code、Codex、跨平台 Agents 库、插件缓存）收进一个界面：分类浏览、一句话看懂每个能干什么、填参数生成即用 prompt、在线找类似 skill、直接编辑源文件。

Tauri 2 + React，dmg 约 3MB，数据每次启动实时扫描本地文件，**没有任何后端服务**。

![skill-hub 主界面](/images/tools/skill-hub-list.png)

## 为什么做它

skill 装多了之后，"哪些装了、哪个是干嘛的、这个和那个有什么区别"很难一眼看清——它们分散在四个不同的目录里，每个 skill 的说明写在 SKILL.md 的 frontmatter 里，要看就得一个个 `cat`。

## 三个设计取舍

**① description 给模型看，简介给人看——同一份数据，两个受众。**

SKILL.md 里的 `description` 字段是写给**模型路由**用的：它要覆盖各种触发说法、写得长而全，模型据此判断该不该加载这个 skill。但这段文本直接展示给人看，冗长且抓不住重点。

所以卡片上展示的不是它，而是一句预生成的中文简介。**这是个刻意的分离**：同一个 skill 的"能力说明"，面向模型和面向人需要完全不同的表述——前者要求召回率，后者要求一眼看懂。混用一份文本，两边都不讨好。

![详情页：SKILL.md 原文 + 自动生成的调用 Prompt](/images/tools/skill-hub-detail.png)

**② 不建缓存库，每次启动实时扫描。**

看板类应用的常见做法是建个本地索引库，扫一次存起来。这里反过来——每次启动和每次点"重新扫描"都现读文件系统。

理由是这类数据的**真实来源就是那些文件**，而它们会被频繁手改（我自己就一直在改 skill）。一旦建了缓存库，就得处理"文件改了但库没更新"这类不一致，而**扫描几百个小文件本来就是毫秒级的事**——用一个不存在的性能问题，换来了一整类同步 bug，不划算。

**③ 写回源文件，但只在白名单目录内。**

详情页可以直接编辑并保存回真实的 skill 文件——这是它比"只读看板"有用的地方。但**能写文件就意味着路径穿越的风险**，所以写入路径必须落在 skill 目录白名单内才放行。

顺带一提，多来源统一（四个目录、插件多版本自动去重取最新）本质上就是一次 facade：**上层只面对"一个 skill 列表"，各来源的差异在下面消化掉**——和我在[沙箱番外篇](/posts/agent-runtime-sandbox/)里写的是同一个模式，只是这次的后端是四个本地目录。

## 其它

- **skills.sh 语义找类似**：用 description 做语义搜索（中文也有效），列出最相关的 8 个（含仓库和安装量），方便对比与替换
- **参数化 prompt 模板**：每个 skill 一条模板，`{占位符}` 渲染成输入框，填完一键复制完整 prompt

![联网查找功能类似的 skill](/images/tools/skill-hub-similar.png)

## 怎么用

到仓库 Releases 下载 dmg（Apple Silicon）拖入应用程序即可。未做 Apple 公证，首次打开需右键 → 打开，或执行 `xattr -cr /Applications/skill-hub.app`。
