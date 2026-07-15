---
title: A2A Agent Marketplace
description: 基于 A2A 协议的多 Agent 代码理解助手——三个专业 Agent 协作分析代码库并产出架构图。
tags: [Python, A2A, 多Agent, Demo]
github: https://github.com/yaofuhong0311/A2A
---

## 这是什么

输入一个本地项目路径，多个专业 Agent 自动协作，产出一份中文架构分析报告和 Mermaid 架构图（可下载 HTML）。核心不在"分析代码"本身，而在**验证 A2A 协议的多 Agent 协作模式**：Agent 之间通过 A2A 协议互相发现、传递消息、协商结果，不是一个大模型包办所有事。

## 协作流程

![A2A 多 Agent 协作流程](/images/tools/a2a-flow.svg)

三个 Agent 各司其职：

- **CodeReader**：扫描目录结构、按关键词搜索代码——只负责"读"
- **Analyst**：基于读到的代码写架构分析，并承担**审核**角色
- **Diagrammer**：把分析转成 Mermaid 架构图

流程里有一个真实的**协商回路**：Diagrammer 画完的图要交回 Analyst 审核，发现与分析不符就打回重画。每一步 A2A 调用在 Streamlit 界面上实时可见，能直观看到 Agent 之间是怎么传球的。

## 技术栈

Python 3.11 + A2A SDK + Streamlit。
