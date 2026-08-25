---
title: AgentScope 源码调研（十二）：Memory 召回先做权限过滤
published: 2026-08-25T10:00:00+08:00
description: 向量分数只表示语义相关；Memory 检索必须先限定租户与用户，再判断可信度、有效期和本轮使用价值。
tags: [AgentScope, AI Agent, Memory, Security]
category: 源码调研
---

> Memory 检索不是在全部历史中寻找“最相似的一条”。权限过滤决定哪些数据允许参与搜索，召回算法寻找语义候选，Policy 与 Context Builder 再决定哪些内容值得交给模型。

![Memory 从授权过滤到 Context 注入的链路](/images/posts/agentscope-memory-retrieval-boundary.svg)

## 身份与作用域是检索前置条件

Agent Runtime 知道当前请求的 `tenant_id`、`user_id`、`project_id`、`session_id` 和问题。这些字段首先定义数据访问范围，其次才用于缩小搜索空间。

如果先在全库做向量搜索，再根据结果检查用户，另一租户的相似偏好已经参与计算，也可能通过分数、日志或缓存泄露。语义相似度不能承担授权职责；Reranker 同样只能处理已经授权的候选。

## 召回与使用判断是两个阶段

一条可控的读取链路包含四步：

| 阶段 | 负责回答 |
| --- | --- |
| 硬过滤 | 当前身份允许查询哪些 Memory |
| 混合召回 | 哪些内容在语义、关键词或实体上相关 |
| Policy 与 Rerank | 哪些候选仍有效、可信且没有冲突 |
| Context Builder | 本轮 Token Budget 内注入哪些内容 |

Mem0 的 `top_k`、`threshold` 和可选 Reranker 可以提高相关性，却不能判断事实是否仍然成立。Runtime 应先构造 Query 与 Filters，Memory Layer 在限定范围内召回，最终选择权仍属于业务 Policy 和 Context Builder。

## 相关不等于真实，也不等于有用

“与骑行相关”的历史偏好未必会影响本次训练计划；相似度较高的旧项目决策也可能已经失效。候选返回后仍需检查来源、有效期、版本、冲突状态和当前任务。

主 LLM 不应直接访问 Memory DB。它只消费经过筛选和压缩的 Memory，并保留来源标识。这样出现错误召回时，系统可以定位是权限过滤、召回排序、Policy 判断还是 Context 组装出了问题。

## 我的选择：先建立安全集合，再优化排序

我会把租户、用户、项目、状态和有效期作为检索的硬约束；在集合内部执行混合召回与 Rerank，再按可信度和独立 Memory 预算选取少量结果。

这会减少可参与排序的候选，也增加索引字段与 Policy 维护成本，但它把安全边界放在概率算法之前。只有数据本身完全公开且无用户隔离时，才可以弱化身份过滤；即使如此，真实性与本轮使用价值仍不能由向量分数决定。

<details>
<summary>实现依据与延伸阅读</summary>

- [Mem0：How Mem0 Searches Memory](https://github.com/mem0ai/mem0/blob/main/docs/core-concepts/memory-operations/search.mdx)
- [Mem0：How It Works](https://github.com/mem0ai/mem0/blob/main/docs/core-concepts/how-it-works.mdx)
- [Memory 不能由模型直接判定生效](/posts/agentscope-memory-trust-policy/)
- [Memory 不等于历史消息](/posts/agentscope-memory-lifecycle/)

</details>
