---
title: Agent Sandbox 工程实践（五）：进程终止不等于文件回滚
published: 2026-08-28T09:00:00+08:00
description: Signal 只能终止进程，不能撤销已经发生的文件写入；可恢复的 Sandbox 必须同时设计写入提交协议、挂载边界与完整性校验。
tags: [AI Agent, Sandbox, 文件系统, 可靠性]
category: 沙箱系统
---

> Command 被终止，只能证明进程不再继续执行，不能证明文件恢复到执行前。平台若允许任务恢复，必须把“文件仍然存在”和“文件可以安全使用”作为两个独立问题处理。

![进程终止后的文件状态与恢复边界](/images/posts/agent-sandbox-file-consistency.svg)

## Signal 终止进程，不撤销文件写入

命令运行时通过 `open`、`write` 等 syscall 修改文件；Signal 只负责通知或强制终止进程。已经交给内核的写入不会因为进程退出自动回滚，仍停留在用户态缓冲区的数据则可能丢失。

Command 结束后，内核会释放进程的内存、文件描述符和 socket，但这些清理只覆盖运行资源。Workspace、容器可写层和 tmpfs 中已经产生的数据仍服从各自的存储生命周期。

因此，“Command 已停止”“Sandbox 已删除”和“文件系统已恢复”是三个不同状态。

## 半写文件需要提前设计恢复协议

普通文件写入没有事务语义。进程在覆盖文件时被终止，可能留下三类结果：

- 已经写入内核的部分内容被保留；
- 尚未提交的用户态缓冲区内容丢失；
- 以截断模式打开文件时，旧内容已经清空，新内容却不完整。

小型状态文件可以先写临时文件，完成 `fsync` 后再原子 `rename`；大文件记录分块序号和校验和；数据库状态使用事务。读取端还要校验版本、长度或 checksum。

持久化存储只能保证文件可能跨 Sandbox 保留，原子提交和校验才负责证明内容完整。

## 文件寿命由 Mount 决定

文件保留多久，取决于路径落在哪个 Mount 和存储后端：

| 写入位置 | 常见生命周期 |
| --- | --- |
| 独立 Workspace | 可以跨 Sandbox 重建保留 |
| 容器 RootFS 可写层 | 通常保留到容器被删除或重建 |
| tmpfs | 随对应运行载体销毁 |

只读挂载与文件权限也不是同一层控制。`chmod` 修改文件权限位；`ro Mount` 限制通过该挂载视图发生写入。即使权限位允许写，只读挂载仍会由内核拒绝修改。

我的选择是让共享公共数据以 `ro` 视图进入不可信 Sandbox，同时移除重新挂载所需的高权限；需要产出结果的路径则使用独立可写 Workspace，并明确其提交协议。

## 恢复从验证产物开始

任务恢复不能直接从“上次存在一个文件”推导“上次动作已经成功”。恢复流程应先读取动作记录和文件元数据，再校验产物完整性：

```text
确认旧进程已经结束
→ 判断文件所在的存储边界
→ 校验版本、长度与 checksum
→ 识别完整提交点
→ 从确定状态继续或重新执行
```

代价是增加提交元数据和恢复校验。只有失败后允许整体丢弃的临时输出，才可以省略这套协议。

<details>
<summary>实现依据与延伸阅读</summary>

- [OpenSandbox execd API](https://github.com/opensandbox-group/OpenSandbox/blob/main/specs/execd-api.yaml)
- [Linux man-pages 6.15](https://www.kernel.org/pub/linux/docs/man-pages/book/man-pages-6.15.pdf)
- [Command 超时不等于 Sandbox 回收](/posts/agent-sandbox-command-cleanup/)
- 本文区分通用 Linux 机制与平台选择；具体文件是否落盘还受文件系统、缓存和底层存储语义影响。

</details>
