# Blog Argument Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite all 44 technical posts so each article has one explicit question, one defensible judgment, a coherent evidence chain, and a stated boundary.

**Architecture:** Treat each Markdown article as an independent editorial unit and select its argument structure from four content types: source research, engineering practice, learning/system notes, or tools/workflows. Rewrite one representative article per group first, then process the remaining files one by one, deleting material that does not support the central judgment and committing every article separately.

**Tech Stack:** Astro content collections, Markdown, pnpm, Biome, Astro Check, Pagefind

**Spec:** `docs/superpowers/specs/2026-08-19-blog-argument-logic-design.md`

## Global Constraints

- Each article retains exactly one central judgment.
- Title, `description`, opening, body, and conclusion answer the same question.
- The opening states the problem, judgment, and reading value without repeating them in a second summary block.
- “快速阅读” contains at most three independently defensible judgments and never repeats the section index.
- Adjacent sections must have a causal, progressive, comparative, or evidence-to-choice relationship.
- Delete repeated definitions, repeated conclusions, process notes, and tangents.
- `<details>` may contain source paths, configuration, complete tables, or boundary enumerations, but never the main argument.
- Personal judgments state evidence, cost, and the condition that would change the choice.
- Preserve factual sources, valid images, internal links, and formal Chinese terminology.
- `src/content/posts/hello-world.md` remains unchanged because it is a short site introduction rather than a technical article.
- Work on `content/agent-architecture-evaluation`; preserve one article per commit and do not squash.

## Per-Article Review Contract

For every article listed below, execute all five actions before moving to the next file:

1. Write one sentence outside the article that completes: “本文要回答___，核心判断是___。”
2. Rewrite the visible argument using the structure assigned to its content type.
3. Delete paragraphs that cannot be connected to the central judgment; move source evidence only when it remains necessary.
4. Run:

   ```bash
   git diff --check -- <article-path>
   rg -n '^## |^<details>|^<summary>' <article-path>
   ```

   Expected: no whitespace errors; no more than four visible argument sections before references/evidence; `<details>` does not contain a missing premise required by the visible conclusion.

5. Commit only that article:

   ```bash
   git add <article-path>
   git commit -m "重构 <article-slug> 的论证逻辑"
   ```

---

### Task 1: Freeze the Editorial Contract

**Files:**
- Create: `docs/superpowers/specs/2026-08-19-blog-argument-logic-design.md`
- Create: `docs/superpowers/plans/2026-08-19-blog-argument-logic.md`
- Modify: `docs/SDD.md`

**Interfaces:**
- Consumes: the approved argument structures and deletion policy.
- Produces: the project-wide editorial contract used by Tasks 2–7.

- [ ] **Step 1: Verify the specification has no placeholders**

  Run:

  ```bash
  rg -n '[T]BD|[T]ODO|[待]定|[稍]后|[视]情况' docs/superpowers/specs/2026-08-19-blog-argument-logic-design.md docs/superpowers/plans/2026-08-19-blog-argument-logic.md
  ```

  Expected: no output.

- [ ] **Step 2: Verify SDD records the new permanent constraints**

  Run:

  ```bash
  rg -n '按内容性质采用不同论证路径|允许删除重复|2026-08-19：新增按文章类型' docs/SDD.md
  ```

  Expected: all three rules are found.

- [ ] **Step 3: Commit the editorial contract**

  ```bash
  git add docs/SDD.md \
    docs/superpowers/specs/2026-08-19-blog-argument-logic-design.md \
    docs/superpowers/plans/2026-08-19-blog-argument-logic.md
  git commit -m "制定博客论证逻辑重构规范"
  ```

### Task 2: Rewrite the Agent Engineering Series

**Files:**
- Modify: `src/content/posts/agent-loop-harness.md`
- Modify: `src/content/posts/agent-tool-boundary.md`
- Modify: `src/content/posts/agent-checkpoint-chain.md`
- Modify: `src/content/posts/agent-checkpoint-storage.md`
- Modify: `src/content/posts/agent-context-engineering.md`
- Modify: `src/content/posts/agent-prompt-cache.md`
- Modify: `src/content/posts/agent-reliability.md`
- Modify: `src/content/posts/agent-evaluation.md`
- Modify: `src/content/posts/agent-prompt-injection.md`
- Modify: `src/content/posts/agent-planning-patterns.md`
- Modify: `src/content/posts/agent-observability.md`
- Modify: `src/content/posts/agent-memory-layers.md`
- Modify: `src/content/posts/agent-architecture-evaluation.md`

**Interfaces:**
- Consumes: learning/system-note structure: core question → necessary concepts → relationships → personal judgment → boundary.
- Produces: a 13-part series in which each post owns one Agent engineering decision.

- [ ] **Step 1: Rewrite the representative article**

  Apply the Per-Article Review Contract to `src/content/posts/agent-loop-harness.md`. Its argument must establish why the model is only one component and derive Harness responsibilities from that constraint.

- [ ] **Step 2: Rewrite tool and checkpoint boundaries**

  Apply the Per-Article Review Contract independently to:

  | File | Central question |
  | --- | --- |
  | `agent-tool-boundary.md` | Which tool responsibilities belong to Harness rather than the executor? |
  | `agent-checkpoint-chain.md` | Why must a checkpoint preserve causal history rather than only the latest state? |
  | `agent-checkpoint-storage.md` | Which storage constraints follow from checkpoint lineage? |

- [ ] **Step 3: Rewrite context, cache, and reliability articles**

  Apply the Per-Article Review Contract independently to:

  | File | Central question |
  | --- | --- |
  | `agent-context-engineering.md` | Why does each added instruction reduce the effective weight of existing instructions? |
  | `agent-prompt-cache.md` | Which prompt changes silently invalidate prefix caching? |
  | `agent-reliability.md` | Which reliability failures remain after structural validation? |

- [ ] **Step 4: Rewrite evaluation, security, and planning articles**

  Apply the Per-Article Review Contract independently to:

  | File | Central question |
  | --- | --- |
  | `agent-evaluation.md` | Why is an evaluation set a regression guard rather than proof of quality? |
  | `agent-prompt-injection.md` | How should the system remain safe when injection detection fails? |
  | `agent-planning-patterns.md` | Which planning decision is more actionable than assigning a pattern label? |

- [ ] **Step 5: Rewrite observability, memory, and architecture articles**

  Apply the Per-Article Review Contract independently to:

  | File | Central question |
  | --- | --- |
  | `agent-observability.md` | Why should an Agent run be represented as a causal tree? |
  | `agent-memory-layers.md` | Why should memory types share an interface rather than one storage engine? |
  | `agent-architecture-evaluation.md` | Why should architecture comparison begin with failure contracts? |

- [ ] **Step 6: Verify the complete Agent Engineering series**

  Run:

  ```bash
  pnpm exec biome check ./src
  pnpm check
  ```

  Expected: Biome passes; Astro reports zero errors.

### Task 3: Rewrite the AgentScope Source Research Series

**Files:**
- Modify: `src/content/posts/agent-serverside-anatomy.md`
- Modify: `src/content/posts/agent-tools-execution-plane.md`
- Modify: `src/content/posts/agentscope-formatter-boundary.md`
- Modify: `src/content/posts/agentscope-session-recovery.md`
- Modify: `src/content/posts/agentscope-event-reducer.md`
- Modify: `src/content/posts/agentscope-storage-boundary.md`
- Modify: `src/content/posts/agentscope-runtime-ownership.md`
- Modify: `src/content/posts/agentscope-sse-replay.md`
- Modify: `src/content/posts/agentscope-trusted-execution.md`
- Modify: `src/content/posts/agentscope-memory-lifecycle.md`

**Interfaces:**
- Consumes: source-research structure: verification question → critical source path → mechanism → design judgment → uncovered boundary.
- Produces: ten posts whose claims can be traced to minimal source evidence without turning the visible body into a file walkthrough.

- [ ] **Step 1: Rewrite the representative source article**

  Apply the Per-Article Review Contract to `src/content/posts/agent-serverside-anatomy.md`. Keep only source paths needed to prove why server-side sessions cannot depend on the original process.

- [ ] **Step 2: Rewrite protocol and execution-boundary articles**

  Apply the Per-Article Review Contract independently to:

  | File | Verification question |
  | --- | --- |
  | `agent-tools-execution-plane.md` | Where does AgentScope separate tool semantics from execution location? |
  | `agentscope-formatter-boundary.md` | How does Formatter isolate internal messages from provider protocols? |
  | `agentscope-session-recovery.md` | Which state is required to resume an interrupted session and tool call? |

- [ ] **Step 3: Rewrite event, storage, and ownership articles**

  Apply the Per-Article Review Contract independently to:

  | File | Verification question |
  | --- | --- |
  | `agentscope-event-reducer.md` | How are streamed events reduced into a recoverable assistant message? |
  | `agentscope-storage-boundary.md` | Why are Session and Message persistence separate responsibilities? |
  | `agentscope-runtime-ownership.md` | Why is a lock insufficient without verifiable execution ownership? |

- [ ] **Step 4: Rewrite replay, trust, and memory articles**

  Apply the Per-Article Review Contract independently to:

  | File | Verification question |
  | --- | --- |
  | `agentscope-sse-replay.md` | Why should SSE reconnection replay events rather than rerun the Agent? |
  | `agentscope-trusted-execution.md` | Why does tool visibility not establish a trusted execution boundary? |
  | `agentscope-memory-lifecycle.md` | Why is Agent memory not equivalent to conversation history? |

- [ ] **Step 5: Verify the complete source-research series**

  Run:

  ```bash
  pnpm exec biome check ./src
  pnpm check
  ```

  Expected: Biome passes; Astro reports zero errors.

### Task 4: Rewrite the Sandbox Systems Series

**Files:**
- Modify: `src/content/posts/sandbox-deep-dive.md`
- Modify: `src/content/posts/sandbox-page-fault.md`
- Modify: `src/content/posts/sandbox-escape.md`
- Modify: `src/content/posts/sandbox-declarative-k8s.md`
- Modify: `src/content/posts/sandbox-wasm-ebpf-gpu.md`
- Modify: `src/content/posts/sandbox-resource-model.md`
- Modify: `src/content/posts/sandbox-storage-warmpool.md`
- Modify: `src/content/posts/sandbox-image-layering.md`
- Modify: `src/content/posts/sandbox-network-egress.md`
- Modify: `src/content/posts/sandbox-scheduling-observability.md`
- Modify: `src/content/posts/sandbox-one-decision.md`
- Modify: `src/content/posts/sandbox-cow-fork.md`

**Interfaces:**
- Consumes: learning/system-note structure: core question → necessary concepts → relationships → personal judgment → boundary.
- Produces: twelve mechanism articles that support sandbox selection without repeating the same taxonomy in every post.

- [ ] **Step 1: Rewrite the representative sandbox article**

  Apply the Per-Article Review Contract to `src/content/posts/sandbox-deep-dive.md`. The article must lead to the shared-kernel decision and use the seven comparison angles only as evidence for that decision.

- [ ] **Step 2: Rewrite isolation and execution-mechanism articles**

  Apply the Per-Article Review Contract independently to:

  | File | Central question |
  | --- | --- |
  | `sandbox-page-fault.md` | How does one page fault enable several apparently different sandbox optimizations? |
  | `sandbox-escape.md` | Which trust boundary fails in each class of sandbox escape? |
  | `sandbox-declarative-k8s.md` | Why does reconciliation change how sandbox lifecycle should be designed? |
  | `sandbox-wasm-ebpf-gpu.md` | Why do Wasm, eBPF, and GPU workloads violate common sandbox assumptions? |

- [ ] **Step 3: Rewrite resource, storage, and image articles**

  Apply the Per-Article Review Contract independently to:

  | File | Central question |
  | --- | --- |
  | `sandbox-resource-model.md` | Why does the same resource declaration mean different things across isolation models? |
  | `sandbox-storage-warmpool.md` | Why do warm pools and mounted persistent storage create a structural conflict? |
  | `sandbox-image-layering.md` | When is image layering native, emulated, or absent? |

- [ ] **Step 4: Rewrite network, scheduling, and synthesis articles**

  Apply the Per-Article Review Contract independently to:

  | File | Central question |
  | --- | --- |
  | `sandbox-network-egress.md` | Why is domain-level egress control an external policy responsibility? |
  | `sandbox-scheduling-observability.md` | Which sandbox properties make placement, migration, and observation inseparable? |
  | `sandbox-one-decision.md` | How do seven comparison angles reduce to one isolation decision? |
  | `sandbox-cow-fork.md` | When does whole-machine forking save time but increase total cost? |

- [ ] **Step 5: Verify the complete Sandbox Systems series**

  Run:

  ```bash
  pnpm exec biome check ./src
  pnpm check
  ```

  Expected: Biome passes; Astro reports zero errors.

### Task 5: Rewrite Engineering Practice Articles

**Files:**
- Modify: `src/content/posts/agent-sandbox-reconcile.md`
- Modify: `src/content/posts/agent-sandbox-create-path.md`
- Modify: `src/content/posts/agent-sandbox-observability-slo.md`
- Modify: `src/content/posts/agent-runtime-sandbox.md`
- Modify: `src/content/posts/sandbox-agentenv-case.md`
- Modify: `src/content/posts/skill-anti-exfiltration.md`

**Interfaces:**
- Consumes: engineering-practice structure: actual problem → root cause → alternatives and trade-offs → current implementation → effect, cost, and change trigger.
- Produces: six articles that explain why an implementation was chosen instead of presenting only mechanism or procedure.

- [ ] **Step 1: Rewrite the representative practice article**

  Apply the Per-Article Review Contract to `src/content/posts/agent-sandbox-reconcile.md`. Preserve the real failure scenario and make the recreate-versus-reconcile decision the center of the article.

- [ ] **Step 2: Rewrite lifecycle and observability practices**

  Apply the Per-Article Review Contract independently to:

  | File | Actual problem |
  | --- | --- |
  | `agent-sandbox-create-path.md` | Why sandbox creation must be modeled as a multi-stage lifecycle rather than one request. |
  | `agent-sandbox-observability-slo.md` | Why total creation latency cannot identify the responsible subsystem. |
  | `agent-runtime-sandbox.md` | Which runtime façade remains stable while sandbox engines change. |

- [ ] **Step 3: Rewrite product and security practices**

  Apply the Per-Article Review Contract independently to:

  | File | Actual problem |
  | --- | --- |
  | `sandbox-agentenv-case.md` | How one product combines isolation decisions under real constraints. |
  | `skill-anti-exfiltration.md` | Which layered controls reduce skill exfiltration and which risks remain. |

- [ ] **Step 4: Verify all Engineering Practice articles**

  Run:

  ```bash
  pnpm exec biome check ./src
  pnpm check
  ```

  Expected: Biome passes; Astro reports zero errors.

### Task 6: Rewrite AI Coding and Tool Workflow Articles

**Files:**
- Modify: `src/content/posts/ai-coding-workflow-2026.md`
- Modify: `src/content/posts/staged-verify-pipeline.md`
- Modify: `src/content/posts/cycling-training-with-claude.md`

**Interfaces:**
- Consumes: tool/workflow structure: problem → usage flow → key design trade-off → suitable and unsuitable scenarios.
- Produces: three practical articles whose workflows are anchored to a concrete problem and an explicit applicability boundary.

- [ ] **Step 1: Rewrite the AI Coding workflow**

  Apply the Per-Article Review Contract to `src/content/posts/ai-coding-workflow-2026.md`. Center the article on why behavioral constraints cannot replace result verification.

- [ ] **Step 2: Rewrite the staged verification workflow**

  Apply the Per-Article Review Contract to `src/content/posts/staged-verify-pipeline.md`. Center the article on reducing requirement-understanding gaps, and preserve the four stages only as the resulting control flow.

- [ ] **Step 3: Rewrite the cycling analysis practice**

  Apply the Per-Article Review Contract to `src/content/posts/cycling-training-with-claude.md`. Separate observed training data from inferred conclusions and explain where the workflow should not make a recommendation.

- [ ] **Step 4: Verify all AI Coding articles**

  Run:

  ```bash
  pnpm exec biome check ./src
  pnpm check
  ```

  Expected: Biome passes; Astro reports zero errors.

### Task 7: Perform Whole-Site Editorial and Build Verification

**Files:**
- Verify: `src/content/posts/*.md`
- Verify: `public/images/posts/*`
- Verify: generated `dist/`

**Interfaces:**
- Consumes: all rewritten articles from Tasks 2–6.
- Produces: a clean, deployable branch with 44 independently reviewable article commits.

- [ ] **Step 1: Verify article coverage**

  Run:

  ```bash
  test "$(find src/content/posts -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')" = "45"
  test "$(git log --format='%s' main..HEAD | rg -c '^重构 .+ 的论证逻辑$')" = "44"
  ```

  Expected: both commands exit with status 0.

- [ ] **Step 2: Verify Markdown integrity**

  Run:

  ```bash
  git diff --check main..HEAD
  rg -n '[T]BD|[T]ODO|[待]定|[稍]后补充' src/content/posts docs/superpowers/specs docs/superpowers/plans
  ```

  Expected: `git diff --check` has no output; placeholder search has no output.

- [ ] **Step 3: Run the full quality gate**

  Run:

  ```bash
  pnpm exec biome check ./src
  pnpm check
  pnpm build
  ```

  Expected: Biome passes, Astro reports zero errors, and all pages plus the Pagefind index build successfully.

- [ ] **Step 4: Verify representative routes**

  Start:

  ```bash
  pnpm dev --host 127.0.0.1
  ```

  Verify these routes return the rewritten article and render without horizontal overflow at desktop and 390px widths:

  ```text
  /posts/agent-loop-harness/
  /posts/agentscope-runtime-ownership/
  /posts/sandbox-deep-dive/
  /posts/agent-sandbox-reconcile/
  /posts/staged-verify-pipeline/
  ```

- [ ] **Step 5: Audit the final commit history**

  Run:

  ```bash
  git log --reverse --format='%h %ae %s' main..HEAD
  git status --short --branch
  ```

  Expected: one worktree-isolation commit, documentation commits, and 44 article commits, all authored with `yaofuhong0311@gmail.com`; the worktree is clean.

- [ ] **Step 6: Publish without squashing after explicit approval**

  Push the working branch first, merge it into `main` with `--no-ff`, verify `git diff main..content/agent-architecture-evaluation` is empty, then push `main`. Do not delete the working branch.
