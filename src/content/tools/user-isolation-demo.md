---
title: user-isolation-demo
description: 多用户 AI 聊天应用，演示按用户隔离的 Agent 架构——每个用户一个专属 Agent，会话与数据互不可见。
tags: [Python, FastAPI, React, Demo]
github: https://github.com/yaofuhong0311/user-isolation-demo
---

## 这是什么

一个完整的多用户 AI 聊天应用，核心演示**按用户隔离的 Agent 架构**：每个注册用户分配一个专属 Agent，各自拥有独立的会话上下文、对话历史和工作区，从网关层面杜绝跨用户数据串扰。

## 架构

![user-isolation-demo 架构图](/images/tools/user-isolation-arch.svg)

## 几个设计决策

- **FastAPI 是中间层**：负责认证（JWT + bcrypt）、把用户路由到自己的 Agent、双向代理 WebSocket 流——前端从不直连 AI 引擎。
- **对话正文不进数据库**：PostgreSQL 只存元数据（账号、会话列表、session ID），消息历史由 AI 引擎的会话存储持有，避免状态双写。
- **全双工 WebSocket**：一条持久连接同时承载流式 token、工具调用可视化和会话管理。
- **并行初始化**：WebSocket 连上时，会话列表加载与 AI 握手用 `asyncio.gather` 并发进行，降低首屏延迟。

支持多会话切换、首条消息自动命名会话、登录后历史恢复、前后端两侧的指数退避自动重连。
