---
layout: post
title: "SWVFM：面向高速网络滑动窗口流基数测量的区间噪声消除方法——论文阅读笔记"
date: "2026-09-21 01:54:36"
updated: "2026-09-21 15:47:22"
permalink: papers/swvfm/
categories: ["论文阅读"]
tags: ["Sketch","滑动窗口","基数估计","可编程网络"]
excerpt: "SWVFM 将经典 FM 基数估计器改造成带时间戳的滑动窗口结构，再用虚拟寄存器共享支持海量并发流，并通过按流基数区间经验校准碰撞噪声，在静态、紧凑内存下显著提升多流滑动窗口基数估计精度。"
disableNunjucks: true
comments: false
---

> 论文：**SWVFM: Ranged Noise Removal for Sliding-window Flow Cardinality Measurement in High-speed Networks**  
> 作者：Haibo Wang, Guoju Gao, Zibo Liu, Gongming Zhao, Aayush Karki  
> 阅读定位：网络测量 / Data Plane Sketch / Sliding Window / Flow Cardinality / P4  
> 本文重点：不是泛泛复述，而是沿着 **“为什么固定窗口不够 → 为什么 VATE 会崩 → SWVFM 如何把 FM 搬到滑动窗口 → 虚拟寄存器共享如何产生噪声 → 为什么必须做分区间噪声校准”** 这条技术链路展开。

---

## 开头：论文发表信息、CCF 级别与开源情况

- **发表时间**：PDF 页眉标注为 **Sep. 2026**，首页版权说明中写明该文已被接收（accepted for publication），DOI 为 **10.1109/TON.2026.3733983**。
- **发表期刊**：**IEEE/ACM Transactions on Networking (ToN)**；论文版权说明中也出现 *IEEE Transactions on Networking* 的表述。本文以下统一简称 **ToN**。
- **CCF 级别**：**CCF A 类期刊**。中国计算机学会官网的公开活动介绍中明确将 IEEE/ACM Transactions on Networking 列为 CCF 推荐 A 类期刊。
- **论文入口**：[DOI: 10.1109/TON.2026.3733983](https://doi.org/10.1109/TON.2026.3733983)
- **CCF 级别参考**：[CCF 官网公开页面（提及 ToN 为 CCF A）](https://www.ccf.org.cn/Member_Activities/2026-01-26/859615.shtml)
- **是否开源**：论文明确说明实现了 **P4 原型**，但**论文正文没有给出官方代码仓库地址**。截至本笔记撰写时，通过论文标题、SWVFM、作者名等关键词检索，也**未发现可确认属于该论文作者团队的官方 GitHub/代码仓库**。因此目前应按“**论文实现已完成，但代码尚未公开或未公开索引**”理解，而不要把第三方同名仓库误认为官方实现。

> 📌 一个容易混淆的点：论文的“hardware implementation”主要证明 **SWVFM 的在线记录过程可以映射到 P4 数据平面**；完整查询与 ranged-noise 校准仍放在控制平面执行。因此“P4 实现”不等价于“整套估计算法都在交换机流水线内完成”。

---

## 1. 摘要 (Abstract) 与核心贡献 (Core Contribution)

### 一句话总结

**SWVFM 将经典 FM 基数估计器改造成带时间戳的滑动窗口结构，再用虚拟寄存器共享支持海量并发流，并通过按流基数区间经验校准碰撞噪声，在静态、紧凑内存下显著提升多流滑动窗口基数估计精度。**

### 贡献列表 (Contribution List)

- **贡献 1：把 FM 从固定窗口扩展到滑动窗口。** 作者把 FM sketch 中的每个 bit 替换成时间戳：查询时只把仍落在当前滑动窗口内的时间戳“投影”为 1，从而得到当前窗口对应的 FM sketch。
- **贡献 2：把单流 SW-FM 虚拟化为多流共享结构 SWVFM。** 每个 flow 逻辑上拥有一个含 `m` 个寄存器的虚拟 SW-FM，但这些虚拟寄存器被散列到一个公共物理寄存器池 `C`，从而避免“每个流单独维护一个 sketch”的不可承受内存开销。
- **贡献 3：提出 ranged noise estimation/subtraction。** 不再假设所有流受到同一均匀噪声，而是利用人工流（artificial flows）在当前真实寄存器池上“探测”不同基数区间的实际碰撞噪声，再按区间做减法校正。这是论文最核心的技术创新。

论文摘要与引言把这三点拆得很清楚：**timestamp 化、virtualization、ranged noise removal**，其中第三点是作者反复强调的主要 novelty。

---

## 2. 引言 (Introduction)：问题背景与研究动机

### 2.1 问题定义 (Problem Definition)

论文研究的是 **FC-SW（Flow Cardinality estimation in Sliding Window）**：

给定持续到来的包流，每个包表示为

$$
\langle f,e\rangle^t,
$$

其中：

- $f$：flow label，例如目的 IP、源 IP 或源-目的 IP 对；
- $e$：该 flow 内需要去重统计的属性，例如源 IP、目的 IP、端口等；
- $t$：到达时间。

在查询时刻 $T$，长度为 $N$ 的滑动窗口定义为

$$
[T-N+1,T].
$$

目标是：**对任意被查询 flow $f$，估计最近 $N$ 个时间单位内出现过多少个不同的属性 $e$。**

这个问题比普通 fixed-window cardinality 更难，因为系统不仅要记录新数据，还必须让已经过期的数据“自动失效”。而在高速网络里，算法还受到非常现实的硬约束：

- 数据平面 SRAM 很有限；
- 单包只能做常数次 hash / memory access；
- 最好使用静态数组，不能依赖动态链表或复杂内存分配；
- 多流规模可能达到十万、百万级，不能给每个流独享一个完整 sketch。

这就是论文真正的研究对象：**在硬件友好的静态内存模型下，做多流、滑动窗口、可任意时刻查询的 cardinality estimation。**

### 2.2 为什么滑动窗口比固定窗口更符合网络监测需求？

固定窗口把时间轴切成不重叠的块，例如 `[0,N-1]`、`[N,2N-1]`。问题在于真实事件不一定尊重窗口边界。

例如 DDoS、扫描行为或蠕虫传播可能从一个 fixed window 中间开始，在下一个窗口中间结束。这样攻击被拆成两个“看起来都不够大”的片段。你可以把 fixed window 设得更长，但这又会带来两个副作用：

1. 窗口内数据量变大，sketch 更容易饱和、碰撞更严重；
2. 只有到窗口结束才能看到完整结果，检测延迟增加。

滑动窗口直接回答“**现在往回看最近 60 秒发生了什么**”，这是网络在线检测天然更想问的问题。

### 2.3 现有方法的局限 (Limitations of Prior Work)

#### 路线 A：单流 Sliding-Window cardinality

LRU-LC、Sliding HyperLogLog、TardySketch、SHE 等方法可以处理单个 aggregate stream 的滑动窗口基数，但不能直接解决多流 FC-SW：

- 它们通常只输出一个全局 cardinality；
- 如果每个 flow 各实例化一个结构，内存会爆炸；
- 一旦让多个 flow 共享资源，就产生了新的 **inter-flow collision noise**，这是单流方法不需要处理的。

#### 路线 B：VATE —— 当前静态内存 FC-SW 代表方法

VATE 基于 Bitmap。Bitmap 的 cardinality 估计为

$$
\hat n=-m\ln\left(1-\frac{U}{m}\right),
$$

其中 $m$ 是 bit 数，$U$ 是已置 1 的 bit 数。

它的根本问题是：当 $U\to m$ 时，bitmap 接近全 1，估计范围迅速耗尽；当 $U=m$ 时更是直接饱和。论文将其最大有效范围近似写成

$$
n_{\max}\approx m\ln m.
$$

这意味着：如果要支持大 cardinality，就必须把 $m$ 做得很大。VATE 同时还需要一个足够大的全局 timestamp 数组 `A` 来估计背景噪声。因此在“数据流很大 + 内存很小”时，VATE 的两个 bitmap 估计过程都会承压。

**这正是 SWVFM 选择 FM 而不是 Bitmap 的核心动机：FM 的表示范围随寄存器深度呈指数增长，不容易像 Bitmap 那样在紧凑内存下迅速饱和。**

### 2.4 本文思路 (Overall Idea)

可以把 SWVFM 的思路理解为连续解决三个问题：

1. **时间问题**：FM 只能表示“出现过没有”，怎么知道元素是否已经过期？  
   → 把 bit 换成 timestamp。
2. **多流问题**：每个 flow 一个 SW-FM 太贵，怎么共享内存？  
   → virtual register mapping，让所有 flow 共用物理池。
3. **共享污染问题**：共享后别的 flow 会把我的寄存器写脏，怎么办？  
   → 不再假设“噪声对所有 flow 一样”，而是用人工流实测每个 cardinality 区间的噪声并做减法。

这条链路非常完整：**先保证可滑动，再保证可扩展，最后修复共享带来的偏差。**

---

## 3. 方法论深度解析 (In-depth Methodological Analysis)

## 3.1 整体架构 (Overall Architecture)

论文图 1 给出了 SWVFM 最关键的数据组织方式：上层是每个 flow 的**虚拟 SW-FM**，下层是共享的**物理寄存器池 $C$**。

![论文图1：SWVFM 的虚拟-物理寄存器结构](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/fig1_swvfm_architecture.png)

### 3.1.1 数据结构

公共物理池写作

$$
C[0],C[1],\ldots,C[w-1],
$$

每个物理寄存器又包含 $b$ 个 timestamp：

$$
C[i][0],C[i][1],\ldots,C[i][b-1].
$$

因此物理结构本质上是一个 $w\times b$ 的 timestamp 矩阵。

每个 flow $f$ 逻辑上拥有一个虚拟 sketch

$$
V_f=[V_f[0],V_f[1],\ldots,V_f[m-1]],
$$

但 `V_f[i]` 并没有独立存储，而是映射到公共池中的某个物理寄存器：

$$
V_f[i]\longrightarrow C[H_i(f)].
$$

实现时不需要真的维护 $m$ 个独立 hash 函数，作者用主 hash $H^*$ 加随机种子数组 $R$：

$$
H_i(f)=H^*(f\oplus R[i])\bmod w.
$$

### 3.1.2 单包在线记录流程

对到达包 $\langle f,e\rangle^t$：

1. 用均匀 hash $h(e)\in[0,m)$ 决定它落入该 flow 的第几个**虚拟寄存器**；
2. 用 $H_{h(e)}(f)$ 找到该虚拟寄存器对应的**物理寄存器**；
3. 用 geometric hash $G(e)\in[0,b)$ 决定更新寄存器内部哪个层级；
4. 写入时间戳：

$$
C[H_{h(e)}(f)][G(e)] = t.
$$

因此每个包的工作量是常数级：论文理论分析给出 **3 次 hash + 1 次 memory write**。

### 3.1.3 查询流程

查询 flow $f$ 时，不需要原来的元素 $e$。系统只需枚举 $i=0,\ldots,m-1$，重新计算

$$
C[H_i(f)],
$$

即可“重建”这个 flow 的虚拟 SW-FM。

对每个 timestamp：

- 如果在 `[T-N+1,T]` 内，则视为 bit 1；
- 否则视为 bit 0。

这样，一个 timestamp sketch 在查询时被**瞬时投影**成普通 FM bit sketch。接下来就可以复用经典 FM 估计公式。

### 3.1.4 宏观设计的核心思想

SWVFM 的宏观创新不是重新发明一个完全不同的 cardinality estimator，而是把三种成熟思想组合在一起：

- FM：提供大动态范围；
- timestamp：提供 sliding-window 语义；
- virtual register sharing：提供多流共享内存。

真正新颖的部分在于：**作者意识到“虚拟化之后的噪声并不是流无关的常数”，并把噪声校准做成 cardinality-aware 的经验测量过程。**

---

## 3.2 核心组件/模块拆解 (Core Component Breakdown)

### 3.2.1 模块一：SW-FM —— 把 FM 的 bit 变成 timestamp

#### 输入和输出

- **输入**：单个 flow 中持续到达的元素 $e$ 及其时间 $t$；
- **输出**：查询时刻 $T$ 下最近 $N$ 个时间单位的 cardinality 估计。

#### 内部机理

经典 FM 只记一个 bit：某个 `(register, level)` 是否被命中过。

SW-FM 把

$$
F[i][j]\in\{0,1\}
$$

替换为

$$
F[i][j]=\text{最近一次命中该位置的时间戳}.
$$

查询时执行：

$$
F_{\text{bit}}[i][j]=
\begin{cases}
1, & T-N+1\le F[i][j]\le T,\\
0, & \text{otherwise}.
\end{cases}
$$

这一步的漂亮之处在于：**不需要显式删除每一个过期元素，只需要判断“最后一次命中是否还新鲜”。**

#### 设计动机

如果使用传统“按时间 bucket 切片”方案，会需要多个子 sketch 或额外 merge；而 timestamp 化可以直接在每个 FM cell 中保存 freshness。代价是每个 bit 从 1 bit 膨胀成 $k$ bit timestamp，因此论文后面专门讨论 compact timestamp `AT`。

---

### 3.2.2 模块二：Virtual Register Mapping —— 用共享换内存

#### 输入和输出

- **输入**：多 flow 数据流；
- **输出**：每个 flow 都拥有一个逻辑 SW-FM，但物理内存只维护一个全局池 $C$。

#### 内部机理

每个 flow $f$ 的第 $i$ 个虚拟寄存器被映射到

$$
C[H_i(f)].
$$

因为不同 flow 的 hash 可能指向同一个物理寄存器，所以同一个 `C[j]` 会被许多 flow 共享。

论文图 2 直观展示了这一点：flow $f$ 的 $V_f[2]$ 和 flow $f'$ 的 $V_{f'}[1]$ 都映射到了 `C[4]`。

![论文图2：两个 flow 映射到同一物理寄存器并产生碰撞噪声](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/fig2_register_collision.png)

#### 设计动机

真实网络流通常呈 heavy-tail：

- 大量小流；
- 少数大流贡献大部分 distinct items。

如果每个小流都独享 `m×b` 的结构，大部分空间都被浪费。共享寄存器池相当于让“小流空闲出来的容量”被其它 flow 复用。

#### 代价：inter-flow noise

共享不是免费的。对 flow $f$ 来说，重建出来的 $V_f$ 中可能包含其它 flow 写入的时间戳，因此从 $V_f$ 得到的原始估计

$$
\hat n_{V_f}
$$

并不是 $f$ 自己的 cardinality，而是“**目标 flow + 碰撞污染**”的混合结果。

因此系统必须解决：**如何估计并减掉 noise？**

---

### 3.2.3 模块三：Ranged Noise Subtraction —— 本文最核心创新

#### 先看失败方案：uniform noise

论文先构造了一个 basic version：假设总 distinct count 为 $S$，所有数据均匀落到 $w$ 个物理寄存器，那么一个 flow 的 $m$ 个虚拟寄存器平均会承受

$$
\frac{m}{w}S
$$

的背景污染。

于是可以从 $\hat n_{V_f}$ 中减去全局平均噪声。

问题是：**真实网络流并不均匀。** heavy-tail 分布下，一个巨流会猛烈污染它命中的几个寄存器，而很多小流只产生很轻的污染。因此噪声取决于：

- 目标 flow 自身 cardinality；
- 它命中了哪些物理寄存器；
- 这些寄存器又被哪些其它 flow 共享；
- 当前整个流量分布是否偏斜。

论文 Table 17 / Figure 9 直接证明了 uniform noise 会导致明显的 cardinality-dependent bias。

![论文图9：uniform noise 与 ranged noise 的散点分布对比](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/fig9_noise_ablation.png)

#### 核心做法：用人工流“探测”当前噪声场

作者不是尝试推导一个复杂的解析噪声模型，而是采用**经验校准**：

1. 选择一个目标 cardinality $i$；
2. 生成若干人工 flow $f'$，令其真实 cardinality 为 $i$；
3. 把人工 flow 只记录到一个**新的 auxiliary SW-FM** 中，得到无污染估计 $n_{\text{original}}$；
4. 再把 auxiliary SW-FM 与当前 live pool `C` 中该人工流会映射到的物理寄存器合并；
5. 合并后得到 $n_{\text{combined}}$；
6. 两者差值就是该 cardinality 在当前碰撞环境中遭遇的噪声样本。

关键点：**人工流不会写入 live pool `C`。** `C` 只作为 read-only 的“背景噪声场”，所以校准不会反过来污染真实 sketch。

---

## 3.3 关键公式与算法 (Key Equations and Algorithms)

### 3.3.1 关键公式一：从 SW-FM 恢复 FM cardinality

普通 FM 的估计公式为

$$
\hat n = \frac{m}{\phi}\cdot 2^{\frac{1}{m}\sum_{i=0}^{m-1}z_i},
$$

其中：

- $m$：FM register 数；
- $z_i$：第 $i$ 个寄存器从最低位开始连续为 1 的长度；
- $\phi$：FM 的修正常数，$m$ 足够大时约为 0.78。

在 SWVFM 中，先把 timestamp 根据是否在 sliding window 内转换为 bit，再计算目标 flow 虚拟 sketch 的

$$
\hat n_{V_f}=\frac{m}{\phi}\cdot 2^{\frac{1}{m}\sum_{i=0}^{m-1}z_i}.
$$

#### 公式的目标

估计“被映射到目标 flow 虚拟寄存器集合中的 distinct 元素数”。

#### 直觉

FM 利用 geometric hash：高 level 被命中的概率指数下降。看到连续 1 延伸得越高，意味着 distinct 元素越多。多个 register 取平均，是用空间换方差。

#### 重要提醒

这里的 $\hat n_{V_f}$ **还不是目标 flow 的最终 cardinality**，因为它包含其它 flow 的碰撞污染。SWVFM 的真正难点不是 FM 公式本身，而是后面的 noise removal。

---

### 3.3.2 关键公式二：point noise → ranged noise → 最终校正

对 cardinality 为 $i$ 的人工流 $f'$：

$$
o_i \approx n_{\text{combined}}-n_{\text{original}}.
$$

严格地说，论文会对多个相同 cardinality 的人工 flow 重复实验，再取平均，得到 point noise $o_i$。

#### point noise 的含义

它回答的是：

> “如果现在有一个真实 cardinality 约为 $i$ 的 flow，被随机映射到当前这份物理寄存器池，它平均会被背景碰撞抬高/拉低多少？”

作者随后把 cardinality 轴分成若干区间

$$
[r_0,r_1), [r_1,r_2),\ldots,[r_{k-1},r_k),
$$

并定义第 $k$ 个区间的 ranged noise：

$$
\alpha_k=
\frac{1}{r_k-r_{k-1}}
\sum_{j=r_{k-1}}^{r_k-1}o_j.
$$

查询 flow $f$ 时，若原始估计满足

$$
\hat n_{V_f}\in[r_{k-1}+\alpha_k,\;r_k+\alpha_k),
$$

则最终输出

$$
\boxed{\hat n_f=\hat n_{V_f}-\alpha_k}.
$$

#### 为什么小流区间要更窄？

如果 ranged-noise 估计有误差 $\Delta\alpha_k$，对 flow 的相对误差贡献约为

$$
\frac{\Delta\alpha_k}{n_f}.
$$

同样 5 个元素的 noise error：

- 对 $n_f=10$ 的小流，是 50% 相对误差；
- 对 $n_f=10,000$ 的大流，只有 0.05%。

因此作者采用近似几何增长的区间：

`[1,20]`, `[21,50]`, `[51,100]`, `[101,200]`, `[201,500]`, `[501,1000]`, ...

本质是：**小流需要高分辨率校准，大流可以粗一些。**

### 3.3.3 Algorithm 3 的真正意义

Algorithm 3 可以看成一个“**在线环境校准器 + 普通查询器**”的二阶段过程：

```text
当前 live sketch C
      │
      ├── Step 1: 生成 artificial flows
      │            ↓
      │      测量不同 cardinality 的碰撞噪声
      │            ↓
      │      建立 ranged noise table {α1, α2, ...}
      │
      └── Step 2: 查询真实 flow f
                   ↓
             得到原始估计 n_Vf
                   ↓
             找到对应 cardinality range
                   ↓
             n_f = n_Vf - α_range
```

这里最值得注意的是：**噪声表不是永久有效的模型参数。** 论文明确要求：当 $m,w,b$、hash、timestamp width、window length 或 traffic distribution 明显变化时，应重新校准。

---

## 3.4 时间戳压缩：AT (Aging Timestamp)

普通 timestamp 如果要覆盖很长时间范围，需要 $\lceil\log_2(\mathcal N+1)\rceil$ bit。论文借用 VATE 中的 `AT` 机制，将状态限制在 `[0,2N]`，使每个 timestamp 只需

$$
k=\lceil\log_2(2N+1)\rceil
$$

bit。

对实验中的 $N=60$，只需 7 bit。

代价是软件版本需要周期性 `Clean()` 过期状态。论文提出把寄存器池分成 $N$ 个 segment，每个时间单位只清理一个 segment，从而把全量扫描摊销成每单位时间 $O(w/N)$。

这是一个工程上很重要的点：**算法的空间优势并不只来自 FM 本身，也来自 timestamp 表示被仔细压缩。**

---

## 3.5 理论分析与复杂度

论文给出了几个关键结论：

- **空间复杂度**：Algorithm 1/2 为 $O(wbk)$；带 ranged-noise table 后为 $O(wbk+r)$。
- **单包记录复杂度**：`3H + 1M`，其中 `H` 表示一次 hash，`M` 表示一次 memory access。
- **查询目标 flow**：访问固定的 $m\times b$ 个 timestamp，因此主项是

$$
O(mbM+mH).
$$

在 CAIDA 参数下 $m=128,b=12$，所以目标 flow 查询规模固定，不随最大 flow cardinality 线性增长。

相比之下，VATE 为支持最大 cardinality 约 144k 的 flow，需要把 per-flow virtual bitmap 做到约 200k entries，导致单 flow query 成本非常高。

### Theorem 2 的边界条件值得特别注意

论文声称 point noise $o_i$ 在

$$
i\ll S
$$

条件下近似为无偏噪声估计，其中 $S$ 是窗口内所有 distinct packets 的总量。

作者自己也强调：这只是一个**近似无偏论证**，并不是 distribution-free 的有限样本方差保证。其剩余误差取决于：

- traffic skew；
- memory compactness；
- flow cardinality 相对于总量 $S$ 的大小；
- artificial-flow sampling 数量。

这为后面的批判性讨论留下了很大的空间。

---

## 4. 实验设计与结果分析 (Experimental Design and Results Analysis)

## 4.1 实验设置 (Experimental Setup)

### 数据集 1：CAIDA

- 60 分钟真实美国 backbone 流量；
- 总计约 **1.32B packets**；
- flow label：destination IP；
- attribute：source IP；
- 每分钟约 **170k flows**；
- 每分钟约 **600k distinct packet attributes**；
- sliding window：**1 minute**；
- time unit：**1 second**。

其分布非常偏斜：论文指出约 **98.2% 的 flow cardinality ≤ 10**，同时存在一个 cardinality 达到约 144k 的大流。

### 数据集 2：E-commerce

- 2019 年 12 月电商评论数据；
- 约 **70M records**；
- flow label：product name；
- attribute：review user name；
- 总数据被均分成 360 个 time unit；
- sliding window 长度：60 units；
- 每个窗口平均约 **153k flows**；
- 首个完整窗口约 **6M distinct records**。

相较 CAIDA，它更“均衡”但总体 distinct 元素更多，寄存器竞争更重，因此是另一种 stress test。

### 主要参数

- FM virtual registers：$m=128$；
- timestamps per register：$b=12$；
- compact timestamp：$k=7$ bit；
- ranged-noise 区间：`[1,20]`, `[21,50]`, `[51,100]`, `[101,200]`, `[201,500]`, ...

### Baselines

- **VATE**：最主要、也是直接问题匹配的 FC-SW baseline；
- **rSkt2(HLL)**、**skJoin(HLL)**：只在固定窗口 case study 中比较，用来说明 SWVFM 降级到 fixed-window 场景后的竞争力；它们不能直接解决本文 FC-SW 目标问题。

### Metrics

1. **Average Absolute Error (AAE)**
2. **Average Relative Bias**
3. **Scatter plot**：真实 cardinality vs estimated cardinality
4. **Recording throughput**
5. **Query processing time per flow**

---

## 4.2 主实验结果 (Main Results)

### 4.2.1 CAIDA，10 MB

论文 Figure 3 / Tables 3-4 显示：

- `(0,10]`：AAE 从 VATE 的 86.2 降到 SWVFM 的 7.1，减少 **91.8%**；
- `(10,100]`：87.1 → 11.7，减少 **86.6%**；
- `(100,1000]`：85.5 → 22.2，减少 **74.1%**。

这正好验证了作者的方法假设：**VATE 的 bitmap 范围限制和 uniform-style noise 在紧凑共享内存下对小/中流影响很大，而 FM + ranged noise 更稳。**

但大流收益没那么夸张：例如 `(10^3,10^4]` 只从 117.3 降到 115.2。说明 SWVFM 的最大优势主要不是“所有区间都提升一个数量级”，而是**紧凑内存下的小/中流和高碰撞场景**。

### 4.2.2 CAIDA，1 MB / 0.5 MB

当内存从 10 MB 压缩到 1 MB、0.5 MB 时，VATE 的散点显著偏离 $y=x$；SWVFM 虽然误差也上升，但仍保持基本可用。

0.5 MB 下：

- `(0,10]`：751.2 → 77.9；
- `(10,100]`：760.8 → 78.6；
- `(100,1000]`：823.6 → 92.4；
- `(10^3,10^4]`：1063.2 → 209.2。

这组结果最有说服力，因为它直接对应论文的核心卖点：**hyper-compact memory**。

### 4.2.3 E-commerce：更高 contention 的验证

10 MB 下，SWVFM 相对 VATE 的 AAE 降幅为：

- `(0,10]`：**85.9%**；
- `(10,100]`：**85.7%**；
- `(100,1000]`：**82.4%**；
- `(1000,10000]`：**44.7%**；
- `(10000,max]`：**3.4%**。

在 0.5 MB 下，VATE 的估计误差达到 `> 10^5`，基本失效；SWVFM 仍能给出有限误差（AAE 约 899–1660）。

这个结果比 CAIDA 更能证明 ranged noise 的必要性，因为这里窗口内约有 6M distinct items，寄存器污染远比 CAIDA 严重。

---

## 4.3 消融实验 (Ablation Studies)

### 最关键的消融：Uniform Noise vs Ranged Noise

论文 Figure 9 / Table 17 对比 basic version 和 complete version：

![论文 Table 17 / Figure 10：ranged-noise 消融与 hash 敏感性](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/table17_fig10_ablation_sensitivity.png)

相对 bias：

| Cardinality range | Uniform noise | Ranged noise |
|---|---:|---:|
| (0,10] | 2.35 | 2.56 |
| (10,100] | -0.34 | -0.02 |
| (100,1000] | -0.25 | 0.00 |
| (1000,10000] | -0.07 | 0.00 |
| (10000,100000] | 0.05 | -0.01 |

### 这说明什么？

对 `(10,100]` 以上的流，ranged noise 几乎把系统性 bias 清零，尤其 `(100,1000]` 从 **-25% → 0**，非常直接地验证了作者的核心假设：

> **共享寄存器噪声不是 uniform 的；它和 flow cardinality 有关。**

从“方法论是否被实验验证”这个角度看，Table 17 是整篇论文最重要的一张表之一。

### 但 `(0,10]` 是一个非常值得追问的例外

最小流区间的 relative bias 并没有改善，反而从 2.35 上升到 2.56。也就是说，**ranged noise 并没有解决 ultra-small flows 的相对偏差问题。**

这点很重要，因为论文在动机里反复强调 stealthy scanner / low-rate behavior，而这类应用恰恰可能依赖小 cardinality。

作者主要用 AAE 强调 small-flow 改进：例如 CAIDA 10 MB 时 AAE 从 86.2 降到 7.1，这当然是巨大进步；但若真实 cardinality 本身平均只有约 1.34，那么 7.1 的 AAE 仍然不算“小”。

因此更准确的结论应该是：

- **SWVFM 显著降低小流的绝对误差；**
- **但最小 cardinality 区间的相对误差/相对 bias 仍然很大。**

这对安全检测阈值如何设置会产生实际影响。

---

## 4.4 参数敏感性

### Hash function

FNVHash / MurmurHash / BobHash / CRC32 的 AAE 分别约 41.4 / 42.3 / 41.6 / 41.9，变化 <2.2%。

说明算法主要依赖“足够均匀的 hash”，对具体 hash 选择不敏感。硬件上用 CRC32 是合理的，因为 P4 原生支持。

### $b$：每个寄存器的 timestamp 层数

固定内存 $M$ 时：

$$
w=\left\lfloor\frac{M\times 8}{k\times b}\right\rfloor.
$$

所以增加 $b$ 会减少物理寄存器数 $w$：

- $b$ 太小：FM 动态范围不足，大流饱和；
- $b$ 太大：$w$ 变小，flow 间碰撞增加。

论文发现 $b=12$ 是一个比较好的 knee point。

### $m$：每个 flow 的虚拟寄存器数

- 小流：较小 $m$ 更少碰撞；
- 大流：$m$ 太小又会产生 FM 饱和；
- $m$ 太大：共享池竞争反而更严重。

论文最终采用 $m=128$，并在 Table 19 中显示其对中/大流最平衡。

---

## 4.5 具体实现细节

### CPU 实验平台

- Intel Core i7-8700 3.2 GHz
- 16 GB memory

### P4 / FABRIC 原型

论文在 FABRIC testbed 上使用：

- 3 个 BMv2 switches；
- 3 个 Ubuntu 20.04 servers；
- P4 数据平面负责 packet recording；
- control plane 负责读取 `C`、重建虚拟寄存器和执行 noise subtraction。

### P4 中的 hash 与 geometric sampling

FM 需要 geometric hash $G(e)$，传统实现通常数 leading zeros，但 P4 并不方便直接做这种操作。

作者采用：

1. CRC32 得到随机 bits；
2. 取高位 bits 作为 lookup-table index；
3. 查表近似实现

$$
P(G(e)=k)=\frac{1}{2^{k+1}}.
$$

这样就避免了复杂 bit operation，同时保持 FM 需要的几何分布。

### 硬件资源

论文 Table 1 给出的一个典型 P4 配置：

- SRAM：约 64 KB；
- TCAM：1 entry；
- 1 个 register array；
- 1 个 geometric hash lookup table；
- pipeline：4–5 stages。

另一方面，针对 CAIDA 的软件/AT 配置，论文给出的主 sketch 内存约 **1.3 MB**。这两个数字对应的是不同参数设置，不应混为一谈。

### Throughput 与 Query latency

在 5 MB、CAIDA、CPU 对比下：

- **Recording throughput**：SWVFM 10.6 Mpkt/s，VATE 15.4 Mpkt/s；
- **Query time / flow**：SWVFM **0.020 ms**，VATE **1.685 ms**。

也就是说，SWVFM 在线写入略慢（多一次 hash），但查询约快 **84×**。

其原因是算法结构性的：

- SWVFM 每次只读固定的 $m\times b$；
- VATE 为覆盖最大 flow 需要非常大的 virtual bitmap，查询必须遍历大量 timestamps。

---

## 5. 讨论与思考 (Discussion and Reflection)

## 5.1 优点与创新点 (Strengths & Innovations)

### 优点 1：问题切得准，目标约束很真实

论文没有只追求一个更漂亮的 cardinality estimator，而是明确把问题限定在：

- multi-flow；
- sliding window；
- static memory；
- data-plane-friendly；
- compact memory。

这种问题定义非常“系统论文”：算法设计从一开始就在硬件约束下展开，而不是先做一个理论结构，最后再勉强映射硬件。

### 优点 2：FM + timestamp 的改造非常自然

把 bit 改成 timestamp 是一个简单但有效的抽象。它几乎保留了 FM 的核心统计性质，同时给每个 cell 增加 freshness 信息。

好设计往往就是这样：**不是堆很多新模块，而是对经典结构做最小必要改造。**

### 优点 3：ranged noise 的思想很实用

我认为这篇论文最有价值的不是“按区间减一个数”本身，而是更一般的思路：

> 当共享资源引起的误差高度依赖当前 workload distribution、难以建模时，可以把 live sketch 当成环境，用可控 probe 去经验测量误差场。

这类似 system calibration，而不是纯解析推导。对于高度偏斜且动态的网络流量，这种思路往往比追求一个过度理想化的闭式噪声模型更可靠。

### 优点 4：实验有针对性

两个数据集具有互补分布：

- CAIDA：极端 heavy-tail；
- e-commerce：更平衡但 distinct items 更多。

再叠加 10 MB / 1 MB / 0.5 MB 多档内存，实验确实在主动制造不同碰撞强度，而不是只在一个“舒服参数”下展示结果。

### 优点 5：作者明确交代 scope tradeoff

论文没有声称 SWVFM 在 fixed-window 场景也统治一切。Figure 11 反而承认：如果只要 fixed-window，小/中流上 rSkt2(HLL)、skJoin(HLL) 更好。

这种边界说明提升了论文可信度。

---

## 5.2 局限性与可商榷之处 (Limitations & Debatable Points)

### 局限 1：ranged-noise calibration 对 traffic distribution 有依赖

作者自己明确说，noise table 需要在以下情况重算：

- $m,w,b$ 变化；
- hash 变化；
- timestamp width 变化；
- window length $N$ 变化；
- traffic distribution 显著变化。

这意味着 ranged noise 并不是一个“训练一次永久使用”的 correction。对快速 non-stationary 网络来说，关键问题变成：

> **什么叫“distribution changed substantially”？多久校准一次才够？**

论文没有给出自动 change detection 机制。

### 局限 2：range boundary 是经验式的

`[1,20]`, `[21,50]`, `[51,100]` 等边界来自经验 point-noise profile。虽然作者给了“先 decade partition，再按噪声变化拆分”的建议，但仍是 heuristic。

如果部署环境从 CAIDA 类 heavy-tail 突然变成另一种 workload，现有 range 可能不是最优。

这也正是作者在 Future Work 里提出 **adaptive range partitioning** 的原因。

### 局限 3：最小流的 relative bias 仍然很大

这是我认为论文实验里最值得谨慎解读的一点。

Table 17 显示 `(0,10]` 的 relative bias 在 complete version 仍为 **2.56**，并没有因为 ranged noise 得到改善。

所以如果应用目标真的是“持续低速、每个短窗口只触达极少地址/端口的 stealthy scanner”，那么仅看 AAE 的改善还不够。建议后续研究加入：

- median relative error；
- quantile error；
- 小流分桶更细的 CDF；
- 在真实 scanner detection pipeline 上做 detection recall/precision。

否则“cardinality estimation 更准”到“安全检测更好”之间还缺一层应用验证。

### 局限 4：Theorem 2 的理论保证较弱

point-noise 近似无偏依赖 $i\ll S$，并且没有给出 distribution-free finite-sample bound。

这在超大流或极端 compact memory 时可能变成问题。也就是说，ranged noise 本质上仍是**经验统计校准**，理论层面还没有完全闭环。

### 局限 5：校准成本依赖“批量查询摊销”

论文复杂度分析把 Step 1 的 ranged-noise calibration 摊销到很多 flow query 上，这在批量分析场景合理。

但如果实际系统是：

- 只偶尔查少数几个 flow；
- 每次查询之间 traffic regime 已经变化；
- 必须频繁重新校准；

那么 amortization 可能没有论文给出的那么理想。

一个很实用的后续实验应该画：

**query batch size vs. amortized latency / accuracy**。

### 局限 6：P4 结果更像 feasibility prototype，而不是 ASIC 线速实测

论文在 FABRIC 上用的是 BMv2 software switches。它证明了：

- 所需操作可以用 P4 primitive 表达；
- pipeline stage 数量可控；
- register/hash 结构硬件友好。

但这和“真实 Tofino ASIC 在 100G/400G 下稳定线速运行”的证明还不是一回事。

更强的系统验证应包括：

- Tofino/Tofino2 真机；
- SRAM banking / register access conflict；
- control-plane dump `C` 的带宽；
- 大规模并发 query 对控制平面的影响。

### 局限 7：查询不在数据平面完全完成

SWVFM 的 hybrid architecture 是合理工程选择，但也意味着：

- packet recording 是 line-rate；
- cardinality query / noise subtraction 依赖 control plane。

因此其适用场景更像“高速记录 + 快速外部查询”，而不是“每个 packet 在交换机内部立刻得到 per-flow cardinality”。

这一区别对使用者非常重要。

---

## 5.3 未来工作与启发 (Future Work & Inspirations)

论文作者自己提出两个 future directions：

1. **Adaptive range partitioning**：在线学习 range boundary，避免手工离线划分；
2. **Distributed SWVFM**：多交换机独立维护 SWVFM，再设计 sketch merge 得到 network-wide cardinality。

在此基础上，我认为还有以下值得做的方向：

### 方向 A：把 ranged noise 做成在线 Bayesian / streaming calibration

当前 $\alpha_i$ 是区间平均噪声。可以进一步维护：

$$
P(\text{noise}\mid n_f,\text{load},\text{skew},\text{register occupancy})
$$

而不是一个单点均值。这样查询可以输出置信区间，而不是只给 point estimate。

### 方向 B：动态调整 $m$ 或多分辨率 virtual sketch

论文固定所有 flow 都用 $m=128$。但小流和大流对 $m$ 的最佳需求明显不同：

- 小流希望更小 $m$，减少 collision；
- 大流希望更大 $m$，避免 saturation。

因此一个自然方向是：**让 flow 的 virtual register budget 随估计规模自适应。**

### 方向 C：直接优化“应用目标”而非 cardinality error

例如 DDoS / scanner detection 真正关心的是：

- 超过阈值了吗？
- growth rate 是否异常？
- 过去几个 sliding windows 的趋势是否持续？

可以把 SWVFM 与 change-point detection、persistent spread detection 结合，评估最终 detection quality。

### 方向 D：多交换机 merge 的困难可能比想象中大

普通 HLL/FM sketch 常有较好的 merge 性，但 SWVFM 多了：

- timestamp semantics；
- virtual-to-physical collision；
- deployment-specific ranged noise table。

因此 distributed SWVFM 不能只简单地对 `C` 做 max/union；还要考虑不同交换机的 collision environment 是否可比。这个问题可能本身就足够成为一篇后续论文。

---

## 5.4 对研究工作的启发：我会记住的三个方法论点

### 启发 1：先区分“统计范围不足”和“碰撞噪声”

VATE 的问题不只是 collision，而是底层 Bitmap 的 estimation range 先天有限。SWVFM 首先换成 FM 解决 range，再做 noise correction。

这提醒我们做 sketch 设计时，要把误差来源拆开：

- estimator intrinsic bias / saturation；
- resource-sharing collision；
- time-window expiration；
- hash variance。

不同误差需要不同机制解决。

### 启发 2：shared-memory sketch 的核心往往不是“怎么共享”，而是“怎么去污染”

虚拟寄存器映射并不新，但一旦进入真实 heavy-tail traffic，均匀噪声假设很容易失效。

所以对任何共享 sketch，都值得先问：

> 噪声是否真的与 key size / frequency / cardinality 无关？

如果不是，就应该考虑 key-aware / range-aware correction。

### 启发 3：经验校准不是“不理论”，它是一种系统设计选择

SWVFM 没有强求对复杂碰撞分布写出精确闭式解，而是用 artificial flow 实测当前环境。

只要：

- probe 不污染 live state；
- calibration cost 可控；
- workload 变化时能及时重标定；

这种设计在工程上完全可能优于漂亮但失真的理论模型。

---

## 6. 建议进一步追问的几个问题

1. **为什么 ranged noise 在 `(0,10]` 没改善 relative bias？** 是 FM 本身的小基数偏差、区间太宽，还是 collision calibration 的离散性导致？
2. **如果 traffic distribution 每几秒就变化，噪声表多久重算一次？** 能否自动检测 noise profile drift？
3. **Artificial flow 的数量如何选？** 100 个/区间是否有置信区间依据？更少会损失多少精度？
4. **如果只查询少量 flow，Algorithm 3 Step 1 的 calibration 成本还划算吗？**
5. **真实 Tofino 上读取完整 `C` 到 control plane 的成本是多少？** 它会不会成为实际 query throughput 的新瓶颈？
6. **能否让小流和大流使用不同的 $m,b$？** 也就是做一个 size-adaptive SWVFM。
7. **多交换机情况下如何 merge 不同 collision environment 下的 SWVFM？** ranged noise table 还能否共享？

---

## 7. 最后总结

如果把这篇论文压缩成一句“值得记住的话”，我会写成：

> **SWVFM 的真正贡献不是简单把 FM 放进 sliding window，而是证明了：在多流共享 sketch 中，collision noise 对 cardinality 是非均匀的；与其用一个全局平均噪声强行修正，不如利用当前 live sketch 通过人工 probe 直接测量不同 cardinality 区间的噪声。**

从技术成熟度看，它具备一个很完整的系统研究闭环：

**问题定义 → 底层 estimator 选择 → sliding-window 语义 → 多流虚拟化 → collision correction → 理论复杂度 → P4 feasibility → real trace evaluation。**

它最强的实验结论是：在 0.5–1 MB 这种极紧凑内存下，VATE 会因 Bitmap estimation range 和高 contention 明显失效，而 SWVFM 仍保持可用；同时 query latency 大幅降低。

但读者不应忽略三个边界：

1. ranged-noise table 依赖 workload，需要重校准；
2. ultra-small flow 的 relative bias 仍明显；
3. P4 部分主要证明数据平面 recording feasibility，完整 query/calibration 仍依赖 control plane。

因此，SWVFM 很适合作为“**如何把概率 sketch 真正做成 hardware-aware streaming system**”的案例来读，而不仅仅是一篇 cardinality estimation 论文。

---

## 参考入口

- 原论文 DOI：<https://doi.org/10.1109/TON.2026.3733983>
- CCF 官网关于 ToN 为 A 类期刊的公开说明：<https://www.ccf.org.cn/Member_Activities/2026-01-26/859615.shtml>
- CAIDA 数据集（论文 Ref. [41]）：<https://www.caida.org/data/passive/passive_2015_dataset.xml>
- E-commerce 数据集（论文 Ref. [42]）：<https://www.kaggle.com/datasets/mkechinov/ecommerce-behavior-data-from-multi-category-store>

> 注：本文所有技术内容、公式、实验数字与图表解读均以用户提供的论文 PDF 为主要依据；“CCF 级别”和“是否发现官方开源仓库”部分结合公开网页检索补充。
