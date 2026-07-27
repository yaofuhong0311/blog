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
		],
	},
];
