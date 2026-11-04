---
layout: post
title: "《Lasso: Accurate and Efficient Detection of Long-Lived Sparse Items in High-Speed Data Streams》阅读笔记"
date: "2026-10-26 11:48:48"
updated: "2026-10-26 22:09:59"
permalink: papers/lasso/
categories: ["Sketch","特定流型检测"]
tags: ["Sketch","可编程网络","网络安全"]
excerpt: "Lasso 通过同时利用“频率与持久性的偏差”来快速淘汰不够稀疏的候选，并利用最近出现时间进行细粒度的长期对象保护，从而在极小内存和强哈希碰撞下仍能准确检测 long-lived sparse items，同时避免 flag reset、概率替换和复杂算术，使算法可以实际部署到 CPU、Tofino 可编程交换机和 FPGA 上。"
disableNunjucks: true
comments: false
---

> 🧭 **阅读主线**：这篇论文不是单纯追求 sketch 的离线精度，而是在“**小内存 + 高碰撞 + 高速流 + 可编程交换机/FPGA 约束**”下，重新设计 long-lived sparse item（长期存在但低频出现的对象）的候选保留与淘汰机制。理解全文最重要的三个关键词是：**frequency–persistence deviation、temporal protection、hardware-conscious design**。

---

### 开头：论文基本信息、发表情况、CCF 级别与开源情况

| 项目 | 信息 |
|---|---|
| 论文 | **Lasso: Accurate and Efficient Detection of Long-Lived Sparse Items in High-Speed Data Streams** |
| 作者 | Weihe Li, Jiawei Huang, Zhaoyi Li, Tianyue Chu, Qichen Su, Jianxin Wang |
| 发表会议 | **The 32nd ACM SIGKDD Conference on Knowledge Discovery and Data Mining (KDD ’26), Research Track** |
| 时间与地点 | **2026 年 8 月 9–13 日，韩国济州岛（Jeju Island, Republic of Korea）** |
| 页数 | 12 pages |
| DOI | <https://doi.org/10.1145/3770855.3818048> |
| CCF 等级 | **CCF A 类**，属于“数据库 / 数据挖掘 / 内容检索”方向 |
| 论文许可 | CC BY-NC-ND 4.0 |
| 是否开源 | **是，但当前公开仓库主要是 CPU 参考实现与补充证明** |
| 代码仓库 | <https://github.com/WeiheLi/Lasso/> |
| KDD 2026 论文列表 | <https://kdd2026.kdd.org/papers/> |
| CCF 推荐目录 | <https://www.ccf.org.cn/Academic_Evaluation/DM_CS/> |

> 💡 **开源情况补充（截至 2026-10-26）**：公开 GitHub 仓库目前能看到 `Lasso_CPU/`、`Lasso_LL_CPU/`、README 和数学补充材料。README 明确称其为 **CPU reference code**。论文中展示了 Tofino P4 与 FPGA 实现，但当前仓库主页未展示对应 P4/FPGA 源码，因此更准确的说法是：**算法与 CPU 参考实现已开源，硬件端实现并未在该公开仓库中完整呈现**。

---

### 1. 摘要 (Abstract) 与核心贡献 (Core Contribution)

#### 一句话总结

**Lasso 通过同时利用“频率与持久性的偏差”来快速淘汰不够稀疏的候选，并利用最近出现时间进行细粒度的长期对象保护，从而在极小内存和强哈希碰撞下仍能准确检测 long-lived sparse items，同时避免 flag reset、概率替换和复杂算术，使算法可以实际部署到 CPU、Tofino 可编程交换机和 FPGA 上。**

#### 贡献列表 (Contribution List)

- **贡献 1：提出针对 long-lived sparse item 的硬件友好候选替换机制。** 核心指标为
  $$
  \mathrm{dev}=V-\theta P,
  $$
  其中 $V$ 是被跟踪对象的频率估计，$P$ 是持久性估计。若 $\mathrm{dev}>0$，意味着该对象“出现得太频繁”，不再满足 sparse 性质，可优先被淘汰。

- **贡献 2：提出无需额外 per-bucket flag 的时间感知保护机制。** 每个 bucket 只额外维护最近出现窗口 $W$，利用“连续缺席时间”判断一个候选是否已经陈旧，从而避免传统 persistence sketch 依赖的周期性 flag reset 和 data/control-plane 协同。

- **贡献 3：做了算法—硬件协同设计并给出理论分析。** Lasso 只依赖整数加减、比较和哈希；作者进一步证明估计值具有单边低估性质，并给出 false negative 的概率上界。实验覆盖 **CPU、Intel Tofino、Xilinx FPGA**，强调的不只是精度，还包括吞吐和资源占用。

> 📌 这篇论文真正的创新点并不是“又设计了一个 sketch”，而是把 **long-lived sparse 的统计特征直接变成替换优先级**，并把这个替换逻辑压缩到可编程交换机可以承受的操作集合中。

---

### 2. 引言 (Introduction)：问题背景与研究动机

#### 问题定义 (Problem Definition)

论文首先把高速数据流写成 key–value 序列，流被划分为 $W$ 个互不重叠的时间窗口。对对象 $u$：

- **Frequency**：
  $$
  f(u)=\text{对象 }u\text{ 在整个数据流中的总出现次数};
  $$

- **Persistence**：
  $$
  p(u)=\text{至少出现过一次 }u\text{ 的不同时间窗口数量}.
  $$

显然有

$$
f(u)\ge p(u).
$$

给定 persistence threshold $\alpha\in(0,1]$ 和 sparsity parameter $\theta\ge1$，论文把 long-lived sparse item 定义为同时满足：

$$
p(u)\ge \alpha W,
$$

以及

$$
f(u)\le \theta p(u).
$$

这个定义非常值得仔细理解。第二个条件等价于

$$
\frac{f(u)}{p(u)}\le\theta,
$$

而 $f(u)/p(u)$ 可以直观理解为“**在它出现的窗口里，平均每个活跃窗口出现多少次**”。当 $\theta=1.1$ 时，一个合格对象几乎就是“很多窗口都会露面，但每个窗口通常只来一次”。

这类模式在网络安全中非常典型：攻击者可能进行 **低速数据渗漏、低频扫描、长期潜伏**，有意避免形成传统 heavy hitter 的高频突发特征。在用户行为分析中，也可能对应长期存在但只偶发登录、点击或交易的异常账号。

#### 为什么难？

这个问题同时具有三个互相强化的困难：

1. **候选极少、短生命周期对象极多。** CAIDA 流量具有明显长尾/偏斜分布，大量对象只出现很短时间；真正 long-lived sparse 的对象只是极小比例。
2. **内存极小导致哈希碰撞频繁。** 如果只粗暴地做 replacement，真正的长期稀疏对象可能被海量一次性对象挤掉。
3. **硬件执行模型限制算法复杂度。** Tofino 数据平面不适合浮点、除法、指数运算、迭代控制流，也不能随意在一个 pipeline pass 中反复访问同一个 register。

因此，核心矛盾不是“能不能统计 $f$ 和 $p$”，而是：

> **当内存不够、每个新对象都可能撞进已有 bucket 时，究竟应该保护谁、淘汰谁？而这个决策又必须足够简单，才能在线速硬件上执行。**

#### 现有方法的局限 (Limitations of Prior Work)

**第一类：基于 flag 的 persistence tracking。**

On-Off Sketch、P-Sketch、Pandora、Stable-Sketch 等方法通常需要标记“本窗口是否已经更新过”，然后在窗口边界清空 flag。问题在于：可编程交换机的数据平面与控制平面之间存在同步开销；高速率下 flag reset 可能不及时，导致 persistence 更新失真。已有方法即使提高精度，也往往付出额外 metadata 和状态管理成本。

**第二类：专门针对 persistent + infrequent/sparse 的方法。**

- **PISketch** 使用权重机制：对象在某个窗口第一次出现时增加一个固定权重 $L$，同窗口后续出现则递减。它的问题是 $L$ 对数据分布敏感，固定超参数不容易跨 trace 泛化。
- **PSSketch** 采用多层、异构长度、bitwise counter，精度更好，但更新逻辑明显更复杂，吞吐下降，也更难映射到受限硬件。

换句话说，已有方案往往在两个端点之间摇摆：

- 简单 → 但碰撞下保不住真正目标；
- 精细 → 但太复杂，难以部署。

#### 本文思路 (Overall Idea)

Lasso 的切入点很直接：**不要把所有“长期存在”对象都当成同等重要，而要利用 long-lived sparse 自身的定义来指导 replacement。**

作者观察到真正 long-lived sparse 对象应具有：

$$
f(u)\approx p(u),
$$

即 frequency 和 persistence 之间不会有很大的间隔。因此，当发生碰撞时，可以优先淘汰那些

$$
f(u)-\theta p(u)
$$

较大的对象；而对“看起来仍然长期”的对象，再结合最近出现时间给予保护。

这形成了 Lasso 的核心逻辑链：

> **统计性质 → 替换优先级 → 降低碰撞误杀 → 更高小内存精度 → 简单操作 → 可部署到受限硬件。**

---

### 3. 方法论深度解析 (In-depth Methodological Analysis)

#### 3.1 整体架构 (Overall Architecture)

Lasso 使用一个非常平坦的二维 sketch：共有 $r$ 行，每行 $b$ 个 bucket。一个 bucket 不做层级编码，也不维护复杂的变长 counter，而只保存四个字段：

- $K$：item key；
- $P$：persistence；
- $W$：last-arrival window，即该对象最近一次出现的窗口编号；
- $V$：frequency。

![论文 Figure 1：Lasso 数据结构](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/figure1_data_structure.png)

**图 1 的关键不是“有四个字段”，而是 $W$ 的角色。** 传统方法常用“本窗口是否见过”的 flag，并要求每个窗口结束时 reset；Lasso 不 reset，而是直接记录最后一次出现在哪个窗口。只要比较
$$
W < currentWindow,
$$

就能知道“这个对象在当前窗口是否已经更新过 persistence”。

这是一种很典型的 **用时间戳替代周期性清零状态** 的设计：多存一个窗口编号，却省掉了全局 reset 和 data/control-plane 协同。

整个数据流处理过程可以概括为：

```text
incoming item
    ↓
r 个 hash → 每行得到一个候选 bucket
    ↓
是否有空 bucket / key hit？
    ├─ 有空：直接插入
    ├─ hit：更新 V；若进入新窗口则更新 P 和 W
    └─ miss：比较各候选 bucket 的 dev = V - θP
                ↓
          选择 dev 最大者
                ↓
     非 sparse？→ 立即替换
                ↓ 否
     已达到长期阈值？→ 保护
                ↓ 否
     连续缺席过久？→ P、V 懒惰衰减
                ↓
          P 降到 0 才替换
```

宏观上，Lasso 与 PSSketch 最大的不同是：

- PSSketch 倾向于通过 **更复杂的 counter 组织提高内存利用率**；
- Lasso 倾向于通过 **更聪明但极简的 replacement policy 提高有限 bucket 的“候选纯度”**。

因此它特别适合 **内存紧、碰撞重、更新速率极高** 的场景。

---

#### 3.2 核心组件/模块拆解 (Core Component Breakdown)

##### 3.2.1 模块一：Deviation-based Candidate Eviction

**输入与输出**

输入是一次 miss 后，来自 $r$ 行哈希位置的已有对象状态 $(K,P,W,V)$；输出是最适合被挑战/替换的候选 bucket。

作者为每个候选计算：

$$
\mathrm{dev}=V-\theta P.
$$

并选择 **dev 最大** 的 bucket。w

**内部机理**

long-lived sparse 的必要条件之一是

$$
V\le \theta P.
$$

因此：

- $\mathrm{dev}\le0$：仍然可能是 sparse 候选；
- $\mathrm{dev}>0$：当前频率已经高于 sparse 上限，说明它从定义上看就“不够稀疏”。

当 $\mathrm{dev}>0$ 时，Lasso 直接把该 bucket 替换成 incoming item。

**直觉**

可以把 $P$ 看成“长期存在的证据”，把 $V$ 看成“活跃强度”。目标对象希望“证据多、活跃强度低”。所以 $V-\theta P$ 本质上是在问：

> 这个对象相对于自己已经积累的持久性证据，是否产生了过多额外流量？

如果答案是“是”，那它就不值得继续占用专门服务于 sparse item 的有限内存。

**设计动机**

这一设计有两个优点：

1. 它直接对齐问题定义，不需要训练、概率模型或额外 score；
2. 在硬件上只需要乘法/缩放、减法和比较。作者在 FPGA 上进一步把 $\theta$ 相关的实数比较改写为 fixed-point/scaled integer inequality，用 shift-and-add 避免浮点和通用乘除法。

---

##### 3.2.2 模块二：Dynamic Long-Lived Protection

如果候选 $\mathrm{dev}\le0$，它仍有可能是真正目标，因此不能立刻替换。Lasso 进一步计算动态 persistence threshold：

$$
pThresh=\alpha\cdot currentWindow.
$$

如果

$$
P\ge pThresh,
$$

则直接保护该对象。

这里的思想非常重要：阈值不是固定常数，而是随流处理进度增长。因为在第 $t$ 个窗口时，“已经出现多少个窗口才算长期”天然应当随 $t$ 增长。

**输入与输出**

- 输入：候选的 $P$ 与当前窗口编号；
- 输出：保护或继续进入 stale 检查。

**解决的问题**

短生命周期对象数量通常远多于长期对象。如果没有这种保护，一个已经积累很多 persistence 的真目标仍可能被一次随机碰撞轻易撞掉。

**为什么不是永久锁住？**

因为“曾经长期”不代表“现在仍长期”。这就引出第三个机制。

---

##### 3.2.3 模块三：Temporal Staleness + Lazy Decay

Lasso 计算：

$$
gap=currentWindow-W.
$$

其中 $W$ 是该对象最近一次出现的窗口。如果

$$
gap>P,
$$

说明它连续缺席的时间已经超过自己积累的 persistence 证据，算法就执行：

$$
P\leftarrow\max(P-1,0),
$$

$$
V\leftarrow\max(V-1,0).
$$

当 $P=0$ 时，bucket 才真正被 incoming item 回收。

**为什么同时减 $P$ 和 $V$？**

如果只减 $P$，$V/P$ 会突然变大，使对象看上去“越来越不稀疏”；同时减二者，相当于逐步遗忘陈旧历史，使 retained state 更像一个“被压缩后的有效证据”。

**为什么称为 lazy decay？**

Lasso 并不会每到一个窗口就扫描全部 bucket 做衰减。只有当一个 bucket 被新的碰撞对象挑战时，才检查 gap 并可能衰减。

这对硬件极其关键：

> **不主动维护所有状态，只在竞争发生时清理陈旧状态。**

这把本来可能是 $O(\text{all buckets per window})$ 的维护成本，变成每个数据项更新路径上的常数级比较。

---

##### 3.2.4 模块四：Last-arrival Window 替代 Flag Reset

命中同一 key 时，算法先令

$$
V\leftarrow V+1.
$$

只有当

$$
W<currentWindow
$$

时，才执行

$$
P\leftarrow P+1,
$$

并更新

$$
W\leftarrow currentWindow.
$$

因此，同一对象在同一窗口中无论出现多少次，persistence 最多增加 1。

这等价于传统 On-Off flag 的语义，却不需要在窗口结束后批量清零。

从可编程交换机设计角度，这实际上是本文最“工程味”的创新之一：**把一个需要周期性全局状态管理的问题，转化成局部的时间戳比较。**

---

#### 3.3 关键公式与算法 (Key Equations and Algorithms)

##### 3.3.1 核心公式 1：long-lived sparse 判定与 deviation

目标对象满足：

$$
p(u)\ge \alpha W,
$$

$$
f(u)\le\theta p(u).
$$

Lasso 把第二个不等式改写为在线 replacement score：

$$
\mathrm{dev}=V-\theta P.
$$

**公式目标**：不是直接做最终分类，而是在发生哈希冲突时回答“谁最不值得继续留在 bucket 里”。

**各部分含义**：

- $V$：当前 bucket 中对象累计出现次数；
- $P$：它出现过的不同窗口数；
- $\theta$：允许的平均窗口内活跃程度；
- $V-\theta P$：距离 sparse 边界的“超额活跃量”。

**直觉**：

- 越负：越像“每个活跃窗口只出现一两次”的 sparse item；
- 越正：越像 frequent item；
- 所以 miss 时选择 dev 最大者，等价于“先赶走最不像目标的那个”。

---

##### 3.3.2 核心算法：Algorithm 1 的决策顺序

![论文 Algorithm 1：Lasso Update Procedure](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/algorithm1_update.png)

Algorithm 1 的设计顺序很有讲究，可以压缩成下面的伪代码：

```text
for each incoming u:
    currentWindow = ceil(C / G)

    for each row v:
        q = h_v(u.key)
        if bucket empty:
            insert u and return
        if bucket.key == u.key:
            V += 1
            if W < currentWindow:
                P += 1
                W = currentWindow
            return
        record dev = V - θP

    cand = bucket with maximal dev

    if cand was already updated in current window:
        discard incoming u

    if cand.dev > 0:
        replace cand immediately

    if cand.P >= α * currentWindow:
        protect cand

    gap = currentWindow - cand.W
    if gap > cand.P:
        cand.P -= 1
        cand.V -= 1

    if cand.P == 0:
        replace cand
```

这里最值得注意的是决策顺序：

1. **先判断“不够 sparse”**，这是最强的淘汰证据；
2. 再判断“已经足够 long-lived”，这是最强的保护证据；
3. 剩下的模糊候选，才根据时间陈旧程度逐步衰减。

也就是说，Lasso 不是一个单一 score 替换算法，而是一个**分层证据决策器**。

---

##### 3.3.3 理论性质：为什么作者强调“单边低估”

附录 Theorem A.1 证明，对任意对象 $u$：

$$
\hat p(u)\le p(u),\qquad \hat f(u)\le f(u).
$$

原因很直接：Lasso 的状态更新只会在真实 arrival 时增加计数；碰撞时要么保持、衰减、替换为 1，要么拒绝 incoming item，因此不会凭空生成超过真实值的计数。

这个性质很重要，因为它让误差分析可以集中讨论“**由于碰撞/替换少记了多少**”。不过要注意：

> ⚠️ **“$p$ 和 $f$ 都不高估”并不自动等价于“复合 long-lived sparse 判定不会有 false positive”。**

因为如果 $f$ 的低估比 $p$ 更严重，一个真实不够 sparse 的对象仍可能在估计域中满足 $\hat f\le\theta\hat p$。所以单边计数误差是很好的理论结构，但不能被误读为分类层面的单边错误。

论文进一步给出 long-lived sparse item 被漏检的上界：

$$
\Pr[FN(u)]
\le
2\exp\left(
-\tau^{\star}\log\frac{\tau^{\star}}{\bar\mu}
+\tau^{\star}-\bar\mu
\right).
$$

其中 $\bar\mu$ 可以理解为由**哈希碰撞、到达过程和窗口配置共同诱导的期望低估量**，而

$$
\Omega=1-\left(1-\frac1b\right)^{n-1}
$$

表示 uniform hashing 假设下单行发生碰撞的概率。上界所传达的核心趋势比复杂展开式更值得记住：

- bucket 数 $b$ 越大 → 碰撞概率下降 → 漏检概率下降；
- 行数 $r$ 增加 → 多哈希选择带来保护；
- 允许的误差 margin 越大 → 失败概率指数下降。

理论上这与实验中“**小内存时碰撞是主要矛盾**”的观察是一致的。

---

#### 3.4 硬件实现：为什么 Lasso 真能上 Tofino / FPGA

##### Tofino：两次 pipeline pass

论文在 Wedge 100BF-32X 上使用 P4 实现 Lasso。Figure 2 展示了工作流：第一遍读取 register 并计算更新决策，第二遍写回更新后的 $K/P/W/V$。

![论文 Figure 2：Lasso 的 Tofino workflow](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/figure2_tofino_workflow.png)

这是因为 Tofino 的一个重要限制是：**一个 packet 在单次 pipeline pass 中对同一 register resource 的访问受到严格限制**。因此作者使用 packet recirculation：

1. 第一遍：hash → read register → compare/check；
2. 内部 loopback；
3. 第二遍：write register。

优点是整个机制仍留在 data plane，不需要控制平面参与；代价则是每个包需要额外一次内部 pipeline traversal。

##### FPGA：fixed-point + shift-and-add

FPGA 版本使用 Xilinx Zynq UltraScale+ MPSoC (XCZU2EG)，两行 sketch，采用固定 read–modify–write pipeline。

作者特别强调：涉及 $\theta$ 的实数运算全部改成 fixed-point 比较，通过 scaled integer + shift-and-add 完成，因此数据通路不需要浮点单元、通用乘法器或除法器。

这说明 Lasso 的“hardware-conscious”并不是实验阶段才做的工程适配，而是从算法公式层面就主动约束了操作集合。

---

### 4. 实验设计与结果分析 (Experimental Design and Results Analysis)

#### 实验设置 (Experimental Setup)

##### 数据集

论文主要使用四组 CAIDA 真实网络流量：

| Trace | Packets | Distinct items |
|---|---:|---:|
| CAIDA 2015 | 20.2M | 520K |
| CAIDA 2016 | 22.3M | 730K |
| CAIDA 2018 | 22.3M | 760K |
| CAIDA 2019 | 29.5M | 1.53M |

item key 使用 **source IP address**。

主实验设置：

- sketch rows：$r=2$；
- 时间窗口：$W=100$；
- persistence threshold：$\alpha=0.4$；
- sparsity threshold：$\theta\in\{1.1,1.2,1.3\}$；
- 内存预算：16 KB、32 KB、64 KB、128 KB、256 KB。

Table 1 中 ground-truth long-lived sparse item 的数量很少：

| Trace | $\theta=1.1$ | $\theta=1.2$ | $\theta=1.3$ |
|---|---:|---:|---:|
| CAIDA 2015 | 41 | 86 | 163 |
| CAIDA 2016 | 270 | 465 | 791 |
| CAIDA 2018 | 79 | 193 | 367 |
| CAIDA 2019 | 181 | 349 | 603 |

这张表非常重要：它说明任务是高度稀有事件检测。特别在 $\theta=1.1$ 时，一条数千万 packet 的 trace 中真目标可能只有几十个，任何一次错误 eviction 都会显著影响 Recall/F1。

##### Baselines

- **long-lived sparse detection**：PSSketch；
- **long-lived item detection（Lasso-LL）**：Pandora、Stable-Sketch、Tight-Sketch。

作者没有继续加入 PISketch，理由是 PSSketch 已在精度和速度上显著优于更早的方法。

##### Metrics

- **F1 Score**：综合 Precision 和 Recall；
- **ARE (Average Relative Error)**：衡量估计值相对误差；
- **Update Speed (Mops)**：每秒百万次更新。

每个实验重复 5 次并取平均。

---

#### 主实验结果 (Main Results)

![论文 Figures 3–5：Lasso 与 PSSketch 的精度、ARE、更新速度](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/figures3_5_main_results.png)

##### 4.1 小内存时，Lasso 的优势非常明显

Figure 3 显示，在 16–128 KB 的受限内存下，Lasso 的 F1 几乎始终高于 PSSketch。

论文给出的一个很强的例子是：当 $\theta=1.1$、内存只有 32 KB 时，Lasso 相比 PSSketch 的 F1 提升分别为：

- CAIDA 2015：**234.5%**；
- CAIDA 2016：**526.18%**；
- CAIDA 2018：**281.07%**；
- CAIDA 2019：**267.39%**。

这正好验证了方法部分的核心假设：

> 当内存紧张、碰撞频繁时，性能瓶颈不是 counter 表示精度，而是“真正目标能否在竞争中活下来”。

Lasso 的 deviation eviction + temporal protection 专门解决的就是这个问题。

##### 4.2 但在 256 KB 时，PSSketch 可能反超

这是阅读论文时不能忽略的细节。作者明确指出，当内存增大到 256 KB、哈希碰撞不再严重时，**PSSketch 的检测精度可能更高**。

原因是 PSSketch 的 multi-level heterogeneous counter 在内存较充足时可以更精细地利用空间；而 Lasso 的优势主要来自碰撞下的 replacement policy。

因此更准确的结论不是“Lasso 在所有条件下都更准”，而是：

> **Lasso 的 Pareto 优势集中在 tight memory + high throughput + hardware deployability 区域。**

这其实比简单宣称全局 SOTA 更有价值，因为论文的问题设定本来就是资源受限高速流。

##### 4.3 ARE 结果支持“状态保存更稳定”

Figure 4 中，Lasso 在所有测试设置上都表现出显著更低的 sparsity estimation error。

这说明它不仅“最后分类对了更多”，还说明 retained bucket 中的 $P/V$ 状态本身更接近目标对象的真实统计量。换句话说，替换机制确实提高了 sketch 内部状态的质量，而不是只对某个决策阈值做了投机性优化。

##### 4.4 吞吐优势与结构复杂度直接对应

Figure 5 显示 Lasso 的更新速度显著高于 PSSketch。$\theta=1.3$ 时，Lasso 相对 PSSketch 的平均更新速度提升分别为：

- 2015：169.67%；
- 2016：182.5%；
- 2018：160.94%；
- 2019：163.48%。

这里方法—结果的因果链很清晰：

- flat bucket；
- 无多层 variable-length counter；
- 无概率 replacement；
- 无 per-window flag reset；
- 只有简单 hash / integer arithmetic / compare；

最终自然对应更短的 per-item critical path。

---

#### Lasso-LL、参数鲁棒性与额外数据集

![论文 Figures 6–10：Lasso-LL、参数鲁棒性与额外 trace](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/figures6_10_robustness.png)

Lasso 去掉 sparsity 相关逻辑后得到 **Lasso-LL**，用于纯 long-lived item detection。

Figure 6 中，Lasso-LL 在各内存设置下 F1 均领先。相对 Pandora 的平均 F1 提升约为：

- CAIDA 2015：12.03%；
- CAIDA 2016：16.81%；
- CAIDA 2018：13.03%；
- CAIDA 2019：14.3%。

Figure 9 进一步改变：

- 总窗口数 $W=500\sim1700$；
- persistence threshold $\alpha=0.3\sim0.8$；

Lasso-LL 仍保持较高 F1，说明 temporal protection 并不是只对单一参数点有效。

作者还用 Zipf 分布生成三组 synthetic traces（skewness 0.15、0.4、0.6），Lasso 仍保持更高 F1、更低 ARE；这说明收益并非只来自某个 CAIDA 年份的特殊分布。

---

#### 消融实验 (Ablation Studies)

这里必须非常严谨地说：

> ⚠️ **论文没有提供严格意义上的组件消融实验。**

也就是说，作者没有系统报告以下变体：

- 去掉 `dev = V - θP`，只保留时间保护；
- 去掉 temporal staleness，只保留 deviation eviction；
- 去掉 dynamic $\alpha\cdot currentWindow$ 保护；
- 用 flag 代替 $W$；
- 用随机/概率 replacement 替代确定性 replacement。

因此，我们**不能仅凭现有实验定量断言“哪个模块贡献最大”**。

现有证据只能做间接推断：

1. **Figure 3：小内存碰撞越重，Lasso 相对优势越大。** 这强烈支持 candidate replacement 机制是关键来源。
2. **Lasso-LL 对 Pandora/Stable-Sketch/Tight-Sketch 的提升**表明 temporal protection 本身也是有效的。
3. **Figure 9 与 Appendix Figure 14**属于参数鲁棒性，而不是消融；它们说明机制在不同 $W/\alpha/\theta$ 下稳定，但不能分离各组件的边际贡献。

如果我要补实验，最优先做的就是一个 2×2 ablation：

| Variant | Deviation eviction | Temporal protection |
|---|---|---|
| Base | ✗ | ✗ |
| A | ✓ | ✗ |
| B | ✗ | ✓ |
| Full Lasso | ✓ | ✓ |

然后在 16/32 KB 下比较 Recall、F1 和 eviction survival rate。这样才能真正回答“谁贡献最大”。

---

#### 具体实现的细节

##### CPU

- C++；
- MurmurHash；
- Intel Core i5-1135G7 @ 2.40 GHz；
- 16 GB DRAM；
- Ubuntu 20.04；
- 后续加入 SIMD 优化，加速 key compare 与 bucket update。

Figure 12 显示 SIMD 版本平均更新速度提升：

- 2015：20.63%；
- 2016：15.63%；
- 2018：10.51%；
- 2019：16.91%。

##### Tofino programmable switch

Table 2 报告的资源占用：

| Resource | Usage |
|---|---:|
| Hash Bit | 3.99% |
| Gateways | 20.83% |
| VLIW Instruction | 6.77% |
| Match Crossbars | 5.08% |
| Logical Table ID | 23.96% |
| SRAM | 3.75% |
| Pipeline Stages | 10 |

Figure 13 在 CAIDA 2018/2019 上把 bucket 数从 1,024 增到 16,384；即便只有 1,024 buckets，F1 仍至少约 0.8。

![论文 Figure 13：Tofino 上的检测精度](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/figure13_tofino_accuracy.png)

这部分最重要的结论不是单个 F1 数字，而是：**算法确实能塞进 Tofino 固定 pipeline 深度与 SRAM 约束中。**

##### FPGA

Xilinx Zynq UltraScale+ MPSoC XCZU2EG 上：

| Metric | Value | Available | Utilization |
|---|---:|---:|---:|
| LUTs | 11 | 47,232 | 0.02% |
| FFs | 25 | 94,464 | 0.03% |
| I/O pins | 20 | 252 | 7.94% |

post-route timing 显示最大频率 **666.7 MHz**，且可做到 **one item per cycle**，对应峰值 **666.7 Mops**。

不过这里后文还会讨论：Table 3 只列出了 LUT/FF/I/O，没有把 BRAM/URAM 等状态存储资源完整展开，因此“FPGA 总资源开销极低”这个结论需要稍微保留。

---

#### Appendix 的补充鲁棒性实验

Appendix A.3 在 CAIDA 2019 上把窗口设为 200、$\alpha=0.2$，改变 $\theta=1.1,1.2,1.3$。Lasso 相对 PSSketch 的 F1 提升分别为 **57.46%、45.69%、47.88%**，同时 ARE 更低。

![论文 Figure 14：不同 threshold 下的鲁棒性](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/figure14_threshold_robustness.png)

这进一步说明它不是只在正文默认的 $W=100,\alpha=0.4$ 点上有效。

---

### 5. 讨论与思考 (Discussion and Reflection)

#### 优点与创新点 (Strengths & Innovations)

##### 5.1.1 问题定义与 replacement policy 高度一致

很多 sketch 论文先设计一个通用结构，再尝试证明它适合目标任务；Lasso 反过来，直接从 long-lived sparse 的定义

$$
f\le\theta p
$$

推导出

$$
V-\theta P
$$

作为淘汰依据。这种“**把目标集合的判定边界变成内存竞争规则**”非常干净。

##### 5.1.2 时间信息的利用方式简洁

$W$ 同时承担两个功能：

1. 判断当前窗口内是否已经增加过 persistence；
2. 计算连续缺席 gap。

一个字段解决 flag reset + staleness 两个问题，工程上很漂亮。

##### 5.1.3 真正做到了 algorithm–hardware co-design

论文不是把软件算法简单搬到 P4，而是在设计阶段就主动避免：

- floating point；
- division / exponentiation；
- probabilistic replacement；
- variable-length hierarchical counter；
- control-plane flag reset。

这种“从操作集合出发约束算法”的方法，对做 programmable switch、SmartNIC、FPGA、PIM 的研究都很有参考价值。

##### 5.1.4 实验结论比较诚实

作者没有隐藏一个关键事实：**内存足够大时 PSSketch 可能更准**。这反而让论文的主张更可信——Lasso 优化的是受限环境下的 accuracy–throughput–deployability 三者平衡，而不是声称在所有资源区间都绝对占优。

---

#### 局限性与可商榷之处 (Limitations & Debatable Points)

##### 5.2.1 缺少真正的组件级 ablation

这是我认为实验上最大的缺口。论文提出四个 design principles，但最终几乎全部打包进一个 Full Lasso 与 baseline 比较。

因此，我们知道“Lasso 整体有效”，却不知道：

- deviation eviction 单独值多少 F1；
- temporal protection 单独值多少；
- dynamic threshold 与 gap rule 是否存在冗余；
- 两个机制是否有互补增益。

对于一篇强调机制设计的论文，这是比较明显的可改进点。

##### 5.2.2 理论假设与真实网络流量之间存在距离

理论分析采用 Poisson arrival 和 uniform hashing 等标准假设。这有助于得到可解析上界，但真实网络流量往往具有：

- burstiness；
- temporal correlation；
- diurnal pattern；
- adversarial key distribution；
- elephant/mice 混合分布。

因此 Theorem 4.1 更像是“机制的理论合理性证明”，而不是对真实 trace error 的精确预测模型。

##### 5.2.3 窗口实现与“真实时间”的关系值得进一步讨论

Algorithm 1 用全局 arrival counter $C$ 和 window size $G$ 计算：

$$
currentWindow=\left\lceil\frac{C}{G}\right\rceil.
$$

这在实现上非常方便，但本质上是**基于到达数量划分窗口**。如果业务语义需要固定 wall-clock 时间窗口，而流量速率剧烈变化，那么 count-based window 与 time-based persistence 可能并不完全等价。

一个自然的后续问题是：是否可以使用硬件 timestamp / coarse clock，在不增加过多代价的情况下支持真正的时间窗口。

##### 5.2.4 Query 是线性扫描，在线 reporting 成本没有被重点讨论

论文的 Query 操作会扫描全部 bucket，检查

$$
P\ge\alpha W,\qquad V\le\theta P.
$$

更新路径极快，但如果系统需要高频、实时地输出全部 long-lived sparse items，扫描成本和结果导出成本可能成为另一个瓶颈。论文重点评估的是 update path，对 query frequency / query latency 的讨论较少。

##### 5.2.5 Tofino recirculation 可能带来隐藏成本

为了满足 register access 限制，Lasso 使用两次 pass。论文说明 loopback 不占外部端口带宽，这是合理的；但从系统角度仍应继续问：

- 每个 packet 都 recirculate 时，内部 recirculation capacity 是否足以覆盖最坏情况 line rate？
- 对 pipeline occupancy、latency、其他共存 P4 workload 的影响是多少？
- 是否存在 packet size / traffic pattern 下的瓶颈？

论文给出了资源 footprint 与检测精度，但没有像 CPU/FPGA 那样给出同等详细的实测 Tofino throughput 曲线，这使“line-rate practicality”的证据仍有进一步加强空间。

##### 5.2.6 FPGA 资源表没有完整呈现状态存储成本

Table 3 中只列出 LUT、FF、I/O pins，而 Lasso 仍然需要存储大量 bucket state。若这些状态主要落在 BRAM/URAM/on-chip memory，中大型 sketch 下的实际 memory block 消耗值得单独报告。

因此，“逻辑资源几乎为零”是真实的一个侧面，但还不是 FPGA 总资源成本的完整图景。

##### 5.2.7 Baseline 范围偏窄

long-lived sparse 主任务只与 PSSketch 做核心比较。作者的理由是 PSSketch 已代表当前 SOTA，这在论文篇幅上说得通，但会留下两个问题：

1. 不能直观看到 Lasso 相对 PISketch 等更简单方法的“复杂度—性能”完整 Pareto 前沿；
2. 硬件实验中又因为 PSSketch 不适合部署而没有同平台基线，于是 Tofino 上更多证明了“Lasso 可行”，而不是“Lasso 在同一硬件上优于另一种已部署方案”。

---

#### 未来工作与启发 (Future Work & Inspirations)

##### 5.3.1 把 replacement policy 学成“可解释的多证据打分”

Lasso 已经把两个维度用得很好：

- sparsity evidence：$V-\theta P$；
- temporal evidence：$currentWindow-W$。

下一步可以探索仍保持硬件友好的第三类证据，例如：

- inter-arrival gap 的粗粒度分桶；
- recent-window count 的饱和计数；
- key class / tenant / prefix 的先验；
- 多时间尺度 persistence。

关键不是上复杂模型，而是保持“整数比较 + 少量 bit state”的部署属性。

##### 5.3.2 多时间尺度 Lasso

现实中的“长期”可能同时包含分钟、小时、天三个尺度。单一 $W$ 和 $\alpha$ 会把不同时间尺度揉在一起。

可以考虑维护两到三个 very-low-bit temporal states，在同一 bucket 中形成短/中/长期 persistence evidence，再用分层判定降低 threshold sensitivity。

##### 5.3.3 研究 adversarial robustness

目前分析更偏随机碰撞。如果攻击者知道 hash 或大致 replacement rule，是否可以通过精心构造的 transient keys 持续撞击目标 bucket？

值得研究：

- secret/rotating hash seeds；
- 多 epoch hash；
- collision budget；
- attack-aware replacement protection。

这对“用 Lasso 检测安全威胁”尤其重要，因为检测算法本身也可能成为对手的攻击面。

##### 5.3.4 从“检测”走向“解释”

当前输出只是哪些 key 属于 long-lived sparse。实际安全运营往往还需要：

- 什么时候开始变得 persistent？
- sparsity 是否突然改变？
- 最近的 gap pattern 如何？
- 是稳定低频，还是周期性 burst？

如果在不破坏硬件约束的情况下保留极少量可解释特征，Lasso 可以从一个 detector 变成在线 triage primitive。

---

#### 对研究工作的几条方法论启发

1. **设计 sketch 时，replacement policy 往往和 counter 本身一样重要。** 在小内存场景，真正的难点是“谁能留下”，不只是“留下后怎么数”。
2. **把任务约束写成不等式，再看能否直接变成在线 score。** Lasso 从 $f\le\theta p$ 到 $V-\theta P$ 是很典型的例子。
3. **硬件约束可以反过来创造算法创新。** “不能 reset、不能浮点、不能复杂控制流”并非纯限制，它迫使作者找到更简洁的状态表达。
4. **不要把 robustness 当 ablation。** 改 $\alpha/\theta/W$ 证明的是超参数稳定性；只有移除/替换组件，才能说明组件因果贡献。
5. **性能优势要放在正确的资源区间里解释。** Lasso 并非在 256 KB 时仍绝对领先，但在 16–128 KB + 高吞吐 + 可部署场景更有价值。

---

#### 建议继续追问的几个问题

- 🤔 **为什么作者选择 `gap > P` 作为 stale 条件？是否存在可优化的比例形式，例如 `gap > βP`？**
- 🤔 **如果 $\theta$ 随时间变化，是否可以做在线 adaptive sparsity threshold？**
- 🤔 **如果窗口改成真实时间 timestamp，而不是基于全局 packet count 的 $G$，Tofino 实现代价有多大？**
- 🤔 **是否可以设计无需 recirculation 的单 pass 近似版本，以换取极限线速？**
- 🤔 **在 adversarial collision 下，Lasso 的保护机制是否仍然稳定？**
- 🤔 **如果任务从 source-IP 扩展到 5-tuple、user ID、query ID，key 宽度增加会怎样改变 SRAM / pipeline trade-off？**
- 🤔 **组件级 ablation 是否会显示 deviation eviction 主要提升 Recall，而 temporal protection 主要降低 estimation error？** 这是很值得复现实验验证的假设。

---

## 总结

Lasso 最值得记住的不是某一个 F1 数字，而是一种非常清晰的系统化思路：

> **先找到目标模式的定义性统计关系，再把它转化为内存竞争中的替换规则；同时利用最小时间状态保护真正的长期对象，最后主动把所有操作压缩到受限硬件能够高吞吐执行的集合中。**

从结果看，这一思路在 **16–128 KB 的强资源约束区间**尤其有效：Lasso 用更简单的结构获得比复杂 PSSketch 更高的 F1、更低的 ARE 和更高的 update speed；而在内存充足时，PSSketch 的复杂 counter 设计又可能重新取得精度优势。这说明本文真正建立的是一个新的 **accuracy–memory–throughput–deployability Pareto point**。

如果把它作为博士生阅读材料，我会把论文的核心评价概括为：

**“机制非常干净，硬件协同设计扎实，实验覆盖面广；但组件级因果验证、真实时间窗口、Tofino 吞吐证据和硬件存储资源报告仍有继续补强的空间。”**

---

## 参考链接

- 论文 DOI：<https://doi.org/10.1145/3770855.3818048>
- KDD 2026 Papers：<https://kdd2026.kdd.org/papers/>
- Lasso GitHub：<https://github.com/WeiheLi/Lasso/>
- CCF 推荐国际会议目录：<https://www.ccf.org.cn/Academic_Evaluation/DM_CS/>
- CAIDA Dataset Catalog：<https://catalog.caida.org/dataset>
