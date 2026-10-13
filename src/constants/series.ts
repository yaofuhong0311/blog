// 系列定义：按阅读顺序列出 slug。新增文章时在对应系列追加一行即可。
// 只在这里维护顺序，标题与摘要从文章 frontmatter 自动取。

export interface SeriesDef {
	slug: string;
	title: string;
	description: string;
	posts: string[];
}

export const seriesList: SeriesDef[] = [
	{
		slug: "sandbox",
		title: "沙箱底层机制",
		description:
			"一轮源码级的沙箱引擎调研沉淀。从隔离、缺页、逃逸讲到资源、存储、镜像、网络、调度，最后收敛到一个判断：七个选型角度其实是「共享不共享内核」这一个决策的七个投影。",
		posts: [
			"sandbox-deep-dive",
			"sandbox-page-fault",
			"sandbox-escape",
			"sandbox-declarative-k8s",
			"sandbox-wasm-ebpf-gpu",
			"agent-runtime-sandbox",
			"sandbox-resource-model",
			"sandbox-storage-warmpool",
			"sandbox-image-layering",
			"sandbox-network-egress",
			"sandbox-scheduling-observability",
			"sandbox-one-decision",
			"sandbox-agentenv-case",
			"sandbox-cow-fork",
		],
	},
	{
		slug: "agent",
		title: "Agent 工程",
		description:
			"怎么设计一个 agent 服务。从 loop 内部机制、工具边界、状态持久化，讲到上下文工程、评估、安全、规划模式、可观测与记忆分层。贯穿全系列的判据只有一条：模型只能看到本次请求塞给它的内容，其余必然在 harness。",
		posts: [
			"agent-loop-harness",
			"agent-tool-boundary",
			"agent-checkpoint-chain",
			"agent-checkpoint-storage",
			"agent-context-engineering",
			"agent-prompt-cache",
			"agent-reliability",
			"agent-evaluation",
			"agent-prompt-injection",
			"agent-planning-patterns",
			"agent-observability",
			"agent-memory-layers",
			"agent-architecture-evaluation",
			"agent-harness-logical-architecture",
			"agent-run-versioned-recovery",
			"agent-distributed-ordering-tokens",
		],
	},
	{
		slug: "agentscope",
		title: "AgentScope 源码调研",
		description:
			"沿着 AgentScope 源码分析服务端会话、工具执行与模型协议适配等关键模块，关注实现证据、职责边界，以及可以迁移到其他 Agent 系统的工程判断。",
		posts: [
			"agent-serverside-anatomy",
			"agent-tools-execution-plane",
			"agentscope-formatter-boundary",
			"agentscope-session-recovery",
			"agentscope-event-reducer",
			"agentscope-storage-boundary",
			"agentscope-runtime-ownership",
			"agentscope-sse-replay",
			"agentscope-trusted-execution",
			"agentscope-memory-lifecycle",
			"agentscope-memory-trust-policy",
			"agentscope-memory-retrieval-boundary",
		],
	},
	{
		slug: "agent-sandbox-engineering",
		title: "Agent Sandbox 工程实践",
		description:
			"从状态收敛、动作恢复、隔离选型与冷启动优化出发，分析 Agent Sandbox 控制面如何把底层机制组织成可恢复、可运营的平台能力。",
		posts: [
			"agent-sandbox-reconcile",
			"agent-sandbox-create-path",
			"agent-sandbox-observability-slo",
			"agent-sandbox-command-cleanup",
			"agent-sandbox-file-consistency",
		],
	},,
	{
		slug: "ai-collaboration",
		title: "和 AI 协作",
		description:
			"怎么指挥 AI 干活。统计下来，我的任务指令几乎不描述「要做什么」，而是描述「不许怎么做」——九条评审以「你对开发过程一无所知」开场，七条禁止读实现代码。贯穿全系列的判断是：刻意制造信息缺口能换到更真的结论，前提是每条禁令都配一份补偿。",
		posts: [
			"numbered-questions-as-checklist",
			"review-context-isolation",
			"contract-first-blackbox-testing",
			"subagent-prompt-is-a-contract",
			"adversarial-verification",
			"adversarial-review-value-is-in-refutation",
			"grep-proves-less-than-you-think",
			"readability-needs-a-cold-reader",
			"empty-diff-is-the-only-proof",
			"time-ledger-not-resource-shortage",
		],
	},
	{
		slug: "evidence-and-judgment",
		title: "实测与判据",
		description:
			"一个数字能不能用来做决定。先量机器自己抖多少，再看样本量和适用边界——同一份报告里 21% 能当结论，3% 只能写「没测出差异」。另一半是「决定不做」：技术上做得到，实测之后判定不做，并写清理由。",
		posts: [
			"difference-below-noise-is-not-a-result",
			"benchmark-denominator-premise",
			"configuration-slow-vs-structural-slow",
			"green-tests-prove-test-design-not-system-health",
			"tests-must-reach-the-code",
			"sandbox-fast-path-declined",
			"kubernetes-has-no-pause",
			"shared-gpu-saves-the-burst-buffer",
		],
	},
	{
		slug: "troubleshooting-evidence",
		title: "排障举证",
		description:
			"交付物是根因，不是补丁。环境问题和代码问题落到现象上常常是同一句话，分开它们靠的是时间线对不对得上、对照组差几个变量、以及那条证据到底排除了什么。最弱的一档是「日志里没有」，它什么都证明不了。",
		posts: [
			"silent-failure-prefer-explicit-reject",
			"kubelet-image-pull-cancellation",
			"pod-deleted-image-still-pulling",
			"byte-length-locates-the-throw-site",
			"timeline-rules-out-the-environment",
			"liveness-timeout-is-not-process-death",
			"select-1024-is-a-bitmap-width",
			"no-healthy-upstream-not-probe-timing",
			"silent-fallback-46-bad-sandboxes",
			"masking-hides-plaintext-not-credentials",
			"network-isolation-zero-rules",
		],
	},
	{
		slug: "service-design",
		title: "服务设计",
		description:
			"一个平台服务该留什么、不该留什么。判据是「绕过它会不会失效」——砍掉六成代码之后只剩五件事：认人、翻译、排队、防重复、转发。其余是这五件事各自的坑：幂等键要带租户、进程内状态锁死副本数、契约里的「做不到」只能有一个出处。",
		posts: [
			"service-keeps-what-cannot-be-bypassed",
			"admission-is-waiting-not-rejection",
			"idempotency-key-needs-a-tenant",
			"in-process-state-locks-replicas",
			"capability-matrix-as-code",
			"cancel-is-not-reclaim",
			"client-abort-not-server-rollback",
			"long-command-submit-then-poll",
			"dead-sandbox-ip-reused",
			"one-decision-many-copies",
			"healthz-should-not-check-dependencies",
			"poll-interval-from-shortest-lifetime",
			"gvisor-limits-not-enforced",
		],
	},
];
