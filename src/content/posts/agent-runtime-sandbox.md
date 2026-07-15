---
title: 沙箱系列（番外）：Agent Runtime 落地——引擎选型、会话持久化与 Facade
published: 2026-07-20
description: 沙箱系列讲完了机制，这一篇讲工程落地：怎么选引擎、会话如何跨崩溃存活、E2B 与 Vercel Eve 各自的答案，以及为什么最终收敛到一个 Facade。
tags: [沙箱, AI Agent, AI Infra, 学习笔记]
category: 学习笔记
---

> [沙箱系列](/posts/sandbox-deep-dive/)五篇讲的是机制：隔离、缺页、逃逸、编排。这一篇是番外，视角换到工程决策——假设你要搭一个"让 Agent 在沙箱里跑起来"的服务，引擎怎么选、会话如何跨崩溃存活、哪些现成方案可以借鉴。内容来自一次围绕 E2B、CubeSandbox、OpenSandbox 与 Vercel Eve 的调研。

先给结论：**沙箱引擎已经是高度商品化的基础设施，差异化价值在其上层的 Agent Runtime。** 正确的建设目标不是自建引擎，而是把多个 Runtime 收敛为一个统一接口（Facade），并把"会话持久化"与"操作系统/存储底层"这两件事做正确——网络层不构成难点。下面把这个结论一步步推出来。

## 一、先把 Agent 拆到底

大语言模型是无记忆的纯函数：输入一段文本，输出一段文本。一次模型请求只有三个部分：

- **system**：身份、规则、工具用法、环境信息
- **messages**：历史对话 + 工具结果 + 本轮输入
- **tools**：模型可调用的函数清单（结构化 schema）

"Agent 在自主工作"的观感，由外层程序（Harness）编排实现：读取模型输出的工具调用意图 → 实际执行 → 结果写回 messages → 再次请求模型，循环至模型不再请求工具。所有"扩展 Agent"的手段，本质都是改这三段之一，或在循环的关节处插入逻辑（Hook）。

由此，任何编码 Agent 拆解到底都是"无状态 SDK + 有状态的循环封装"。而 Harness 这一层——工具的真实实现、System Prompt 与上下文工程、压缩、安全、循环控制——承载了绝大部分工程价值。用现成 Runtime（如 Claude Code）等于直接复用厂商调优好的这一层；基于裸 SDK 自己写，则要把这一层全部重建一遍。

## 二、会话持久化的三条路线

让会话跨轮次、跨进程崩溃存活，业界有三种策略：

| 路线 | 机制 | 优势 | 代价 |
|-|-|-|-|
| 常驻 Daemon | 进程常驻，上下文留在内存 | 下一轮响应快 | 占资源；崩溃即丢；不跨节点 |
| microVM 快照（E2B 路线） | 序列化整台机器（文件系统 + 内存） | 黑盒负载也适用，无需改代码 | 体量重，内存文件可达 GB 级 |
| Durable Execution（Eve 路线） | 状态外置到事件日志，沙箱可丢弃 | 规模化成本最低，可跨部署 | 需 Runtime 配合，黑盒 Runtime 用不了 |

一个容易误解的点：**resume 的本质是"把 messages 落盘后再加载"**。内存 Daemon 是它前面的缓存，不是替代——内存易失，仍需磁盘或云端作为可信副本。对黑盒 Runtime（比如一个 claude 二进制，无法修改其内部实现），Durable Execution 不适用，只能依赖快照或它自带的 resume 机制。

## 三、引擎选型：门槛与隔离是两个反向相关的维度

三个候选引擎的对照：

| 维度 | E2B | CubeSandbox | OpenSandbox |
|-|-|-|-|
| 形态 | Firecracker microVM | RustVMM / PVM microVM | K8s 容器 |
| 硬件门槛 | 需 /dev/kvm | PVM 模式免 /dev/kvm，但需更换宿主内核 | 最低，任意节点 |
| 隔离强度 | 最强 | 强（中位） | 最弱（共享宿主内核） |
| 成熟度 | 成熟，事实标准 SDK | 较新，性能数据为厂商自述 | 阿里出品，K8s 原生；持久卷尚在 roadmap |

规律是：**部署门槛越低，隔离强度通常越弱**。OpenSandbox 在任意节点即可运行，代价是共享宿主内核（[系列第三篇](/posts/sandbox-escape/)讲过这意味着什么）；E2B 隔离最强，代价是要求硬件虚拟化能力。CubeSandbox 的价值不是单纯"门槛更低"，而是**在保留 microVM 级独立内核的同时降低了硬件门槛**——用软件页表（PVM）换掉了对 /dev/kvm 的依赖，在这两个维度之间取得了折中最优点。

怎么选取决于负载性质：多租户、跑真正不可信代码，选强隔离；只跑自有可信任务，容器更快且足够。

## 四、沙箱的核心是 OS 和存储，不是网络

把 Agent 循环拆成六个动作，逐个看它碰到什么底层资源：

| 动作 | OS 依赖 | 存储依赖 |
|-|-|-|
| 组装三段 + 调用模型 | 几乎无 | 无（一次出站 HTTPS） |
| **工具执行**（跑命令/读写文件） | **进程创建 + 隔离** | **文件系统读写** |
| **状态持久化** | — | **落盘 / 快照 / 挂载** |
| Daemon 保活 | **进程模型** | — |
| 模板快速启动 | — | **文件系统 + 内存快照** |
| Prompt Cache | 无 | 无（在厂商侧显存） |

模型调用只需要一次出站 HTTPS，任何沙箱默认放行。真正迫使你做底层决策的只有"工具执行"和"状态持久化"，二者天然是操作系统与存储问题。几个落地时真实会碰到的坑：

- **进程模型差异**：microVM 里有真正的 init，常驻服务被正常托管；纯 Pod 容器通常以 `sleep infinity` 作为主进程、没有 systemd，常驻 Daemon 只能 `setsid` 启动并自行回收孤儿进程。
- **写时复制粒度**：E2B 用 OverlayFS，文件级 CoW（首次写入复制整个文件）；Cube 用 XFS reflink，块级 CoW（只复制被改的块）。这是[系列第二篇](/posts/sandbox-page-fault/)里机制的现实版本。
- **个性化挂载与预热池冲突**：预热池靠同质快照去重；给单个沙箱注入特定挂载点会破坏同质性，只能走慢速冷构建。
- **WAL-on-NFS 会 SIGBUS**：SQLite WAL 的共享内存文件依赖 mmap，NFS 提供不了可靠的 mmap 语义。状态库应放在沙箱本地可写层，而非网络卷。

## 五、E2B：八个 Agent 的依赖谱

E2B 官方提供了八个 Agent 的沙箱集成（Claude Code、Codex、Devin、Amp 等）。逐个分析它们对沙箱底层的需求，会得到一条由轻到重的谱：

![不同 Agent 对沙箱底层的依赖谱](/images/posts/agent-sandbox-dependency.svg)

这条谱的直接工程含义：**要支持到哪一端，就要把沙箱底层建到哪一层。** 只接 OpenAI Agents SDK，一个无状态执行端就够；要接 Managed Agents 这类，就得把常驻进程、持久会话目录、路由状态全部建齐。

两个容易误判的细节：

- **持有 E2B API Key 不等于能用所有 Agent。** E2B Key 提供的是沙箱执行环境的使用权（它的 microVM 云），不含模型调用；每个 Agent 还要各自的 Provider Key（Claude Code 要 ANTHROPIC_API_KEY，Codex 要 OpenAI Key），两者分开计费。
- **续接对话的机制殊途同归**——都是"把上一轮历史重新装入 messages"，只是入口不同（`--resume`、`threads continue`、对同一 session 反复发送）。前提是会话状态还在：状态存在沙箱文件里的，沙箱销毁即无法续接；状态在云端的（Amp、Managed Agents）不受沙箱生命周期影响。

## 六、Vercel Eve：方向相反的思路

Eve 是一个"以文件系统为先"的开源 Agent 框架，自我定位是"面向 Agent 的 Next.js"：目录约定即配置——instructions.md 对应 system、tools 目录自动发现、skills 按需加载。

它最有意思的地方是存储逻辑与 E2B **完全相反**：会话状态外置到 Workflow SDK（Durable Execution，逐步 checkpoint），沙箱作为可丢弃的算力。E2B 通过快照整台机器来保全状态，Eve 让状态根本不落在沙箱内。

对自建沙箱集群的人，Eve 的可复用边界很清晰：文件约定的开发体验值得借鉴（且无专有技术，本质与 `.claude` / `AGENTS.md` 是同一机制，建议直接采用已成事实标准的后者）；但它的 Serverless 执行模型绑定 Vercel Functions，Durable Execution 引擎也需要自行引入 Workflow SDK 或 Temporal 并接入自己的沙箱生命周期。

## 七、收敛：Facade，且单引擎不做抽象

把前面全部串起来，架构结论自然浮现：

**Facade** = N 个 Adapter（每个 Runtime 一个翻译器）+ 一个统一的请求/响应契约 + 一个分发器。调用方只面对单一接口，Runtime 之间的差异（依赖谱上的位置差异）在 Adapter 内部消化。

还有一个反直觉的减法：**引擎一旦选定且不打算更换，就不需要引擎抽象层。**"协议学 E2B、Provider 可插拔"听起来稳健，但在单引擎前提下是多余的脚手架——把引擎相关调用收敛到单一模块（这是代码组织，不是架构层），迁移成本已经可控。唯一会迫使引入第二个引擎的场景：同时需要 GPU 机器学习（要容器/K8s，microVM 无法挂载显卡，见[系列第五篇](/posts/sandbox-wasm-ebpf-gpu/)）与高频 microVM 代码执行。负载不跨越这条分界，单引擎就是正解。

这也呼应了系列第一篇的判断：引擎在商品化，长期价值在 facade 层。这次调研等于把那个判断从"观点"落成了"施工图"。
