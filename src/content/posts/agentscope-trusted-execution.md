---
title: AgentScope 源码调研（九）：工具可见不等于执行授权
published: 2026-07-30
description: Tool Visibility 只限制模型候选动作；可信执行还需要 Policy、HITL、受控 Executor 与独立 Verifier。
tags: [AgentScope, AI Agent, Security, 源码分析]
category: 源码调研
---

> 模型能够看到并选择某个 Tool，只说明调用合同进入了候选集合，不代表平台已经授权执行。可信工具链至少要分离 Model、Policy、Executor 和 Verifier 四类职责。

![从 Tool Visibility 到可信执行边界](/images/posts/agentscope-trusted-execution.svg)

## 可见性只是能力入口

Tool Visibility 可以按任务收窄模型看到的工具，降低误选和无关权限暴露。但模型输出仍是不可信的动作建议，参数可能越界，调用也可能来自 Prompt Injection。

因此完整路径应当是：

```text
Model 提议
→ Policy 校验身份、参数与风险
→ 必要时 HITL 确认
→ Executor 在受控环境执行
→ Verifier 查询真实结果
```

只配置工具列表，不能证明后续授权、执行位置和结果校验已经存在。

## Policy、Executor 与 Verifier 不能合并

Policy 决定“是否允许”，Executor 决定“在哪里执行”，Verifier 判断“是否真实完成”。

- Shell、文件和不可信代码适合进入无生产凭据的 Sandbox；
- 订单、消息和数据库操作适合进入可信 Tool Gateway；
- Credential 在执行边界按身份获取，不进入模型上下文；
- Verifier 读取下游真实状态，不采信模型总结。

Sandbox 限制不可信执行能接触的资源，Tool Gateway 保护业务凭据与租户权限，两者解决不同风险。即使代码运行在沙箱中，通过不受限网关仍可能操作生产系统。

## HITL 是高风险动作的外部决定

源码中存在按工具配置中断与人工确认的能力，但配置项存在不等于当前部署主链已经启用。还需要检查：

- Approval 是否具有稳定 ID 并持久化；
- 服务重启后确认结果能否回到原动作；
- 只有当前 Owner 能否消费确认；
- 拒绝、超时和取消是否具有明确终态。

HITL 也不能替代基础权限。用户同意发送消息，不代表可以跨租户读取任意收件人或使用不属于当前身份的凭据。

## 我的判断：按不可逆程度分级启用

我会先建立持久化 Approval 和消费权，再接通 Server 与 UI，最后按风险分级：只读动作自动执行，可撤销写入记录审计，不可逆或跨边界动作要求确认。

代价是执行链更长，部分任务会等待用户。若工具只做本地纯计算，可以省略 HITL 和业务网关；一旦涉及生产数据、外部通信或不可撤销副作用，就不能把“模型看得见工具”当作授权完成。

<details>
<summary>证据边界</summary>

本文源码基于 AgentScope 提交 [`698297b`](https://github.com/agentscope-ai/agentscope/commit/698297b4c084e1c3954e35f06fa737a96a515275)。源码能够证明 Tool Visibility 与 HITL 配置控制点存在；是否在具体部署中启用、是否覆盖全部高风险 Tool，需要继续检查运行配置与端到端故障测试。

</details>
