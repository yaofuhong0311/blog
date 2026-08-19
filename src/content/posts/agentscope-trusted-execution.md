---
title: AgentScope 源码调研（九）：从 Tool Visibility 到可信执行边界
published: 2026-08-17
description: 从工具可见性、风险策略、HITL、Sandbox、Tool Gateway 与 Verifier 的职责出发，分析为什么模型能够选择工具，不代表它已经获得执行授权。
tags: [AgentScope, AI Agent, 权限控制, Tool]
category: 源码调研
draft: false
---

> **结论先行：** 从工具可见性、风险策略、HITL、Sandbox、Tool Gateway 与 Verifier 的职责出发，分析为什么模型能够选择工具，不代表它已经获得执行授权。

![从 Tool Visibility 到可信执行边界](/images/posts/agentscope-trusted-execution.svg)

## 快速阅读

### 一、Tool Visibility 只决定模型可以看到什么

在系列第二篇中，AgentScope 的 ToolBase 已经展示了两个不同的信息平面：

### 六、Sandbox 与 Tool Gateway 解决不同风险

将所有 Tool 都放入同一个 Sandbox，并不能形成完整的安全边界。

### 结语

Agent 的工具安全不能由单个组件承担。

<details>
<summary>展开完整分析与实现依据</summary>

> 本文是「AgentScope 源码调研」系列第 9 篇，接着[上一篇](/posts/agentscope-sse-replay/)对执行与客户端连接的分析，讨论 Agent 获得工具能力之后，平台应如何建立可信执行边界。AgentScope 源码仍固定在提交 [`698297b`](https://github.com/agentscope-ai/agentscope/commit/698297b4c084e1c3954e35f06fa737a96a515275)；部署侧对照使用 Meta Agent 快照 `a250fe1`。

工具调用容易被简化为以下过程：

```text
Model 选择 Tool
→ Harness 执行
→ 返回 ToolResult
```

这个描述能够解释调用机制，却不足以回答生产系统中的安全问题：

- 模型为什么能够看到这个 Tool？
- 当前用户是否有权执行该动作？
- 高风险参数是否需要人工确认？
- 凭证应由谁持有？
- 执行结果由谁验证？

这些问题不能交给 Model 自己判断。更完整的执行路径需要把能力暴露、风险决策、动作执行和结果验证拆成相互独立的职责。

## 一、Tool Visibility 只决定模型可以看到什么

在[系列第二篇](/posts/agent-tools-execution-plane/)中，AgentScope 的 `ToolBase` 已经展示了两个不同的信息平面：

```python
class ToolBase:
    # 提供给 Model
    name: str
    description: str
    input_schema: dict[str, Any]

    # 提供给 Harness
    is_read_only: bool
    is_concurrency_safe: bool
    is_external_tool: bool
    dangerous_files: list[str]
    dangerous_directories: list[str]
```

Model 只需要知道候选能力的名称、用途和参数结构。并发控制、执行位置、风险判断与状态注入属于 Harness。

当前部署侧源码也明确区分了工具注册与模型可见性。`_ToolExclusionMiddleware` 会在模型请求发出前过滤工具：

```python
filtered = [
    tool
    for tool in request.tools
    if tool_name(tool) not in excluded_tools
]
request = request.override(tools=filtered)
```

这项机制能够做到：

- 不向当前 Model 暴露不适用的工具；
- 按 Harness Profile 调整不同模型的能力集合；
- 避免模型误选当前环境无法执行的工具。

但它不能构成最终授权。工具没有出现在模型上下文中，只能降低其被正常 ToolCall 选中的可能性；执行端仍需要防止伪造请求、旧任务重放、跨租户调用和参数越权。

因此需要区分：

| 层次 | 回答的问题 |
| --- | --- |
| Tool Registration | 平台具备哪些能力 |
| Tool Visibility | 本轮向 Model 暴露哪些能力 |
| Authorization | 当前调用者能否执行这项具体动作 |
| Execution | 动作由哪个可信组件实际完成 |

可见性是能力收窄，不是权限凭证。

## 二、Model、Policy、Executor 与 Verifier 不能合并

一次可信 Tool 调用至少包含四个角色。

### 1. Model：提出动作建议

Model 根据上下文选择 Tool，并生成业务参数。它可以表达：

```json
{
  "tool": "query_order",
  "arguments": {
    "order_id": "order-123"
  }
}
```

但 Model 输出属于不可信输入。它不能通过参数决定自己代表哪个用户、属于哪个租户，也不能把“订单已经查询成功”作为真实结果。

### 2. Policy：决定是否允许

Policy 根据 Tool 固有风险、动态参数、调用者身份、租户、环境、影响范围、可逆性、费用和外部通信等条件，输出明确决策：

```text
ALLOW
DENY
REQUIRE_APPROVAL
```

这一步必须是确定性的服务端逻辑，不能依赖 Model 对自身行为进行风险评分。

### 3. Executor：在受控边界内执行

Executor 重新校验参数与权限，并选择执行位置：

- 不可信代码、Shell 与文件操作进入 Sandbox；
- 订单、消息、数据库和训练平台等生产能力进入可信 Tool Gateway；
- Credential 在执行边界按需获取，不进入 Model 上下文。

### 4. Verifier：读取真实状态

Verifier 通过文件系统、测试结果、数据库记录或外部平台回执判断任务是否完成。

Model 可以说“文件已删除”，但文件是否存在仍应由文件系统确认；Model 可以说“任务已提交”，但真实状态仍应由任务平台返回。

这四个角色形成一条重要边界：

> Model 提议，Policy 授权，Executor 执行，Verifier 证明。

## 三、源码中已经存在 HITL 配置能力

部署侧快照已经为多类 Tool 定义了 `interrupt_on` 配置。核心结构可以简化为：

```python
def _add_interrupt_on():
    approve_or_reject = {
        "allowed_decisions": ["approve", "reject"],
    }

    return {
        "shell": approve_or_reject,
        "execute": approve_or_reject,
        "write_file": approve_or_reject,
        "edit_file": approve_or_reject,
        "web_search": approve_or_reject,
        "read_url": approve_or_reject,
        "task": approve_or_reject,
    }
```

实际配置还会为不同 Tool 生成审批描述，例如展示 Shell 命令、工作目录或远端 Sandbox 位置。

`create_deep_agent()` 接收 `interrupt_on` 后，会按条件加入 `HumanInTheLoopMiddleware`：

```python
if interrupt_on is not None:
    middleware.append(
        HumanInTheLoopMiddleware(interrupt_on=interrupt_on)
    )
```

这证明 Harness 已经具备将特定 ToolCall 转换为人工决策点的结构能力。它还能让主 Agent 与子 Agent 继承或覆盖不同的审批策略。

但“存在配置函数”与“当前服务已经启用审批”是两个不同结论。

## 四、当前主链明确关闭了高风险审批

当前 `create_cli_agent()` 没有调用 `_add_interrupt_on()`，而是明确设置：

```python
# Server/UI approval flow 尚未端到端接通
interrupt_on = {}

agent = create_deep_agent(
    ...,
    interrupt_on=interrupt_on,
)
```

对应测试也固定了这项部署状态：

```python
assert "interrupt_on = {}" in source
assert "wired end-to-end" in source
assert "interrupt_on = _add_interrupt_on()" not in source
```

这里还有一个容易忽略的细节：空字典不是 `None`，因此 `HumanInTheLoopMiddleware` 仍可能被装配，但其中没有任何 Tool 被配置为中断点。运行效果仍是高风险工具不触发审批。

因此，基于当前快照只能得出：

- 框架提供 HITL 中间件和 Tool 级审批配置；
- 部署代码保留了一份风险 Tool 映射；
- 主 Agent 的 Server/UI 审批链路尚未启用；
- 子 Agent 是否启用审批取决于其独立入口与 `auto_approve` 配置，不能用主链状态概括全部入口。

文章或架构评审中如果只看到 `_add_interrupt_on()` 就声称“系统已经具备高风险操作审批”，会把静态能力误写为运行事实。

## 五、HITL 不能替代基础权限校验

人工确认只回答：

> 是否允许执行这一次具体动作？

它不能自动证明审批人有权操作目标资源，也不能为缺失的租户隔离补充授权。

一条可持久化的 Approval 至少应该绑定：

```text
approval_id
tenant_id
user_id
session_id / turn_id
tool_call_id
tool_name
normalized_arguments
request_fingerprint
requested_at
expires_at
decision
decided_by
```

如果审批只记录“同意执行 `send_message`”，而没有绑定收件人、正文摘要和附件指纹，Model 就可能在审批前后改变参数，使用户批准的动作与最终执行的动作不一致。

执行前仍需完成两类检查：

1. **调用者校验**：`user_id`、`tenant_id`、角色与凭证必须来自 API Gateway 验证后的可信 Request Context，不能来自 Model 参数。
2. **资源级校验**：目标订单、文件、Message、Checkpoint、Workspace 或 Memory 是否属于当前调用者和租户。

Session ID 只能定位会话，不是访问该会话全部资源的权限凭证。

## 六、Sandbox 与 Tool Gateway 解决不同风险

将所有 Tool 都放入同一个 Sandbox，并不能形成完整的安全边界。

### Sandbox 适合承载不可信执行

典型对象包括：

- Shell 与用户代码；
- Workspace 文件处理；
- 依赖安装；
- 浏览器自动化；
- 来自外部的文件与网页内容。

Sandbox 通过文件、网络、进程、系统调用、CPU、Memory 和执行时间限制故障影响范围。它的核心目标是限制不可信执行环境能够影响什么。

### Tool Gateway 适合承载可信业务能力

典型对象包括：

- 查询或修改订单；
- 发送消息和邮件；
- 访问数据库；
- 提交训练任务；
- 调用内部平台与云服务。

这些动作需要可信身份、生产凭证、资源级鉴权、结果脱敏和审计。把完整数据库密码或管理员 Token 交给 Sandbox，会让隔离环境同时拥有不可信代码和高价值凭证，破坏隔离本身的意义。

更合理的路径是：

```text
Model 只提供业务参数
→ Tool Gateway 读取可信 Request Context
→ 重新鉴权并获取短期最小权限凭证
→ 调用业务系统
→ 过滤结果后返回
```

代码执行依赖 Sandbox，生产业务调用依赖 Tool Gateway；最高风险动作再增加 HITL。

## 七、保护凭证还不够，还要限制数据出口

Credential 没有进入 Model 上下文，不代表数据不会泄露。

如果 Tool 允许 Model 执行任意 SQL，再把完整结果返回上下文，系统仍然可能暴露超出任务需要的数据。安全 Tool 应从接口设计开始收窄能力：

```text
query_database(sql)
```

更适合改为：

```text
get_order_status(order_id)
```

执行端再完成：

- 行级和资源级权限检查；
- 最少字段选择；
- 敏感字段脱敏；
- 返回大小限制；
- 数据分类与审计。

对于特别敏感的数据，可以只返回结果引用，由后续可信服务直接消费，避免原始内容进入 Model 上下文。

读取权限和发送权限也必须分离。Agent 能够读取 Workspace 或内部系统，不代表它能够把数据发送到任意域名、邮箱或消息渠道。邮件、上传和外部 HTTP 应成为独立的受控出口，再次核验目标、数据分类和用户意图。

## 八、Tool 粒度决定哪些步骤可以被绕过

复杂业务动作可以拆成多个面向 Model 的 Tool，但不能把强制安全步骤拆成可选 Tool。

例如，不应设计为：

```text
check_permission(resource)
get_secret()
call_internal_api(payload)
write_audit_log()
```

Model 可能跳过其中任意一步。

更合理的接口是：

```text
submit_training_job(project_id, config)
```

Tool Gateway 内部固定执行：

```text
身份校验
→ 项目权限检查
→ 参数边界检查
→ 获取短期凭证
→ 提交任务
→ 过滤回执
→ 写审计日志
```

需要 Model 判断的业务步骤可以拆开；鉴权、参数边界、凭证保护、脱敏与审计等不可跳过的步骤必须留在一个可信执行边界内。

## 九、如果由我推进当前审批链路

我不会直接将 `_add_interrupt_on()` 接回主 Agent。配置函数存在，只能证明中间件入口已经准备，不能证明端到端恢复语义成立。

我会按以下顺序推进。

### 1. 先建立持久化 Approval

审批请求必须脱离单个进程保存，并与 ToolCall、参数指纹、Thread、Turn、调用者和租户绑定。服务重启或 Worker 切换后，新的 Owner 能够读取同一条决定。

### 2. 再完成消费权控制

审批结果只能被当前合法 Owner 消费一次。旧 Worker 即使恢复运行，也应因 Lease、Fence 或条件更新失败而无法继续执行。

### 3. 然后接通 Server 与 UI

UI 展示的动作摘要必须来自服务端规范化参数，批准后提交 `approval_id` 与决定，不允许客户端改写原 ToolCall。

### 4. 最后分级启用

先选择参数稳定、结果可验证且影响范围有限的 Tool；再逐步覆盖外发、写入和费用相关动作。Shell、任意文件写入等开放能力还需要 Sandbox、目录权限和网络出口策略共同约束，不能只依赖确认对话框。

当这些条件尚未满足时，保持空策略比启用一条无法恢复、无法审计或可能重复消费的审批链路更准确。

## 结语

Agent 的工具安全不能由单个组件承担。

Tool Visibility 收窄 Model 的候选能力，Policy 判断具体动作是否允许，HITL 为高风险动作提供外部决定，Sandbox 限制不可信代码，Tool Gateway 保护生产凭证与业务权限，Verifier 再依据真实状态确认结果。

这些职责共同形成一条可信执行链：

```text
Model 提议
→ Policy 授权
→ Executor 执行
→ Verifier 证明
```

其中任何一步缺失，都会让“模型能够调用工具”被错误解释为“系统已经安全地完成动作”。源码调研的价值正在于把静态接口、当前部署状态和面向生产的工程要求分别确认，而不是从一个配置项推导整套能力已经成立。

</details>
