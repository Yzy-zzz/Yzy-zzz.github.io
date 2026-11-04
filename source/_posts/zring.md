---
layout: post
title: "ZRing：面向全动态数据流的加权基数估计 —— 论文阅读笔记与技术解读"
date: "2026-11-02 20:17:17"
updated: "2026-11-02 20:17:17"
permalink: papers/zring/
categories: ["Sketch","基数估计与超级传播者"]
tags: ["Sketch","基数估计"]
excerpt: "论文通过把加权元素映射到二维 Sketch，并让每个单元在有限环上进行模加/模减，使删除操作成为插入操作的代数逆；随后分别用 MLP 和动态 Martingale 估计器从 Sketch 状态恢复全动态数据流中的加权去重总和。"
disableNunjucks: true
comments: false
---

> 论文：**ZRing: A Dynamic Sketch for Weighted Cardinality Estimation in Data Streams**  
> 作者：Zhicheng Li, Pinghui Wang, Qiheng Song, Rundong Li, Tong Yang, Qun Huang  
> 阅读定位：数据流算法 / Sketch / Weighted Cardinality Estimation / Fully Dynamic Stream

---

### 开头：论文何时、何地发表？CCF 级别？是否开源？

这篇论文发表于 **KDD 2026（The 32nd ACM SIGKDD Conference on Knowledge Discovery and Data Mining）**，收录在 **KDD '26 Proceedings, Volume 1，pp. 759–770**。ACM 的 proceedings 元数据显示该卷于 **2026 年 4 月 20 日**正式发布；会议本身于 **2026 年 8 月 9–13 日**在韩国济州岛举行。因此，如果按“会议举行时间”说，是 2026 年 8 月；如果按 ACM proceedings 的出版元数据说，则是 2026 年 4 月。

- **会议**：ACM SIGKDD Conference on Knowledge Discovery and Data Mining（KDD '26）
- **CCF 级别**：**CCF A 类**，归属“数据库 / 数据挖掘 / 内容检索”方向。
- **论文 DOI**：[10.1145/3770854.3780289](https://doi.org/10.1145/3770854.3780289)
- **是否开源**：**是**。论文首页明确给出了公开代码资源。
- **源码 / Artifact**：[Zenodo 10.5281/zenodo.18059621](https://doi.org/10.5281/zenodo.18059621)
- **CCF 官方目录**：[数据库 / 数据挖掘 / 内容检索](https://www.ccf.org.cn/Academic_Evaluation/DM_CS/)

> 📌 **阅读结论先行**：这篇论文最核心的创新不是“用神经网络估基数”，而是先设计了一个**天然支持插入和删除的有限环 Sketch —— ZRing**，再在这个 Sketch 上分别构造了两类估计器：一个偏工程与精度的 **ZRing-MLP**，一个偏理论、声称无偏的 **ZRing-DME（Dynamic Martingale Estimator）**。

---

## 1. 摘要 (Abstract) 与核心贡献 (Core Contribution)

### 一句话总结

**论文通过把加权元素映射到二维 Sketch，并让每个单元在有限环上进行模加/模减，使删除操作成为插入操作的代数逆；随后分别用 MLP 和动态 Martingale 估计器从 Sketch 状态恢复全动态数据流中的加权去重总和。**

### 贡献列表 (Contribution List)

- **提出 ZRing 动态 Sketch 结构**：将每次更新编码为有限环上的随机增量，通过模加与模减统一处理插入和删除，在固定空间内避免传统“每个桶维护精确计数器”所带来的数据量相关开销。
- **设计两类互补估计器**：
  - **ZRing-MLP**：从 Sketch 各列的非零占用率中学习加权基数，重点追求实际精度和分布式场景中的鲁棒性；
  - **ZRing-DME**：把 Sketch 演化建模为 Markov 过程，并将经典 Martingale Estimator 扩展到含删除的 fully dynamic stream，给出无偏性和方差分析。
- **在合成与真实数据上验证**：在相同内存预算下，相比 QSketch 及其动态扩展，ZRing 在多种分布、删除比例和数据规模上显著降低误差；论文报告在部分设置下可达到接近一个数量级的精度提升。

---

## 2. 引言 (Introduction)：问题背景与研究动机

### 2.1 问题定义 (Problem Definition)

经典 Cardinality Estimation 估计的是数据流中**不同元素的个数**：

$$
|E^{(t)}|.
$$

本文关注更一般的 **Weighted Cardinality Estimation, WCE**。每个数据值 $e_i$ 有一个固定正权重 $w_i>0$，只要该键当前至少存在一个有效实例，它就在答案中贡献一次权重：

$$
C^{(t)} = \sum_{e_i\in E^{(t)}} w_i.
$$

这里的关键是“**distinct + weight**”：同一个 key 即使在流中出现多次，也只能贡献一次 $w_i$；但当它的最后一个活跃实例被删除后，这个 $w_i$ 又必须从结果中撤销。

论文把每个物理出现实例写成 $(e_i,r)$：

- $e_i$：逻辑数据值 / key；
- $r$：该出现实例的唯一 row index，可理解为唯一记录 ID；
- $\sigma^{(t)}\in\{+1,-1\}$：插入或删除；
- 删除只能删除此前已经插入且尚未删除的同一 $(e_i,r)$。

因此，本文真正要解决的是：

> **在不能保存完整数据、只能维护一个很小 Sketch 的情况下，实时估计“当前仍然存在的 distinct key 的权重之和”，并同时支持插入和删除。**

这个问题在数据库去重聚合、网络流量统计、区块链日志分析中都很自然。例如 `SUM(DISTINCT key-weight)` 类型的查询，本质上就属于这一范畴。

### 2.2 现有方法的局限 (Limitations of Prior Work)

#### 路线 A：传统 Cardinality Sketch

FM、LogLog、HyperLogLog 等方法擅长回答“有多少不同元素”，但它们主要利用 hash 的极值或前导零统计，原始模型并不直接携带每个 key 的不同权重。

**痛点**：从“计数 distinct key”扩展到“对 distinct key 的权重求和”后，需要让权重参与随机映射过程，同时还要避免同一 key 的多次出现被重复累计。

#### 路线 B：已有 Weighted Cardinality 方法，例如 Lemiesz、FastGM、QSketch

QSketch 的核心做法是利用指数随机变量

$$
X=-\frac{\ln h(e)}{w}
$$

并量化为离散层级：

$$
y=\left\lfloor -\log_2 X \right\rfloor.
$$

权重越大，$X$ 越倾向于变小，因此 $y$ 越倾向于变大。换句话说，**权重被编码成“落在哪个离散层级”的概率分布**。

这类方法在 insertion-only 场景中效果很好，但一旦出现删除，问题马上变复杂：传统 `max` 型寄存器只知道“当前最大值是什么”，却不知道这个最大值到底由哪个历史元素贡献；删除某个元素后，很难恢复删除之前被它遮住的次大值。

一种直接补救是：**给每个 Sketch 单元再维护精确计数器**。但这会让空间开销依赖于更新次数或数据量，破坏 Sketch 最重要的“固定内存”优势。

### 2.3 本文思路 (Overall Idea)

作者的切入点非常漂亮：

> 与其让 Sketch 单元记录“最大值”或“精确出现次数”，不如让每次出现实例贡献一个随机的环上增量；插入做加法，删除同一实例就做减法。

只要增量是可复现的，就有：

$$
+a + (-a) \equiv 0 \pmod Z.
$$

于是，删除不再需要“回忆历史最大值”，而只是把之前的随机贡献抵消掉。

这就是 **ZRing** 的本质：**将动态集合维护问题转化为有限环上的可逆代数更新问题。**

---

## 3. 方法论深度解析 (In-depth Methodological Analysis)

### 3.1 整体架构 (Overall Architecture)

论文 **Figure 1（第 3 页）** 给出了完整流程。可以把它拆成三层：

```mermaid
flowchart TD
    A[动态数据流: e, w, r, sigma] --> B[ZRing 更新]
    B --> B1[g(e) 选行]
    B --> B2[y(e,w) 选列/层级]
    B --> B3[f(e,r) 生成环上随机增量]
    B3 --> C[R[g(e)][y] = R + sigma f mod Z]
    C --> D1[ZRing-DME]
    C --> D2[ZRing-MLP]
    D1 --> E[加权基数估计 C_hat]
    D2 --> E
```

具体来说：

1. **权重编码**：用指数变量和对数量化把 $(e,w)$ 映射到某个列索引 $y$；
2. **空间分片**：用 $g(e)$ 把 key 均匀映射到某一行；
3. **动态可逆更新**：用 $f(e,r)$ 为当前物理实例生成一个 $\mathbb{Z}_Z$ 上的随机值；插入加上它，删除减去它；
4. **估计阶段**：
   - DME 关注 Sketch 中“零单元数量如何发生变化”；
   - MLP 关注每一列有多少比例的单元为非零。

### 这个架构与传统方案的宏观区别

传统 QSketch 更像是“**每一行保存一个极值统计量**”，而 ZRing 更像是“**每一行、每个权重层级保存一个随机代数状态**”。

这个变化看起来只是数据结构上的改动，但它直接改变了动态更新的可行性：

- `max` 操作天然不可逆；
- 环上的 `+/-` 天然可逆。

这也是全文最重要的思想。

---

### 3.2 核心组件/模块拆解 (Core Component Breakdown)

### 3.2.1 模块一：ZRing Sketch 生成与动态更新

#### 输入和输出

输入一次操作：

$$
(e,r,\sigma,w), \qquad \sigma\in\{+1,-1\}.
$$

输出是一个 $m\times b$ 的 Sketch 矩阵 $R$ 的局部更新。每个单元保存：

$$
R[i][j]\in\{0,1,\ldots,Z-1\}.
$$

也就是说，每个单元不是一个任意大整数，而只是一个 **mod $Z$ 的环元素**。

#### 内部机理

作者使用三个 hash：

$$
g:X\rightarrow\{0,\ldots,m-1\},
$$

$$
h:X\rightarrow(0,1),
$$

$$
f:X\times \mathcal{R}\rightarrow\{0,\ldots,Z-1\}.
$$

其中：

- $g(e)$：决定当前 key 落到哪一行；
- $h(e)$：参与权重量化；
- $f(e,r)$：为某个具体出现实例生成可重复的随机环元素。

权重层级定义为论文 Eq. (4)：

$$
y(e,w)=\left\lfloor-\log_2\left(\frac{-\ln h(e)}{w}\right)\right\rfloor.
$$

随后只更新一个单元：

$$
R[g(e)][y(e,w)]\leftarrow
\left(R[g(e)][y(e,w)]+\sigma f(e,r)\right)\bmod Z.
$$

这就是论文 Eq. (5)。

#### 为什么权重可以这样编码？

令

$$
X=\frac{-\ln h(e)}{w}.
$$

因为 $h(e)\sim U(0,1)$，所以 $-\ln h(e)\sim \mathrm{Exp}(1)$，从而

$$
X\sim \mathrm{Exp}(\text{rate}=w).
$$

因此：

- $w$ 越大，$X$ 越倾向于靠近 0；
- $X$ 越小，$-\log_2X$ 越大；
- 所以大权重元素更容易命中较高的列 / bucket。

这意味着整个列占用分布实际上在编码**权重谱**，而不仅是 distinct key 数量。

#### 为什么模运算能处理删除？

对同一个物理实例 $(e,r)$：

- 插入：$+f(e,r)$；
- 删除：$-f(e,r)$。

因此两者完全抵消：

$$
f(e,r)-f(e,r)\equiv0\pmod Z.
$$

这比“为每个桶维护一个精确出现次数”更节省空间，因为每个单元始终只需要 $\log_2 Z$ 位。

#### 为什么重复 key 不会破坏分布？

如果同一个逻辑 key $e$ 有多个活跃实例 $r_1,\ldots,r_k$，它们都会落到相同的 $g(e)$ 和 $y(e,w)$，但贡献不同的 $f(e,r_l)$。

只要至少有一个未被抵消的活跃实例，若 $f$ 近似均匀，那么多个均匀随机变量在有限环上的和仍保持均匀分布。于是“一个 key 有 1 个实例还是多个实例”不会让该单元的值系统性偏向某个非零值。

这里真正被用于估计的是：

> **该单元是否为 0，而不是它具体等于几。**

一个“已经被有效元素占据”的单元，仍有概率 $1/Z$ 因为模加碰巧回到 0；所以：

$$
P(R[i][j]\neq0\mid \text{cell active})=1-\frac1Z.
$$

这也是后续 DME 中出现 $(1-1/Z)$ 的根源。

#### 设计动机

ZRing 的设计解决的是一个非常具体的问题：**动态删除中的历史恢复问题**。

- `max` / 极值型 Sketch 删除困难，因为需要知道“第二大是谁”；
- 可逆环加法不需要恢复历史，只要删除时能重新生成同一个 $f(e,r)$ 即可。

代价则是：模加可能“随机抵消”，导致活跃单元偶尔仍为 0。这是 ZRing 的主要噪声来源，而参数 $Z$ 控制这类噪声与内存之间的折中。

#### 可合并性：为什么它适合分布式场景？

如果多个数据节点使用**相同的 hash 函数和 Sketch 参数**，各自得到 $R^{(1)},\ldots,R^{(l)}$，则可以逐单元做模加：

$$
R^*[i][j]=\left(\sum_{k=1}^{l}R^{(k)}[i][j]\right)\bmod Z.
$$

这就是论文 Eq. (6)。由于每个本地 Sketch 本身就是“随机增量之和 mod $Z$”，所以先在本地累加、再跨节点累加，与把所有更新放在一个全局流中处理，在代数上是一致的。

这项性质很关键：

- 节点可以独立更新，不需要逐条通信；
- 查询时才合并 Sketch，通信量只与 Sketch 大小有关；
- 对 MLP 而言，可以**先合并再估计**，因此同一 key 同时出现在多个 owner 时不会像“直接相加各 owner 的估计值”那样必然重复计数。

---

### 3.2.2 模块二：ZRing-MLP —— 从列占用率学习加权基数

论文先尝试了一个基于概率模型的 MLE，但作者指出两个问题：

1. 每一行只保留“最大非零位置”会丢失大量结构信息；
2. MLE 近似中隐含假设总权重在各行近似均匀，当真实权重高度偏斜时容易产生系统偏差。

于是作者转向 MLP。

#### 输入和输出

对于每一列 $j$，计算非零比例：

$$
r_j=\frac1m\sum_{i=0}^{m-1}\mathbf{1}(R[i][j]\neq0).
$$

得到：

$$
\mathbf r=[r_0,r_1,\ldots,r_{b-1}].
$$

再拼接：

$$
\log m,\qquad \log Z.
$$

最终 MLP 输出 $\log \hat C$，而不是直接输出 $\hat C$。

#### 内部机理

为什么只看每一列的非零比例就有用？

因为不同权重的 key 会以不同概率落到不同的 $y$；当总加权基数变大时，各列的占用率会按不同速度上升。因此：

> **$\mathbf r$ 是一个离散化的“权重占用曲线”。**

MLP 的任务本质上是在学习：

$$
(r_0,\ldots,r_{b-1},m,Z)\longrightarrow C.
$$

这比只看“每行最大非零列”保留的信息更多，也能拟合列之间非线性关系。

#### 训练数据如何构造？

论文 Section 4.3.2–4.3.3 的训练数据设计很值得借鉴：

- 合成 weighted multiset；
- 每个元素随机复制 1–5 次；
- 总权重 $C_\Pi$ 在对数域中均匀采样：

$$
\log C_\Pi\sim U(\log C_{\min},\log C_{\max});
$$

- 权重分布覆盖 Uniform、Gaussian、Gamma、Zipf；
- 随机变化 $m$ 和 $Z$；
- 利用 ZRing 的可合并性，把多个 Sketch 合并，得到超过原训练上限的更大 cardinality 样本。

这实际上是在做一种非常有针对性的**算法数据增强**。

#### 模型结构

论文给出的默认结构为：

- 第一阶段 $l_1=5$ 个全连接层；
- 隐层宽度约为输入维度的 $8$ 倍；
- 第二阶段 $l_2=3$ 个压缩层，每层宽度约缩小为上一层的 $1/4$；
- 激活函数：LeakyReLU；
- 预测目标：$\log C$；
- 损失：对数域 MSE。

选择对数域训练非常合理，因为 Sketch 估计通常关注的是**相对误差**而不是绝对误差；将 $C$ 取对数可以显著压缩动态范围。

#### 设计动机

这部分最值得注意的一点是：作者并不是简单宣称“MLP 万能”，而是先明确指出 MLE 的两个建模偏差，然后用学习模型绕过显式 likelihood 的困难。

不过要准确表述：**MLP 并没有真的吃下完整 $m\times b$ 矩阵**。它把每列压缩成一个标量 $r_j$。因此它确实比“每行最大值”利用了更多信息，但仍然丢掉了行内和跨行的联合结构。论文中“从 full sketch structure 学习”的表述略显夸张。

---

### 3.2.3 模块三：Dynamic Martingale Estimator (DME)

MLP 精度高，但没有天然的无偏性保证，也依赖训练数据。因此作者又给出一条概率估计路线：把经典 insertion-only Martingale Estimator 推广到动态流。

#### 输入和输出

DME 在每次更新后维护一个在线估计：

$$
\hat C^{(t)}.
$$

如果当前更新导致 Sketch 状态改变，就按照“该变化发生概率的倒数”进行重要性加权。

#### 一般动态 Martingale 形式

论文 Eq. (9) 写成：

$$
\hat C_{\mathrm{DME}}^{(t+1)}
=
\hat C_{\mathrm{DME}}^{(t)}
+
\frac{\sigma^{(t)}w^{(t)}}
{q(S^{(t)},e^{(t)},\sigma^{(t)})}
\mathbf 1\big(S^{(t+1)}\neq S^{(t)}\big).
$$

直觉上，这是标准的“**被观察到才更新，并除以被观察到的概率**”思想：

- 一个真实贡献是 $w$；
- 但 Sketch 只有概率 $q$ 能感知这次贡献；
- 一旦感知到，就加 $w/q$；
- 因此期望仍然是 $w$。

这和 Horvitz–Thompson / inverse probability weighting 的直觉高度相似。

#### 删除如何处理？

作者定义：

$$
q(S,e,-1):=q(S,e,+1).
$$

也就是删除侧不重新恢复原始 insertion history，而使用与插入侧相同的转移概率模型。

这是整篇论文理论上最关键、也最值得仔细审视的假设之一。作者把它解释成一种“概念上的可逆对称性”，并给出 Theorem 2 声称 DME 对真实动态加权基数无偏。

---

### 3.3 关键公式与算法 (Key Equations and Algorithms)

### 公式一：权重量化 + 环上可逆更新

核心的两步是：

$$
y(e,w)=\left\lfloor-\log_2\left(\frac{-\ln h(e)}{w}\right)\right\rfloor,
$$

$$
R[g(e)][y(e,w)]\leftarrow
\left(R[g(e)][y(e,w)]+\sigma f(e,r)\right)\bmod Z.
$$

#### 公式目标

同时完成两件事：

1. 把连续权重 $w$ 编码到离散层级 $y$；
2. 让插入和删除在 Sketch 内部变成严格相反的代数操作。

#### 各部分含义

- $h(e)$：均匀随机 hash；
- $-\ln h(e)$：标准指数变量；
- 除以 $w$：让随机变量的 rate 由权重控制；
- $-\log_2$：把数量级转成离散层级；
- $g(e)$：横向分摊到不同 row；
- $f(e,r)$：对每个具体实例产生可复现随机环增量；
- $\sigma$：插入 $+1$，删除 $-1$；
- mod $Z$：保证每个单元固定只占 $\log_2 Z$ 位。

#### 公式直觉

可以把每个 Sketch cell 想成一个**小型环形表盘**：插入时随机转若干格，删除时反向转同样格数。我们不关心指针最终指向哪，只关心它是不是正好回到 0。

这样就把“复杂的动态历史”压缩成“当前表盘是否为 0”的概率问题。

---

### 公式二：ZRing 上的变化概率与 Martingale 修正

论文定义零单元总数：

$$
V(S)=\sum_{i=0}^{m-1}\sum_{j=0}^{b-1}\mathbf 1(R[i][j]=0).
$$

令 $Q[j]$ 表示第 $j$ 列中为 0 的单元个数，则论文 Eq. (10) 给出：

$$
q_V^{(t)}
=
\frac1m\sum_{j=0}^{b-1}
Q[j]\left(1-\frac1Z\right)P(y=j).
$$

其中：

$$
P(y=j)
=
\exp\left(-w2^{-(j+1)}\right)
-
\exp\left(-w2^{-j}\right).
$$

#### 公式目标

计算“当前这次更新能否让某个 0 单元变成非 0”的概率，以此作为 Martingale 的观测概率 $q$。

#### 各部分含义

- $Q[j]/m$：随机选中一个 row 后，第 $j$ 列恰好为 0 的概率；
- $P(y=j)$：当前权重 $w$ 被量化到列 $j$ 的概率；
- $(1-1/Z)$：即使目标 cell 被更新，模加后也有 $1/Z$ 概率仍为 0，因此真正观测到“0/非 0 翻转”的概率要乘这个因子。

#### 公式直觉

DME 并不需要知道每个 key 的完整历史。它只问：

> “如果这次更新真实改变了 active set，我的 Sketch 有多大概率会显式表现出一个 0↔非0 的变化？”

这个概率越小，说明一次被观察到的变化越“珍贵”，于是修正量就应该越大。

论文给出的方差形式为：

$$
\mathrm{Var}(\hat C_{\mathrm{DME}}^{(T)})
=
\sum_{t=1}^T
(w^{(t)})^2\frac{1-q_V^{(t)}}{q_V^{(t)}}.
$$

因此 $q$ 太小时，方差会迅速增大。这也解释了为什么合理的 $Z$、足够的内存和较好的 occupancy 状态对 DME 很重要。

> ⚠️ **论文公式一致性问题**：Figure 1、正文 Eq. (11) 与 Appendix A.5 在符号上并不完全一致。Figure 1 使用 $V^{(t+1)}-V^{(t)}$，但对插入来说零单元数通常下降，这会给出错误符号；正文 Eq. (11) 改成了 $V^{(t)}-V^{(t+1)}$，符号方向更合理，但公式中又明显漏掉了 $w^{(t)}$，而紧随其后的文字、Theorem 3 和 Appendix A.5 都表明增量应与 $w^{(t)}$ 成正比。这里更像是排版/公式笔误，阅读时应以 Eq. (9) 与 Appendix A.5 的统一逻辑为准。

---

## 4. 实验设计与结果分析 (Experimental Design and Results Analysis)

### 4.1 实验设置 (Experimental Setup)

#### 数据集

**合成数据**覆盖四类典型分布：

- Uniform
- Gaussian
- Gamma
- Zipf

它们分别覆盖相对均匀、集中、偏斜和重尾的权重模式。

**真实数据**包括：

- **TPC-H**：结构化数据库数据；
- **CAIDA**：网络流量；
- **XBlock-ETH**：以太坊交易数据。

论文将这些数据转为 weighted multiset：

- TPC-H 使用 quantity / price 等字段作为权重；
- CAIDA 按 flow 的 packet count 加权；
- XBlock-ETH 按交易转移值加权。

#### 基线

主要比较：

- QSketch
- QSketch-DME（作者将 DME 框架套到 QSketch 上形成的动态基线）
- ZRing-MLE（部分真实数据实验）
- ZRing-MLP
- ZRing-DME

在 CAIDA-1B 上还加入 insertion-only 方法：

- Lemiesz
- FastGM

需要注意：Lemiesz / FastGM 不支持删除，因此它们更多是“如果不承担 fully dynamic 代价，精度上限能有多高”的参考，而不是严格同条件基线。

#### 评价指标

论文使用：

$$
\mathrm{AARE}
=\frac1N\sum_{n=1}^{N}\frac{|\hat C_n-C|}{C},
$$

以及：

$$
\mathrm{RRMSE}
=
\sqrt{\frac1N\sum_{n=1}^{N}
\left(\frac{\hat C_n-C}{C}\right)^2}.
$$

此外还测量：

- update throughput（Mops）
- estimation latency（微秒）

---

### 4.2 主实验结果 (Main Results)

#### Figure 2：合成数据 + 不同内存预算

Figure 2 比较 2KB–32KB 内存下的 AARE。

最明显的结论是：

- ZRing-DME 基本始终最优；
- ZRing-MLP 次之；
- QSketch-DME 优于原始 QSketch，但仍显著落后于 ZRing；
- **内存越紧张，ZRing 的优势越大。**

例如论文在 Zipf-10k 上报告：

- ZRing-DME 相比 QSketch 和 QSketch-DME，AARE 分别低约 **8.17×** 和 **4.72×**；
- ZRing-MLP 分别低约 **3.85×** 和 **2.10×**。

这支持作者方法论里的一个核心假设：

> **ZRing 不需要为动态删除保存大范围精确计数，因此固定内存可以更直接地用于增加有效 Sketch 容量；内存越紧，这个优势越明显。**

#### Figure 3：真实数据 + 数据规模扩展

Figure 3 固定内存为 16KB，把数据规模从 1K 扩到 10M。

一个很有意思的现象是：ZRing 的误差并没有随着数据变大而恶化，反而总体变好。论文解释为：样本越多，极端值和偶然碰撞对整体统计的影响被稀释。

在 10M 规模上，论文报告：

- ZRing-MLP 相比 QSketch / QSketch-DME 的 RRMSE 改善约 **5.86× / 4.67×**；
- ZRing-DME 改善约 **10.71× / 8.65×**。

这里还有一个非常关键的对照：

> **ZRing-MLE 与 QSketch 的精度相近。**

这说明“换成 ZRing 数据结构”本身并不会自动带来全部精度提升。真正显著的增益主要来自：

1. ZRing 让动态更新变得更空间高效；
2. **新的 estimator（尤其 DME / MLP）更充分利用了 ZRing 的统计结构。**

这是理解论文贡献主次的重要证据。

#### Figure 4：CAIDA-1B 大规模网络流量

Figure 4 是 ARE 箱线图。

- insertion-only 的 Lemiesz / FastGM 误差最低，这是合理的，因为它们不用承担删除支持的代价；
- 在 fully dynamic 方法中，ZRing-DME 和 ZRing-MLP 明显优于 QSketch 系列；
- ZRing 的分布不仅中位数更低，四分位距和 whisker 也更低，说明提升不只是少量 trial 的偶然结果。

这一组实验的意义在于：ZRing 在支持删除后，精度已经逼近只处理插入的强基线。

---

### 4.3 消融实验与参数分析 (Ablation / Sensitivity)

严格来说，这篇论文**没有做非常标准的“组件级消融”**，比如：

- 去掉训练分布多样化会怎样？
- 不加入 $\log m,\log Z$ 会怎样？
- 不做 merge-based data augmentation 会怎样？
- MLP 改为线性模型会怎样？

论文主要提供的是**参数敏感性实验**和**替代估计器对照**。

#### Figure 6：删除比例

删除比例从 0% 提升到 80%，各方法 AARE 基本稳定，ZRing 始终更低。

这直接支持了“删除被代数化处理后不会随着删除比例增加而系统恶化”的设计目标。

#### Figure 7：参数 $Z$

$Z$ 控制每个 cell 的环大小。

在固定内存下：

- $Z$ 太小：随机抵消到 0 的概率 $1/Z$ 较大，观测噪声高；
- $Z$ 太大：每个 cell 要用更多位，导致相同内存下可用 row 数变少。

因此存在折中。实验发现：

- ZRing-DME 在多数设置下 **$Z=8$ 接近最优**；
- ZRing-MLP 对 $Z$ 很不敏感，论文报告变化通常在 1%–2% 内。

这和前面的概率机制完全一致，是论文中“理论解释与参数实验对应得最好”的部分之一。

#### Figure 8：MLP 宽度和深度敏感性

Appendix Figure 8 显示：

- 隐层宽度从 $N_i$ 增加到 $8N_i$ 时误差明显下降；继续增大到 $16N_i,32N_i$ 收益很小；
- 第一阶段深度 $l_1$ 到 5 层后基本饱和；
- 第二阶段 $l_2$ 到 3 层后基本饱和。

因此作者选择：

$$
N_x=8N_i,\qquad l_1=5,\qquad l_2=3.
$$

#### Table 1：分布式 overlap

这是一个很有价值的“场景消融”。两个 data owner 的元素重叠比例从 0% 增加到 20%：

| Overlap | ZRing-DME AARE | ZRing-MLP AARE |
|---:|---:|---:|
| 0% | 0.0372 | 0.0713 |
| 5% | 0.0849 | 0.0665 |
| 10% | 0.1361 | 0.0608 |
| 15% | 0.1935 | 0.0584 |
| 20% | 0.2504 | 0.0621 |

这里能非常清楚地看到两种 estimator 的定位差异：

- **DME 在无重叠时更准**；
- 一旦多个 owner 的 key 有重叠，直接合并独立 DME 估计会产生重复计数，误差快速增大；
- **MLP 先合并 ZRing sketch，再做一次全局推理**，因此对 overlap 基本不敏感。

所以如果问“哪个组件贡献最大”，论文能支持的更准确说法是：

> **在集中式 / 无 overlap 场景中，DME 是精度贡献最大的 estimator；在分布式有重叠场景中，Sketch merge + MLP 的全局估计机制是最关键的。单独换 ZRing 而仍使用 MLE 并不足以取得同等级提升。**

---

### 4.4 具体实现细节

论文给出的实现信息包括：

- **语言**：C++
- **Hash**：MurmurHash3（32-bit 和 64-bit）
- **CPU**：Intel Xeon E5-2690 v4 @ 2.60 GHz
- **GPU**：NVIDIA TITAN V
- **重复实验次数**：默认 1000 次
- **默认 $b$**：64
- **默认 $Z$**：8
- **ZRing 内存**：

$$
O(mb\log Z)\ \text{bits}.
$$

- Sketch 单次更新：$O(1)$
- DME 为计算概率统计，论文给出的 estimator 更新开销为 $O(b)$；
- MLP 特征直接扫描为 $O(mb)$，但通过维护每列零单元计数，可把 feature maintenance 降到近似 $O(1)$ 更新，并额外使用 $b\log m$ bits。

需要区分：

> **“Sketch 更新是 $O(1)$”不等于“完整 DME 推断每次也是严格 $O(1)$”。**

这一点在阅读性能结果时很重要。

#### Figure 5：效率

实验显示：

- ZRing 的核心更新逻辑相对 QSketch 更规整，在一些设置下 update throughput 更高；
- 但和 QSketch-DME 相比，ZRing 需要额外 hash 以支持可逆动态更新，因此可能更慢；
- ZRing-DME 的估计阶段比 QSketch-DME 更慢；
- ZRing-MLP 由于神经网络推理，估计延迟约为 QSketch 的数倍。

因此论文实际上是在做一个很明确的 trade-off：

> **用更复杂的估计阶段换取显著更低的估计误差，同时尽量保持单元素 Sketch 更新轻量。**

#### 复现性方面仍缺少的文字细节

尽管代码已经公开，论文正文对 MLP 训练仍缺少一些常见信息，例如：

- 训练样本总量；
- optimizer；
- learning rate；
- epoch / early stopping；
- train/validation/test split；
- 模型随机种子。

因此，如果只看论文文本，MLP 部分并不能做到完全复现；需要结合开源代码。

---

## 5. 讨论与思考 (Discussion and Reflection)

### 5.1 优点与创新点 (Strengths & Innovations)

#### 1）最漂亮的创新是“代数化删除”

ZRing 把删除从“恢复历史”改写成“做逆运算”。

这是一个很典型的优秀 Sketch 设计思路：

> 不直接解决难操作，而是重新设计状态空间，让难操作在新的代数结构中变简单。

从 `max` 半群转向有限环，本质上就是换了一个更适合 fully dynamic stream 的代数对象。

#### 2）权重编码与动态编码解耦得很干净

- $h(e)$ + 指数分布负责“权重”；
- $g(e)$ 负责“空间分摊”；
- $f(e,r)$ 负责“动态可逆性”。

三个 hash 的职责非常清晰，工程实现也容易模块化。

#### 3）MLP 与 DME 是两条互补路线，而不是重复设计

- DME：可解释、在线、强调无偏性；
- MLP：非线性建模能力强，适合 merge 后全局估计和数据 owner 有 overlap 的场景。

这比只给一个 estimator 更有实际价值。

#### 4）实验覆盖维度较完整

论文不仅测了不同数据分布，还测了：

- 内存；
- 数据规模；
- 删除比例；
- $Z$；
- 大规模 CAIDA；
- 分布式 overlap；
- MLP 深度/宽度；
- update / estimate latency。

对于一篇系统 + sketch 类论文，这个实验面是比较扎实的。

---

### 5.2 局限性与可商榷之处 (Limitations & Debatable Points)

#### 1）DME 的“删除转移概率对称性”是理论上最需要继续推敲的地方

论文 Eq. (8) 直接设：

$$
q(S,e,-1):=q(S,e,+1).
$$

但在真实动态状态下，删除发生时的 Sketch 已经包含之后插入的其它元素、碰撞和重复实例，因此“删除导致状态改变的真实条件概率”未必与“在当前状态插入同一个元素的概率”相同。

Theorem 2 的无偏证明依赖于：用于 inverse-probability correction 的 $q$ 与实际观测事件概率之间关系足够精确。

论文给出了直觉解释，但从严格概率论角度，我认为这里仍值得更完整地证明：

- 在何种条件下两者完全相等？
- 如果只是分布意义下等价，条件期望如何写？
- collision、duplicate 和 modular cancellation 是否会引入额外条件项？

这是我认为全文最值得后续理论工作继续加强的部分。

#### 2）抽象 DME 的“idempotent sketch state”假设与 ZRing 原始状态并不完全同一层次

Section 5.1 讨论一般动态 estimator 时假设 Sketch 具有：

- repeated insertion 对状态没有额外影响；
- 删除可恢复到“该元素从未出现”的状态。

但 ZRing 对不同 occurrence $(e,r_1),(e,r_2)$ 会在同一个 cell 上继续累加不同随机值，所以**raw matrix state 本身并不是严格的 key-level idempotent**。

论文在 Section 4.2 证明的是：只要存在活跃副本，累加结果在环上仍保持均匀——这是**分布不变性**，而不是“状态完全不变”。

因此理论从“抽象状态 idempotence”落到“ZRing 分布性质”时，存在一个值得澄清的层次切换。

#### 3）Theorem 3 中“时间增量独立”的表述偏强

Appendix A.5 在方差推导中直接使用“$\Delta V^{(t)}$ across time independent”。

但动态 Sketch 的当前状态显然由过去更新决定，所以不同时间的观测事件通常不会无条件独立。

更自然的理论工具应该是：

- martingale difference；
- conditional variance；
- predictable quadratic variation。

也就是说，最终方差形式可能仍可成立，但“独立”不是最稳妥的证明语言。这一点值得重新形式化。

#### 4）正文存在明显的公式排版 / 符号一致性问题

前面提到：

- Figure 1 的 $V$ 差分方向与 insertion 直觉相反；
- Eq. (11) 又漏掉 $w^{(t)}$；
- q 的时间下标在 Figure 1 / Eq. (11) 也不完全一致。

由于 Appendix A.5 与 Theorem 3 能帮助恢复正确逻辑，所以不影响整体理解，但对于以“理论无偏性”为卖点的论文，这类核心公式笔误是不应该出现的。

#### 5）MLP 的“full sketch”表述略过头

实际特征是：

$$
\{r_j\}_{j=0}^{b-1}+\log m+\log Z,
$$

即每一列的 occupancy ratio。

这仍然是高度聚合后的统计量，并不包含：

- 哪些列在同一 row 上共同非零；
- cell 的具体非零值；
- row 之间的联合结构。

因此更准确的说法应该是：**比 row-max MLE 保留更多全局 occupancy 信息**，而不是直接学习完整矩阵结构。

#### 6）缺少真正的组件级 ablation

论文没有直接验证：

- 多分布训练到底贡献多少；
- merge augmentation 是否必要；
- $\log m,\log Z$ 的辅助特征是否必要；
- log-domain loss 比 raw MSE 好多少；
- MLP 是否真的优于一个更简单的广义线性 / spline / monotonic model。

因此 MLP 的一些设计目前更多是“合理工程选择”，而非被消融实验逐项证实。

#### 7）基线数量有限

fully dynamic WCE 本身就是较新的问题，因此作者主要和 QSketch 及其自行扩展的动态版本比较。这在现实上可以理解，但也意味着“优于现有方法”的覆盖面有限。

尤其是：QSketch-DME 本身也是在本文框架下构造的对照，不完全等价于一个独立发表、经过充分调优的 fully dynamic WCE baseline。

---

### 5.3 未来工作与启发 (Future Work & Inspirations)

#### 方向一：把 DME 的动态无偏性证明做得更严格

如果我是作者，第一优先级会是重新用严格的 filtration / conditional expectation 语言写 DME：

- 明确“真实 transition probability”和“surrogate probability”的关系；
- 用 martingale quadratic variation 处理方差；
- 明确 duplicates 和 collisions 下的条件事件。

这会让 ZRing 从“实验很强的算法”进一步变成“理论非常干净的算法”。

#### 方向二：寻找不依赖 MLP 的解析 occupancy estimator

MLP 的输入本质上是一条 occupancy curve：

$$
r_0,r_1,\ldots,r_{b-1}.
$$

这很像一个有限维度的概率观测模型。一个自然问题是：

> 能否直接写出 $P(r_j\mid C)$ 或联合近似，然后用 Bayesian / generalized likelihood / moment matching 得到无训练 estimator？

如果能做到，可能同时获得：

- 接近 MLP 的精度；
- 更好的可解释性；
- 对 unseen distribution 更稳的外推；
- 不需要离线训练。

#### 方向三：研究 MLP 的分布外泛化

论文训练分布已经覆盖 Uniform / Gaussian / Gamma / Zipf，但现实权重可能是：

- mixture distribution；
- 时间变化分布；
- 极端 heavy-tail；
- adversarial / bursty workload。

值得系统测试：

$$
\text{train distribution}\neq\text{test distribution}
$$

时误差如何退化。

可以考虑：

- monotonic neural network；
- physics/statistics-informed network；
- domain randomization；
- uncertainty calibration。

#### 方向四：支持“权重本身会变化”

本文假设每个 key 的 $w_i$ 是固定正数。

现实中可能出现：

- key 不删除，但权重从 $w_1$ 改成 $w_2$；
- signed weight；
- 一个 key 的不同 occurrence 带不同 weight。

这时“同一 key 总共只贡献一次权重”的语义会更加复杂。ZRing 的可逆代数结构可能是一个很好的起点，但 $y(e,w)$ 会随权重变化，更新就不再只发生在同一个 cell。

#### 方向五：降低 DME 的 $O(b)$ 概率计算成本

Eq. (10) 本质上是：

$$
q_V(w)=\sum_j Q[j]\cdot P_w(y=j)\cdot \text{constant}.
$$

这其实是一种对权重相关 kernel 的点积。可以探索：

- 对常见 weight 区间预计算；
- 分段近似；
- SIMD；
- lookup table；
- 层级前缀和 / 近似卷积。

目标是让完整 DME 不只是 Sketch update，而是 estimator update 也真正接近 $O(1)$。

---

## 进一步值得追问的几个问题 💡

1. **ZRing 的有限环一定是最合适的代数结构吗？** 能否用更复杂的群 / 域编码换取更低 cancellation probability？
2. **$Z=8$ 的经验最优能否从方差–内存 trade-off 中解析推出？** 如果能，参数选择就不必依赖实验扫描。
3. **能否从 occupancy vector $\mathbf r$ 推导 closed-form estimator，从而替代 MLP？**
4. **DME 的无偏性在强碰撞、高重复率、极端 Zipf 权重下是否仍严格成立？**
5. **如果同一 key 的权重可更新，ZRing 应如何迁移其 bucket，而不保存完整 key 状态？**
6. **在分布式场景中，能否设计一个既可 merge、又无偏、同时允许集合 overlap 的 DME？**

---

## 总结

如果只用一句更“研究者视角”的话评价这篇论文：

> **ZRing 的真正价值在于，它把 fully dynamic weighted distinct estimation 中最棘手的删除问题，通过有限环上的可逆随机编码变成了一个固定空间、可合并、可概率分析的 Sketch 状态维护问题；MLP 与 DME 则分别代表数据驱动和概率驱动的两种读出方式。**

我认为这篇论文最值得学习的不是某个神经网络结构，而是它的**数据结构设计思维**：先改变状态的代数结构，再让原本难以支持的操作变成自然逆操作。

从实验上看，ZRing 的精度优势是明显的，尤其在低内存和大规模数据下；从理论上看，DME 部分仍有几处值得进一步严谨化的假设与符号问题。对于做数据流、Sketch、近似查询处理或网络测量的研究者，这篇论文很有启发性。

---

## 资料链接

- 论文 DOI：https://doi.org/10.1145/3770854.3780289
- KDD '26 Proceedings：https://doi.org/10.1145/3770854
- 开源代码 / Artifact：https://doi.org/10.5281/zenodo.18059621
- CCF 推荐目录：https://www.ccf.org.cn/Academic_Evaluation/DM_CS/
