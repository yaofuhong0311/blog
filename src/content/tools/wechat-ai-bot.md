---
title: wechat-ai-bot
description: 基于 Claude Agent SDK 的微信群 AI 助手框架，带两级持久记忆。
tags: [Python, AI Agent, Demo]
github: https://github.com/yaofuhong0311/wechat-ai-bot
---

## 这是什么

一个驻守在微信群里的 AI 助手框架：被 `@bot` 时应答，能带着近期群聊上下文回答问题，解析图片、文件（PPT/Word/Excel）、转发聊天记录和链接，还能通过无头浏览器抓取 B 站、小红书这类动态页面，或调用 shell 命令做群管理（公告、@全体、踢人）。

消息链路由 [wkteam](https://wkteam.cn) 微信网关承接，AI 侧用 Claude Agent SDK 驱动，每次 `@bot` 触发一次全新的 Agent 查询，运行在带 Read/Write/Bash/WebFetch 工具的沙箱容器里。

## 消息处理时序

![wechat-ai-bot 消息处理时序图](/images/tools/wechat-ai-bot-seq.svg)

值得一说的是应答之后的三件事是**并行异步**做的：追加问答历史、让模型提取用户新事实更新画像、历史超长时压缩为摘要——不阻塞回复本身。

## 记忆设计

两级磁盘持久化：每个用户一份画像文件（`users/{wxid}.md`，跨会话记住偏好），每个群一份对话历史（`history.jsonl` + 定期压缩的 `summary.md`）。机器人重启后记忆不丢。
