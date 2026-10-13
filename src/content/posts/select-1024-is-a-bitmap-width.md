---
title: select 的 1024 是位图宽度，不是配置项
published: 2026-10-12T14:00:00+08:00
description: 线上创建 100% 失败、93–110ms 返回，fd 用量 1043 对上限 1048576 只占 0.1%，水位全绿。根因是 select.select 的 fd_set 只有 1024 位，卡的是 fd 编号：进程只剩 2 个 fd、编号 1025，select 照样抛 ValueError。换成 selectors 的代价是状态管理，外加一处新的静默。
tags: [Python, 排障, 工程实践, 可观测性]
category: 工程实践
---

> 线上一个沙箱服务创建 100% 失败，93–110ms 就返回，重启之前不自愈。fd 用量 1043，上限 1048576，占 0.1%，水位指标全是绿的。根因是 `select.select` 底下那个 1024 位的位图，它管的是 fd 的编号，和开了多少个 fd 无关。我的判断是：有些上限不在任何配置项里，它就是某个数据结构的字段宽度——这种上限调不掉，只能换 API。

![两栏对照：左栏是监控在看的数量，1043 个 fd 对 1048576 的上限，0.1%；右栏是真正拦下来的编号，fd_set 只有 1024 个二进制位，编号 1024 的 fd 已经落在位图外面](/images/posts/select-1024-is-a-bitmap-width.svg)

## 先排掉三种比它更像的解释

**等外部超时。** 这条靠延迟本身排掉。创建沙箱要起进程、连网络代理、跑探针，任何一处等超时都落在秒级，而且依赖抖动会有快有慢。每次都落在 93 到 110 毫秒这 17 毫秒里，说明失败来自同步代码路径上的一次判断，中途没有等任何人回话。

**句柄耗尽。** 这条看起来最像，创建沙箱确实要开一串 fd。指标是 1043 对 1048576，0.1%，于是被排掉了一轮。问题在分母：1048576 是进程的 `RLIMIT_NOFILE`，这次拦下来的上限是 1024。1043 对 1048576 绰绰有余，对 1024 超了 19 个。指标本身算对了，它比的是另一个上限。

**进程配额。** 我最早的结论是这个，后来撤回了。fork 撞配额抛 `EAGAIN`，实际抛出来的是 `ValueError`。

第三条能撑一段时间，是因为异常原文当时看不见：创建函数内部至少八处会失败，全抛同一个异常类型，上层压成一句「初始化失败」，而那处 except 一行日志都不记。先改那一处、把异常原文和 fd 水位快照打出来，才看到 `filedescriptor out of range in select()`。日志补在修复前面。

## 1024 写在 fd_set 的定义里，它管编号不管数量

`fd_set` 不是集合类型，是定长位图。macOS SDK 头文件里它是 `__int32_t fds_bits[howmany(1024, 32)]`，本机编出来 `sizeof(fd_set)` = 128 字节，正好 1024 位。`FD_SET(fd, &set)` 做的事是把第 fd 位置 1。

C 里传 fd=1024 进去就是写第 1025 位，越过数组尾。glibc 开了 `_FORTIFY_SOURCE` 会在这一步 abort，没开就安静地写到相邻内存上。

Python 这层不一样。CPython 在进 `select(2)` 之前自己查过编号，超了抛 `ValueError`——报的是 ValueError 而不是 OSError，说明这道检查在进内核之前。本机实测边界：fd=1023 通过，fd=1024 抛 `filedescriptor out of range in select()`。

`select.select` 是 C `select(2)` 的薄封装，位图宽度由 libc 头文件在编译期定死，没有环境变量，没有 `setrlimit`，没有运行期参数。Darwin 的头文件允许在 include 之前先 define `FD_SETSIZE`，实测 `-DFD_SETSIZE=4096` 编出来 `sizeof(fd_set)` 是 512 字节；glibc 那边 `__FD_SETSIZE` 写死 1024，预先 define 不生效。glibc 这两条我只读了头文件，没在 Linux 上编译核对。两边一致的地方是：要让 Python 跟着变，得重编解释器。

把编号推上去，再把占位的 fd 全关掉，十行就能把编号和数量分开：

```python
import os, select

holders = []
while True:
    r, w = os.pipe()
    if r >= 1024:
        break
    holders += [r, w]
for fd in holders:
    os.close(fd)          # 现在本进程只剩这一对管道

select.select([r], [], [], 0)
# ValueError: filedescriptor out of range in select()
```

进程里除了标准流只剩这一对管道，列表里只传 1 个 fd，编号 1025，照样抛。同一个 fd 交给 `select.poll()` 或 `selectors.DefaultSelector()`，都正常返回就绪。

监控量的是数量，坏掉的是编号。「不自愈」也出在这里：编号高的那些 fd 属于还活着的沙箱，它们不释放，select 的参数里就一直带着超过 1023 的编号，重启进程才归零。

每套沙箱 9 个 fd，85 套 765 个，加上服务自身的监听、连接池、日志，一共 1043。真正的上限是 (1024 − 其他 fd 数) / 9，大约 83 套。这个数是我按 1043 倒算的，不是压测出来的阈值，而且哪份文档、哪个配置项里都不会写着「最多 85 套」。

## 换成 selectors 要付三样东西

改法是全仓换成 `selectors.DefaultSelector()`，Linux 落到 epoll，macOS 落到 kqueue。两者都按事件队列工作，fd 编号多大都收。

**从无状态变成有状态。** select 是一次性调用，selectors 要 register / unregister / close。像「读完一个子进程的 stderr 就结束」这种短命循环，每轮新建一个 selector，本机实测 12.8 微秒一次，而 select 是 0.31 微秒。单个 fd、没有事件就绪时，换过去是变慢的。fd 多了才反过来：500 个 fd、1 个就绪，select 20.4 微秒，复用的 selector 0.47 微秒。这组数在 macOS / kqueue / Python 3.13 上测的，Linux 的 epoll 我没测，常数应该更低，但我没有数。

**换掉了一个显式错误。** select 收到已关闭的 fd 会抛 `OSError EBADF`。注册之后才被关掉的 fd，kqueue 和 epoll 会把它从就绪集合里直接摘掉——实测 `selectors.select(0.2)` 返回空列表，老老实实等满 200 毫秒，一声不响。原来会当场炸的情况变成一次空转，所以 register 过的 fd 谁负责关、什么时候 unregister，得写死在一处。这和[静默失败比报错难查](/posts/silent-failure-prefer-explicit-reject/)是同一种情形：换 API 顺手把一处报错换成了一处安静。

**select 收的 fd 比它们宽。** `/dev/null` 这类字符设备 select 照单全收并报永远就绪，kqueue 注册直接回 `EINVAL`（实测）；epoll 对普通文件回 `EPERM`，这条我没在 Linux 上跑。被监听的 fd 里只要混进普通文件或字符设备，换过去会在 register 那一步就炸。

## 改完之后 grep 到了我自己刚写的那一行

全仓 grep `select.select`，四处。其中一处是我在这次排查过程里新写的抽 stderr 函数——根因刚定位完，同一个 bug 又被我写了一遍。修一个调用点不算修完。

这里 grep 站得住，因为 `select.select` 是字面 API 名、在仓库里、不经运行时注入，正好是 grep 适用的那一类。要是换成「这个权限有没有发放」就不成立了，[grep 不到只能证明你搜过的文件里没有](/posts/grep-proves-less-than-you-think/)。

同一类上限还有几个，修法是换协议或者加选项：以太网帧里 VLAN ID 占 12 位，4094 个可用，这是 VXLAN 改用 24 位 VNI 的原因；TCP 头的窗口字段 16 位，顶格 64KB，要更大的窗口得靠窗口缩放选项另外带。

看着像、其实是参数的那些：`RLIMIT_NOFILE`、`pid_max`、本地端口范围。判据是有没有一个读写它的接口——getrlimit、sysctl、环境变量，有一个就调得动。只能在头文件的结构体定义里找到的那个数，是宽度。

两处没测到：四处 `select.select` 里另外两处在线上有没有真被触发过，我没去查日志统计；85 套以下、但某个 fd 编号被单独顶过 1023 的情况能不能复现同一个错误，我也没构造。
