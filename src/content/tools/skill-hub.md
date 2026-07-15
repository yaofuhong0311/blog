---
title: skill-hub
description: 基于 Tauri 2 的桌面应用，集中管理本地的 Claude Code skill。
tags: [Tauri, 桌面应用, AI Coding]
github: https://github.com/yaofuhong0311/skill-hub
---

## 这是什么

skill-hub 是一个管理本地 Claude Code skill 的桌面应用：把散落在各处的 skill 集中到一个界面里，可以浏览每个 skill 的说明、启用/停用，不用再手动翻目录改文件。

## 为什么做它

Claude Code 的 skill 多了以后，哪些装了、哪些生效、每个是干嘛的，很难一眼看清。skill-hub 把这些信息可视化，管理成本降下来。

## 截图

主界面按分类浏览，同一个 skill 的"个人目录版"与"Agents 库版"并排对照，一键重新扫描：

![skill-hub 主界面](/images/tools/skill-hub-list.png)

详情页展示 SKILL.md 原文，并自动生成带占位符的调用 Prompt，填参后一键复制：

![skill 详情页](/images/tools/skill-hub-detail.png)

支持按名称搜索：

![搜索](/images/tools/skill-hub-search.png)

还能联网查找功能类似的开源 skill（含下载量），方便对比与替换：

![相似 skill 推荐](/images/tools/skill-hub-similar.png)

## 怎么用

从 GitHub 仓库的 Releases 下载对应平台的安装包，安装后启动即可自动扫描本地 skill 目录。
