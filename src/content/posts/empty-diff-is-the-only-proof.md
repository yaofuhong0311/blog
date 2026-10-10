---
title: 证明「没漏代码」，只有合完之后重新比一次
published: 2026-09-13T09:00:00+08:00
description: git log、branch --contains、diff --stat 都会在包含关系上给出错的答案。实测三种错法的成因，以及我自己那条「必须空 diff」的规则在三分支场景下为什么不成立。
tags: [Git, 工程实践, AI Coding]
category: 工程实践
---

> 同一个需求被开出 3 条分支，合并前要确认没漏代码。我先后用了 git log、git branch --contains、git diff --stat，三个都给了错的答案。我的判断是：合并前的检查只能用来筛选，证据只有一个——合完之后重新比一次。

## 三个看着像答案的判据

起因是把二期当成了新任务。一个运维后台的配置需求，二期加功能开一条分支，补 CRUD 又开一条，最后三条分支名字是 page、ui、crud，谁包含谁完全说不清。

我搭了个最小仓库复现。feature/x 从 dev 切出加 3 笔，develop 被别人推了 12 笔，然后把 feature/x 那三笔全 cherry-pick 进 develop。此时 develop 在内容上完整包含 feature/x。

**git log 说缺三笔。**

```
$ git log --oneline develop..feature/x
e65f760 featC
3a867bb featB
4eaee08 featA
```

log 按 commit hash 算范围。cherry-pick 生成新 hash，原来那三笔确实不在 develop 的祖先链上。内容在，hash 不在，log 只认后者。`git branch --contains feature/x` 同理，只列出 feature/x 自己。同一份代码走 merge 和 cherry-pick 两条路径进主干，这两个命令会永远显示「主干缺这几笔」，修不掉。

**diff --stat 的方向最容易读反。**

```
$ git diff develop..feature/x --stat
 12 files changed, 12 deletions(-)
```

看着像 feature/x 有一堆 develop 没有的东西。方向反了：这 12 个是 develop 比 feature/x 多出来的那 12 笔，以 deletion 的形式出现。两点 diff 比的是两端快照，右边缺的算 insertion，左边多的算 deletion。只读 `12 files changed` 那一行，结论跟事实相反。

## git cherry 对，但有天花板

`git cherry` 按 patch-id 比对：把 diff 规范化后取哈希，同一份改动落在不同父提交上 patch-id 相同。同一个仓库里它给对了：三笔全输出 `-`，意思是内容已在 develop 里。

但 patch-id 对上下文敏感，周围改一行就变。我造了个场景：feature 分支加了个 retry 函数，develop 上别人独立写了同一个，位置放在 main 之前。

```
$ git cherry develop feature/z
+ 610ea06...            # cherry 说 develop 缺这笔
$ git grep -c "def retry" develop -- app.py
develop:app.py:1        # 实际上有
```

照 cherry 的话去 pick，不报错，pick 完文件里 `def retry` 出现 2 次。没有冲突，没有警告，只在某个文件里留下两段几乎一样的代码。

cherry 的输出只能当筛选用：`-` 可信，`+` 得逐个 `git show` 看清。更快的办法是拿新函数名去目标分支 `git grep`，搜得到就说明合过了。

## 空 diff，以及我写错的那条规则

合完之后重新 diff 一次。它跟前面几个的区别在于不看历史，只比两端的文件内容——走什么路径进来的、hash 和 patch-id 变没变，都不影响结果。单条分支我验过：完整时 0 行输出，故意漏一笔时 7 行，并指出漏的是哪个文件。

但我原来写的规则是「必须无输出」，这条错了。三条分支全合进 dev 之后再跑：

```
$ git diff dev..f3 --stat
 f4.txt    | 1 -
 other.txt | 1 -
 2 files changed, 2 deletions(-)
```

不空。dev 上有 f2 和 f4 的文件而 f3 没有，显示成 deletion，又是方向问题。多条分支时「空输出」根本不可能成立，而三条分支正是这条规则被写出来的那个场景。

正确的判据是只数 insertion：

```bash
for b in f2 f3 f4; do
  add=$(git diff dev.."$b" --numstat | awk '{s+=$1} END{print s+0}')
  echo "$b → dev 缺的行数: $add"
done
```

全 0 = 没漏。我在 f3 上补一笔不合进去，它报 `f3 → 1`，并指出是 missed.txt。

顺带一个容易混的：`git diff A..B` 和 `git log A..B` 里的两个点含义不同。log 的两点是提交范围，diff 的两点是比两端快照。我测过一个仓库，`git log dev..feature/w` 是 0 笔，`git diff dev..feature/w` 是 1 个文件，同一对分支，同样的 `..`。要让 diff 只算一边得用三点。

## 代价

多一次 merge 加一次 diff，一分钟。我跳过它不是为了省这一分钟：前面那三个命令都给了明确输出，看着很像答案，再验一次会觉得多余。我最近一次就是看着 cherry 的全 `-` 直接合了，没补那一步。那次没出事，是运气。
