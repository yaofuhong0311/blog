---
title: ai-coding-workflow
description: 一套让 AI Coding Agent 不再重复犯错、且无法绕过质量底线的工程方法论与配套脚本。
tags: [Python, Claude Code, AI Coding, Demo]
github: https://github.com/yaofuhong0311/ai-coding-workflow
---

## 这是什么

针对 AI Coding Agent 两个结构性缺陷——**没有记忆**（每次新会话从零开始，坑重复踩）和**规则靠自觉**（prompt 里写的规范，复杂任务中会被遗忘）——的一套工程化解法，包含可直接安装的规则模板、hook 脚本和配置。

三层机制形成闭环：

![三层防御全景图](/images/posts/ai-coding-workflow.svg)

- **软约束**：写进 CLAUDE.md 的行为规则，解决"意识"问题
- **硬执行**：PostToolUse hook 在每次写文件后自动扫描，违规信息强制塞回 Agent 上下文，机械触发、不可绕过
- **后置记录**：踩坑经验自动采集，蒸馏成规则写回 CLAUDE.md，下次会话自动加载

配套的四阶段验证流水线：

![四阶段验证流水线](/images/posts/staged-verify.svg)

## 详细说明

这套方法论的完整推导和实战经验，写在博客文章[《我的 AI Coding 工作流：从"管住它"到"验证它"》](/posts/ai-coding-workflow-2026/)里；仓库提供的是可落地的模板与脚本（面向 Python + Claude Code 场景）。
