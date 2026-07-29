---
title: Agent 工程（十四）：工具、执行面，与几个只有读源码才会发现的细节
published: 2026-07-29
description: input_schema 从头到尾没被用于校验；执行面只有三个原语；沙箱里的网关只绑回环地址；上下文压缩的切分点要靠不动点循环修出来。接着上一篇继续读源码。
tags: [AI Agent, AI Infra, 架构, 学习笔记]
category: 学习笔记
---

> 本文是「Agent 工程」系列第 14 篇，接着[上一篇](/posts/agent-serverside-anatomy/)继续读 [AgentScope](https://github.com/agentscope-ai/agentscope) 的源码。上一篇讲服务层怎么驱动会话，这一篇讲工具体系与执行面——**这部分细节多，所以尽量把代码摆出来**，很多结论光看描述是不成立的。

## 一、工具的字段：三个给模型，其余全给 harness

```python
class ToolBase(ABC):
    name: str                      # ✅ 发给模型
    description: str               # ✅ 发给模型
    input_schema: dict[str, Any]   # ✅ 发给模型
    # ───── 以下模型不可见，供 harness 决策 ─────
    is_concurrency_safe: bool      # 多个调用能否并行执行
    is_read_only: bool             # 是否走只读快速放行，跳过权限确认
    is_external_tool: bool = False # schema-only：挂起循环交外部执行
    is_state_injected: bool = False# 调用时是否注入 agent state
    is_mcp: bool = False
    mcp_name: str | None = None    # 权限规则匹配时的归类依据
    dangerous_files: list[str] = DEFAULT_DANGEROUS_FILES
    dangerous_directories: list[str] = DEFAULT_DANGEROUS_DIRECTORIES
```

**字段数量对应 harness 的决策点数量。** 每当循环需要对一个工具做一次判断——能否并行、要不要弹确认、在哪执行、是否注入状态、权限怎么归类——就需要工具提供一个对应的声明。

这正是[第二篇](/posts/agent-tool-boundary/)那个结论的实物：**工具面设计不是在优化模型的理解，而是在为自己的 harness 预留钩子。** 这里可以直接数出来——**给模型的只有三项，给 harness 的有八项。**

## 二、input_schema 是说明书，不是校验器

这一条不看代码根本不会相信。工具调用的实际执行路径是：

```python
kwargs = _json_loads_with_repair(tool_call.input)   # 解析模型输出的 JSON，带修复
if tool.is_state_injected:
    kwargs["_agent_state"] = state
res = await tool_func(**kwargs)                     # 直接展开调用
```

而工具的参数模型是这样定义的：

```python
class _TeamSayParams(ParamsBase):        # 继承自 pydantic BaseModel
    content: str = Field(description="The message text. ...")
    to: str | None = Field(default=None, description="Recipient member name. ...")

class TeamSay(_TeamToolBase):
    input_schema: dict = _TeamSayParams.model_json_schema()   # ★ 只用来生成 schema
```

**这个 pydantic 模型只被调用了 `model_json_schema()`，从未被调用 `model_validate()`。**

也就是说：它的全部作用是**生成一份发给模型的说明书**，而参数的合法性由 Python 函数签名兜底——参数名对不上就抛 `TypeError`，被捕获后转成一条错误的工具结果交还模型。

顺带，`_json_loads_with_repair` 这个函数名本身就是一项事实说明：**模型输出的 JSON 经常不合法，需要专门的修复逻辑，而不是直接 `json.loads`。**

## 三、模型决定调用哪个，服务决定它在哪执行

工具分两类，执行位置完全不同：

| 工具 | 执行位置 | 怎么执行 |
|---|---|---|
| `bash` / `read` / `write` / `edit` / `grep` / `glob` | **沙箱 Pod 内** | 服务通过 exec / 读写文件通道进入 Pod |
| `TeamSay` / `AgentCreate` / `Schedule*` | **服务进程内** | 直接调用存储与消息总线 |

后者的构造参数直接暴露了这一点：

```python
def __init__(
    self,
    storage: "StorageBase",              # ← 服务进程内的对象
    message_bus: "MessageBus",           # ← 服务进程内的对象
    workspace_manager: "WorkspaceManagerBase",
    user_id: str, session_id: str, agent_id: str,
) -> None:
```

**模型对此完全无感知**——它只看到名字、描述、参数结构，以及最终返回的结果。

还有一个值得注意的结构性事实：**Pod 从不反向调用服务**（全仓检索不到 callback、server_url 一类构造）。所以团队类工具能直接访问数据库，而**Pod 不需要具备任何网络可达性**。这一点是下面第五节的前提。

## 四、执行面只有三个原语

```python
@abstractmethod
async def exec_shell(...)
@abstractmethod
async def read_file(self, path: str) -> bytes
@abstractmethod
async def write_file(self, path: str, data: bytes) -> None
```

就这三个。而这三个必须**同时**实现，这是个有实际后果的约束：

**对象存储不能作为执行面后端**——它能实现读文件和写文件，但实现不了执行命令。而工作区的定位是"可读写文件**且**可执行命令"的位置，缺一不成立。

还有一层更根本的原因：**模型执行 `python main.py` 时，这条命令读的是执行机器的本地磁盘，不会向服务请求文件。文件必须实际存在于执行侧。**

在这三个原语之上，它接了八种后端：

```text
_local_workspace.py     本机目录
_docker/                Docker 容器
_k8s/                   Kubernetes Pod
_e2b/                   E2B 云沙箱
_daytona/               Daytona
_opensandbox/           OpenSandbox
_bubblewrap/            bubblewrap（本地轻量隔离）
_applecontainer/        Apple Container
```

**没有一个隔离引擎是自研的。** 这个模块的定位就是执行面的统一门面：同一套文件与执行语义，可以指向本机目录、容器、Pod 或云沙箱，**agent 定义无需改动即可切换隔离策略**。

这与[沙箱番外篇](/posts/agent-runtime-sandbox/)的结论完全一致——**引擎在商品化，价值在 facade 层**。这里是这个判断的一个现成实例：八个后端、一套接口、三个原语。

### K8s 后端：Pod 一次性，卷不是

```text
* Lifecycle. initialize() looks up an existing Pod by label, reuses it if
  Running, deletes-and-recreates if Failed/Unknown, or creates a new one.
  PVCs survive Pod deletion for data persistence.

* Persistence. A PVC (as-ws-{workspace_id}) mounted at /workspace provides
  cross-Pod-restart persistence. Skills, .mcp, sessions, and data survive
  restarts.
```

**整套机制里唯一的技巧点是：`workspace_id` 由确定性哈希算出，而不是随机生成。**

```python
def assign_workspace_id(self, *, user_id, agent_id, session_id) -> str:
    """Mint a workspace id under _isolation. Pure function — no I/O.

    * PER_SESSION → fresh UUID.
    * PER_AGENT   → deterministic BLAKE2b of ``user::agent``.
    * PER_USER    → deterministic BLAKE2b of ``user::``.
    """
    del session_id    # ★ PER_AGENT 下 session_id 被显式丢弃
```

因为是确定性的，**新 Pod 必然定位到同一个卷**。所以恢复过程**不需要下载任何文件**——新 Pod 挂上卷，文件就已经在磁盘上了，`ls` 即可见。

注意最后那行 `del session_id`：默认策略是按 agent 隔离，所以**同一个 agent 的多个会话共用一个工作区**。这行显式的丢弃是在声明"这个参数在此策略下故意不用"。

## 五、沙箱内的网关只绑回环地址

这是我认为整篇最值得学的一处设计。

沙箱里跑着一个常驻的网关进程（用于 MCP 调用），但它**只监听 `127.0.0.1`，宿主机没有任何网络途径能访问它**。那怎么调用？**复用 exec 通道**：

```text
Flow: host spawns ``python3 -c <SHIM_SCRIPT> ...`` via exec_shell; the
shim calls the gateway's loopback port using urllib.request and emits
one JSON envelope on stdout.

The gateway listens only on the sandbox's loopback; the host has no
network reachability to it. The shim relies on python3 (which the
gateway venv already needs) rather than curl because we cannot assume
curl on every backend image.
```

对比一下两种选择的代价：

```text
绑 0.0.0.0：
  需要为 Pod 开放端口 / 建 Service
  需要保证网络可达（网络策略放行、跨命名空间打通）
  需要为该端口单独设计鉴权（否则同集群任意方可调用）

绑 127.0.0.1：
  Pod 可配置为零入站、零出站
  复用既有的 exec 通道，无需第二套鉴权
  代价：每次调用启动一个 Python 解释器（数十毫秒）
```

**为什么这样能成立？因为 exec 与网络访问是两条不同的通道。** exec 走 API Server → kubelet → 在 Pod 的命名空间内 fork 一个进程，**不经过 Pod 的网络接口**；而网络策略管辖的是进出网络命名空间的流量，**管不到 exec**。所以对 Pod 施加"拒绝一切入站与出站"的网络策略之后，工具调用仍然正常工作。

回环地址的隔离性也来自命名空间：**每个网络命名空间有独立的 `lo`、网卡、路由表、端口空间。宿主和 Pod 的 `127.0.0.1` 是两个不同的接口**——宿主能访问 Pod 的 `eth0`（节点上有路由），但访问不到 Pod 的 `lo`。

**代价是攻击面转移**：拿到 exec 权限就能在 Pod 内执行任意命令，这个权限要靠 RBAC 管，而不是网络策略。

这是[第九篇](/posts/agent-prompt-injection/)那个思路的另一种形态：**用能力约束替代路径约束**——不去论证"谁可以访问这个端口"，而是干脆让这个端口在网络上不存在。

## 六、用文件修改时间做乐观并发

编辑文件时怎么防止"模型读到的版本已经被别人改了"？它的做法是拿 mtime 当版本号：

```python
async def get_cache(self, file_path: str) -> ReadCacheEntry | None:
    for entry in self.read_file_cache:
        if entry.file_path == file_path:
            updated_at = await aiofiles.os.path.getmtime(file_path)
            if updated_at == entry.updated_at:
                return entry          # mtime 未变，缓存有效
            else:
                self.read_file_cache.remove(entry)
                return None           # ★ mtime 已变，缓存作废
    return None
```

```python
cache = await _agent_state.tool_context.get_cache(file_path)
if cache is None:
    return ToolChunk(
        content=[TextBlock(
            text="Error: To edit a file, you must first read "
                 "it using the Read tool.",
        )],
        state=ToolResultState.ERROR, is_last=True,
    )
content = "".join(cache.lines)      # ★ 用缓存内容做替换，不重新读盘
```

对应关系很清楚：

| 版本号 CAS | 这里的实现 |
|---|---|
| version | **mtime** |
| 读取时记录版本 | Read 时记录 mtime |
| 写入时比对 | Edit 时比对 |
| 不一致则失败 | 不一致则缓存作废，返回"必须先 Read" |

**注意最后一行：它用缓存内容而不是重新读盘。** 这是必需的——模型给出的"要替换的原文"是依据 Read 返回的内容选的；如果 Edit 时重新读盘，文件已变则那段字符串可能匹配到别的位置或匹配多处，**产生错误修改而模型无从察觉**。所以两项措施缺一不可：**缓存内容保证改的是"看到的那一版"，mtime 比对保证那一版没被别人动过。**

但这个方案的边界也要说清楚：

- **存在检查与写入之间的空隙**——检查完成到实际写入之间，文件仍可能被改。真正的 CAS 没有这个空隙（比较与写入是单一原子操作），mtime 方案有。
- **绕不过 bash**——`sed -i`、输出重定向都不经过 Edit 工具，完全不受约束。
- **不覆盖依赖冲突**——两个会话同时装冲突版本的包，检测不到。

**它可接受的原因是失败后果不对称**：误拦（mtime 变了但没有实质修改）的代价只是模型多读一次；漏拦（mtime 没变但文件已变）才会丢数据，而那要求两次写入落在同一个时间刻度内。

**为什么不用真正的版本号？** 因为文件系统没有存版本号的地方——要么另建一张表，要么写 `.meta` 文件，而那张表与文件本身又构成新的一致性问题。**mtime 是文件系统免费提供、每次写入必变的值。**

## 七、上下文压缩：切分点要靠不动点循环修

最后一个细节，是[第五篇](/posts/agent-context-engineering/)讲压缩时没展开的那部分：**切在哪。**

先按 token 预算倒着找一个位置：

```python
msg_index = len(self.state.context) - 1
while msg_index >= 0:
    reserved_tokens = await self.model.count_tokens(
        system_msg + self.state.context[msg_index:], tools)
    if reserved_tokens >= to_reserved_tokens:
        break
    msg_index -= 1
```

但这个位置**多半是不能直接用的**，因为它可能把一对工具调用与结果劈开：

```python
# Adjust the block_index to avoid splitting tool call and result pairs.
# Moving the boundary can bring another tool call into the compressed
# part while leaving its result reserved, so repeat until it is stable.
while True:
    remain_result_ids = {}
    for i in range(len(boundary_msg_content) - 1, block_index, -1):
        block = boundary_msg_content[i]
        if isinstance(block, ToolResultBlock):
            remain_result_ids[block.id] = i
        elif isinstance(block, ToolCallBlock):
            remain_result_ids.pop(block.id, None)
    if not remain_result_ids:      # 保留区内所有结果均已配对
        break
    block_index = max(remain_result_ids.values())  # 把落单的移入压缩区后重查
```

**要解决的问题是：保留区里不允许出现"有结果但没有对应调用"的情况**，那样的上下文发给模型会直接失败。而注释解释了为什么必须循环而不是调整一次——**每移动一次边界都可能拆散另一对，得反复调整到稳定为止。**

另外注意切分粒度：**是 block 而不是 message**——同一条消息内部可以被切开，一部分压缩、一部分保留。

压缩的职责划分也很清楚：

| 决定 | 由谁决定 |
|---|---|
| 是否压缩 | 代码：token 超过阈值比例 |
| 从哪切 | 代码：预算倒推 + 上面那个不动点修复 |
| **保留哪些内容** | **模型**：自行填写摘要 schema 的五个字段 |
| 被丢弃的内容去哪 | 代码：写入会话目录下的 `context.jsonl`（**全量原文**） |

**第四层的存在是为了兜住第三层的判断误差**——模型压缩时依据当时的理解填那五个字段，而之后才需要的细节可能已被判为不重要。原文留在磁盘上，模型可以用文件工具按需检索。

这正好是[第五篇](/posts/agent-context-engineering/)那对 push 与 pull 的组合：**上下文里放的是压缩时的判断结果（push），磁盘上留的是完整原文供后续按需取用（pull）。**

---

两篇读下来，最想留的一句话是：**这些机制没有一个是"AI 特有"的**——分布式锁、乐观并发、消息队列、门面模式、不动点迭代，全是分布式系统与工程实践里的老东西。

Agent 系统的新意不在于发明了新机制，而在于**它把一批老问题重新摆到了一起**：一个会跑几分钟、随时可能停下等人、状态必须跨进程存活、还要在不可信环境里执行任意代码的东西——每一条单独都不新，凑在一起就需要重新做一遍设计取舍。
