---
layout: post
title: "SlideDP：面向滑动窗口基数估计的时间感知隐私 Sketch —— 论文阅读笔记"
date: "2026-09-14 09:27:39"
updated: "2026-09-14 09:27:39"
permalink: papers/slidedp/
categories: ["论文阅读"]
tags: ["Sketch","滑动窗口","基数估计","网络安全"]
excerpt: "SlideDP 试图把“滑动窗口中的过期机制”和“本地差分隐私”同时塞进一个紧凑的 Sketch：用 1-bit register 表示元素信息、用小型 clock counter 表示时间有效性，再通过随机响应保护 register，并用有序 Poisson 采样降低更新开销。"
disableNunjucks: true
comments: false
---

> **论文**：*SlideDP: A Time-Aware and Private Sketch for Cardinality Estimation over Sliding Windows*  
> **作者**：Yitong Liu, Pinghui Wang, Yuhao Zhang  
> **阅读定位**：数据流 / Sketch / 基数估计 / 滑动窗口 / 本地差分隐私（LDP）

---

### 开头：发表信息、CCF 级别与开源情况

📌 **发表时间与地点**

- 论文对应会议为 **13th CCF Conference on Big Data（BigData 2025）**，会议于 **2025 年 9 月 12–14 日在天津举行**。
- Springer 页面显示论文 **First Online：2026 年 7 月 2 日**，收录于 **Communications in Computer and Information Science（CCIS），Volume 2728**，页码 1–21。
- DOI：**10.1007/978-981-95-8447-5_1**
- 官方页面：[Springer Link](https://link.springer.com/chapter/10.1007/978-981-95-8447-5_1)

📌 **CCF 级别**

这里需要特别注意会议名称容易混淆：

- 本文发表在 **CCF Conference on Big Data**，即中国计算机学会（CCF）组织的 BigData 会议。
- 它**不是**“IEEE International Conference on Big Data（IEEE BigData）”。
- 因此，通常所说的 **CCF A/B/C 国际会议分级并不直接适用于本文这个 CCF Conference on Big Data**。不建议把本文简单标成“CCF C”。
- 容易混淆的是：**IEEE BigData** 在 CCF 国际会议推荐目录中属于 **C 类**，但那是另一个会议。

📌 **是否开源**

截至本阅读笔记撰写时（2026-09），**没有检索到作者公开的 SlideDP 官方代码仓库或项目主页**。论文正文也没有给出 GitHub / GitLab 代码地址。

- Springer 论文本身目前是订阅/付费访问，并非开放获取。
- 论文实现使用了开源哈希函数 **MurmurHash3**，但这只是底层哈希工具，并不是 SlideDP 的完整实现。
- 因此，若要复现 SlideDP，目前主要依据仍是论文中的 **Algorithm 1、Algorithm 2、公式 (7)–(29)**。

> **复现提醒**：论文没有完整披露部分关键超参数（尤其是 Poisson 参数 \(\lambda\)、以及给定内存预算时 \(m,w\) 的具体取值方式），这会增加严格复现的难度。

---

## 1. 摘要 (Abstract) 与核心贡献 (Core Contribution)

### 一句话总结

**SlideDP 试图把“滑动窗口中的过期机制”和“本地差分隐私”同时塞进一个紧凑的 Sketch：用 1-bit register 表示元素信息、用小型 clock counter 表示时间有效性，再通过随机响应保护 register，并用有序 Poisson 采样降低更新开销。**

### 贡献列表 (Contribution List)

- **提出时间感知 + LDP 的二维 Sketch 结构。**  
  每个 cell 包含一个 **1-bit register** 与一个 **\(c\)-bit clock counter**：register 负责承载基数信息，counter 负责判断该信息是否仍处于当前滑动窗口内。论文的核心目标是避免为每个元素保存显式时间戳，同时允许发布经过扰动的 Sketch。

- **设计“有序 Poisson 采样 + XOR 更新 + 时钟衰减”的流式更新机制。**  
  Poisson 化不仅用于采样，更重要的是带来了“Poisson thinning 后各列独立”的概率结构，使估计器可分析；作者进一步利用 order statistics 让 Poisson 变量按大小生成，一旦出现 0 就提前停止，从而减少更新计算。

- **给出从寄存器统计量反演基数的概率模型，并在合成、CAIDA、Criteo 数据上验证。**  
  论文通过 register 为 1 的概率构造 \(\phi(n)\)，然后求解
  \[
  \phi(\hat n)=V
  \]
  得到基数估计。实验声称，在 256KB 内存下、大窗口场景中相对误差可达到约 5%。

---

## 2. 引言 (Introduction)：问题背景与研究动机

### 问题定义 (Problem Definition)

论文研究的是：

> 给定一个持续到达的数据流
> \[
> \Pi=\{e^{(0)},e^{(1)},\ldots,e^{(t)},\ldots\},
> \]
> 在时刻 \(t\) 只关注最近 \(T\) 个元素构成的滑动窗口
> \[
> W_T=\{e^{(i)}\mid \max(t-T+1,1)\le i\le t\},
> \]
> 希望在**有限内存、低更新开销**下估计当前窗口内的 distinct count，同时不泄露具体元素是否出现。

论文主要使用 **count-based sliding window**。作者指出，如果数据均匀到达，则它可以近似对应 time-based sliding window。

这个问题在工业界很典型：

- 网络监控：最近一段时间出现多少不同 IP / flow；
- 广告与推荐：最近窗口内不同用户数；
- 边缘计算：设备资源有限，但又要持续统计；
- 多方共享 Sketch：希望共享统计能力，而不是暴露成员关系。

其困难不是单一的“distinct counting”，而是三个目标要同时满足：

1. **空间小**：不能保存窗口内所有元素；
2. **会遗忘**：元素离开窗口时要自动失效；
3. **有隐私**：发布 Sketch 时不能轻易做 membership inference。

---

### 现有方法的局限 (Limitations of Prior Work)

论文重点讨论 TSV、CVS 与 BM-Clock。

| 方法 | 核心做法 | 优点 | 主要问题 |
|---|---|---|---|
| TSV | 每个 bitmap 位置保存时间戳 | 过期判断直观、更新快 | 时间戳开销大；查询需扫描 |
| CVS | counter 随机衰减 | 无需显式 timestamp；更新可做成常数开销 | 随机衰减引入额外方差 |
| BM-Clock | 多 bit clock cell + 全局 pointer 周期扫描 | 时间维护更稳定 | 仍不提供隐私 |
| 现有 LDP Sketch | 对静态集合或完整流做隐私基数估计 | 有严格隐私目标 | 缺少滑动窗口“过期”机制 |

作者抓住的研究空白是：

> **此前工作通常只解决“滑动窗口”或“隐私”其中之一，而没有同时处理 time-aware expiration、精确基数估计和 LDP。**

这也是 SlideDP 的核心研究动机。

---

### 本文思路 (Overall Idea)

SlideDP 的思想可以分成三层：

1. **信息层：**  
   用 \(m\times w\) 的二维寄存器阵列记录概率化的“是否被元素命中”信息。

2. **时间层：**  
   每个 register 配一个 \(c\)-bit counter；元素命中 cell 后把 counter 重置到最大值，通过全局 clock pointer 周期性递减，让长期未被刷新者自动归零。

3. **隐私层：**  
   发布时只暴露 register，不暴露 counter；对 register 做 randomized response，再从被扰动后的 0/1 分布反推出基数。

这里最有意思的不是某一个组件本身，而是作者试图把：

> **Poisson 化的统计结构 + bitmap/LogLog 风格列映射 + clock-based expiration + randomized response**

组合成一个统一 Sketch。

---

## 3. 方法论深度解析 (In-depth Methodological Analysis)

### 3.1 整体架构 (Overall Architecture)

论文 **Figure 1（第 6 页）** 给出了 SlideDP 的完整数据流。建议把图 1 理解为以下流水线：

#### Step 1：新元素进入滑动窗口

新到达元素记为 \(e^{(t)}\)。

SlideDP 并不是只 hash 一次，而是希望让每个元素产生若干个“虚拟 tuple”：

\[
(e,k),\quad k=1,\ldots,x.
\]

其中 \(x\) 来自 Poisson 分布。

---

#### Step 2：有序 Poisson 采样决定“更新多少次、更新哪些行”

对每个输入元素，本来可以对 \(m\) 个 row 独立采样

\[
x_i\sim\operatorname{Poisson}(\lambda).
\]

但这样每个元素都要做 \(m\) 次采样。

作者的优化是：

- 先生成 \(m\) 个按降序排列的 uniform order statistics；
- 再通过 Poisson CDF 的逆变换得到降序 Poisson 变量；
- 当第一次遇到 \(x=0\) 时，后面必然全是 0，因此直接停止；
- 再使用 Fisher–Yates shuffle 将非零 sample 随机分配到 row，避免“前面的 row 总拿到大样本”的系统偏差。

Figure 1 左侧的 **descending-order Poisson variables + Fisher-Yates Shuffle** 就是在做这件事。

---

#### Step 3：tuple 被映射到二维 cell

对于 tuple \((e,k)\)，在 row \(i\) 内计算：

\[
j=\rho(h_i(e,k)),
\]

其中 \(\rho(\cdot)\) 是二进制 trailing zeros 数。

因此列概率为论文公式 (7)：

$$
p_j=
\begin{cases}
2^{-j-1}, & 0\le j\le w-2,\\
2^{-w+1}, & j=w-1.
\end{cases}
$$

这其实带有明显的 Flajolet–Martin / LogLog 思路：  
**小 \(j\) 容易命中，大 \(j\) 是指数级稀有事件。**

因此，不同列天然对应不同 cardinality scale。

---

#### Step 4：XOR 更新 register，同时刷新 counter

命中 cell \((i,j)\) 后，再计算一个

\[
u\sim\operatorname{Bernoulli}(0.5),
\]

并进行：

$$
C^{rgs}_{i,j}
\leftarrow
C^{rgs}_{i,j}\oplus u.
$$

然后把时间 counter 重置：

$$
C^{clock}_{i,j}\leftarrow 2^c-1.
$$

作者强调：如果总是固定 XOR 1，同一个元素出现偶数次时会完全抵消；加入 \(u\) 后，更新成为随机 parity 过程。

---

#### Step 5：clock pointer 周期扫描，模拟窗口滑动

全局 pointer 以 row-major 顺序扫描二维数组。

遇到 counter：

- 若 \(C^{clock}>0\)：减 1；
- 当 counter 归零：对应 register 应被视为过期信息。

因此，**active cell 的正确含义是 \(C^{clock}_{i,j}\neq 0\)**。

论文后面的估计公式也使用

\[
\mathbf 1(C^{rgs}_{i,j}=1\land C^{clock}_{i,j}\neq 0).
\]

这一步的核心价值是：不用保存每个元素的真实时间戳。

---

#### Step 6：发布前做 Randomized Response

论文 Algorithm 2 设置：

$$
\alpha=\frac{1}{1+e^\epsilon},
$$

$$
y_{i,j}\sim\operatorname{Bernoulli}(1-\alpha),
$$

$$
\widetilde C^{rgs}_{i,j}
=
C^{rgs}_{i,j}\oplus y_{i,j}.
$$

注意：按照这个写法，

- bit **不翻转**的概率是 \(\alpha\)；
- bit **翻转**的概率是 \(1-\alpha=\frac{e^\epsilon}{1+e^\epsilon}\)。

也就是说，它更偏向于输出输入 bit 的反值。  
这与教科书中“以 \(e^\epsilon/(1+e^\epsilon)\) 概率保留真值”的常见写法方向相反，但如果把输出标签整体交换，隐私比值仍然可以满足 binary RR 的 LDP 比例约束。

然而，论文第 9 页在推导 clock 扫描量时又使用“以 \(e^\epsilon/(1+e^\epsilon)\) 概率保留 1”的叙述，因此这里存在**符号/文字不一致**，后文会进一步讨论。

---

#### Step 7：统计 active 1-register 的比例，反演 cardinality

SlideDP 定义：

$$
V=
\frac{1}{mw}
\sum_{i=0}^{m-1}\sum_{j=0}^{w-1}
\mathbf 1
\left(
C^{rgs}_{i,j}=1
\land
C^{clock}_{i,j}\neq 0
\right).
$$

再建立期望函数

\[
\phi(n)=\mathbb E[V],
\]

最终通过二分搜索或 Newton iteration 求：

$$
\phi(\hat n)=V.
$$

---

### 架构的核心思想

从宏观上看，SlideDP 的最大不同是：

> **过去的 sliding-window sketch 把“统计状态”和“时间状态”混在 counter/timestamp 中；SlideDP 则将其明确拆为 register + clock，并额外加一层 LDP 发布机制。**

更进一步，作者没有简单地给普通 bitmap 加 Laplace/Gaussian 噪声，而是专门建立了**“XOR parity + Poisson + RR”对应的 Bernoulli 概率模型**。

这使得噪声不是事后补偿，而是直接进入估计器。

---

## 3.2 核心组件/模块拆解 (Core Component Breakdown)

### 3.2.1 二维 Register-Clock Cell：把“存在性”和“时间”解耦

#### 输入与输出 (Input & Output)

输入：

- 当前元素 \(e^{(t)}\)；
- row \(i\)、column \(j\)。

状态：

\[
C_{i,j}
=
\left(
C^{rgs}_{i,j},
C^{clock}_{i,j}
\right).
\]

其中：

- \(C^{rgs}_{i,j}\in\{0,1\}\)；
- \(C^{clock}_{i,j}\in\{0,\ldots,2^c-1\}\)。

输出：

- 一个随输入流不断演化的二维 Sketch。

---

#### 内部机理 (Internal Mechanism)

元素命中 cell 后：

$$
C^{rgs}_{i,j}
\leftarrow
C^{rgs}_{i,j}\oplus u,
\qquad
u\sim \operatorname{Bernoulli}(0.5),
$$

以及：

$$
C^{clock}_{i,j}\leftarrow 2^c-1.
$$

之后不为 cell 保存“最后更新时间”，而是通过统一 pointer 去衰减所有 clock。

这是一种**近似 TTL（time-to-live）编码**。

---

#### 设计动机 (Design Rationale)

如果给每个 cell 保存完整时间戳，位宽会明显增加。

例如，窗口长度很大时，timestamp 至少要 \(\Theta(\log T)\) bits；而论文默认只用 **4-bit clock**。

代价是：

- 过期时间不再完全精确；
- pointer 扫描到一个 cell 的时机存在延迟；
- 因此会产生 stale information。

作者把这部分误差单独建模为 \(\operatorname{Var}_{clock}\)。

这是典型的：

> **用“可控时间模糊性”换“固定内存”。**

---

### 3.2.2 Clock Decay：滑动窗口中最关键的时间机制

论文设 counter 最大值为

\[
2^c-1.
\]

为了让整个 counter 集合在一个窗口内完成足够次数的衰减，作者定义扫描周期：

$$
f=\frac{T}{2^c-2}.
$$

理想情况下，每个新元素到达后扫描约

\[
\frac{mw}{f}
\]

个 counter。

但作者认为并不是每个 cell 都真正有效，因此进一步修正得到公式 (12)：

$$
L=
mw\cdot
\frac{\gamma e^\epsilon}{2(1+e^\epsilon)}
\cdot
\frac{2^c-2}{T},
$$

其中：

- \(m w\)：总 cell 数；
- \(\gamma\)：Poisson sample 非零概率；
- \(\frac{e^\epsilon}{1+e^\epsilon}\)：论文在这里解释为 RR 后有效 bit 概率；
- \(1/2\)：XOR 中 \(u=1\) 的概率；
- \(\frac{2^c-2}{T}\)：每个窗口内需要完成的平均衰减速率。

#### 直觉

\(L\) 本质上是：

> **每到一个新元素，要“推进多少格时间”。**

\(L\) 太小：

- 旧 cell 消失太慢；
- stale state 增多；
- cardinality 被高估。

\(L\) 太大：

- cell 消失过早；
- 当前窗口内仍有效的信息被抹掉；
- cardinality 被低估。

---

#### 一个值得质疑的地方

这里存在一个比较明显的架构问题：

论文前面说：

> counter 保留在本地，只有 register 在发布时被扰动。

如果 Randomized Response 只发生在“发布层”，理论上**本地 clock pointer 的推进速率不应该依赖发布噪声是否把 register 翻成 0**。

但公式 (12) 又把 RR 概率纳入内部 clock 更新率。

因此目前论文文本存在两种可能解释：

1. **RR 会实际改写本地 Sketch 状态**；  
2. **RR 只作用于导出的副本，但作者在 \(L\) 的推导中混用了发布态和内部态。**

论文没有把这两层状态讲清楚。对于严格实现，这是一个必须进一步确认的问题。

---

### 3.2.3 Ordered Poisson Sampling：既是加速技巧，也是理论桥梁

这是本文最值得学习的设计之一。

#### 输入与输出

目标是为一个元素生成

\[
x_0,\ldots,x_{m-1}
\sim \operatorname{Poisson}(\lambda)
\]

的 row-level 更新次数。

朴素方案需要做 \(m\) 次独立 Poisson sampling。

SlideDP 则先产生按降序排列的 uniform order statistics。

---

#### 内部机理

设有 \(m\) 个独立均匀随机变量：

\[
v_0,\ldots,v_{m-1}\overset{i.i.d.}{\sim}U(0,1).
\]

排序后：

$$
v_{[m-1]}\ge v_{[m-2]}\ge\cdots\ge v_{[0]}.
$$

根据 order statistics，可递归生成：

$$
v_{[m-1]}=u_1^{1/m},
$$

以及论文公式 (14) 所表示的递推关系，用新的 \(U(0,1)\) 随机变量逐步得到后续顺序统计量。

然后使用 Poisson CDF \(F_\lambda\) 的逆变换：

$$
x_r=
\min
\left\{
x\in\mathbb N\mid
F_\lambda(x)\ge v_{[r]}
\right\}.
$$

因为 \(v_{[r]}\) 已排序，得到的 \(x_r\) 也是单调排列的。

因此：

> **一旦某个 \(x_r=0\)，后面不可能再出现正样本。**

这让 early stop 成立。

---

#### 为什么还需要 Fisher–Yates Shuffle？

如果最大的 Poisson sample 永远给 row 0、第二大永远给 row 1，那么 row 之间就不再同分布。

作者因此把非零 sample 随机 permute 到不同 row。

其目标是维持：

> 每一行在统计意义上仍然对称 / exchangeable。

---

#### 更深层的意义：Poissonization

Poisson sampling 不仅是为了“少算几次”。

Theorem 1 使用了经典 Poisson thinning 性质：

若

\[
N\sim\operatorname{Poisson}(n\lambda),
\]

每个 tuple 独立地以概率 \(p_j\) 进入第 \(j\) 列，则：

$$
N_j\sim\operatorname{Poisson}(n\lambda p_j),
$$

而且不同 \(j\) 的 \(N_j\) 相互独立。

这一步非常关键。

没有 Poisson 化时，如果总 tuple 数固定，那么不同列之间是 multinomial 耦合的；有了 Poissonization 后，各列直接“拆开”为独立 Poisson 变量，估计器推导明显简单很多。

因此这里体现了一个很值得借鉴的算法设计思想：

> **有时随机采样的价值不是减少样本，而是把概率结构变成容易分析的形式。**

---

## 3.3 关键公式与算法 (Key Equations and Algorithms)

### 公式一：从 Poisson tuple 数到 Register=1 的概率

Theorem 1 首先得到：

$$
n_{i,j}
\sim
\operatorname{Poisson}(n\lambda p_j),
$$

其中：

- \(n\)：当前窗口真实 distinct cardinality；
- \(\lambda\)：每个 distinct element 产生 tuple 的 Poisson 参数；
- \(p_j\)：tuple 进入第 \(j\) 列的概率；
- \(n_{i,j}\)：落入 cell \((i,j)\) 的 tuple 数。

由于 register 做 XOR，它最终只取决于 \(n_{i,j}\) 的奇偶性。

Poisson 随机变量的 parity 有：

$$
\Pr(n_{i,j}\text{ 为奇数})
=
\frac{1-e^{-n\lambda p_j}}{2},
$$

$$
\Pr(n_{i,j}\text{ 为偶数})
=
\frac{1+e^{-n\lambda p_j}}{2}.
$$

再叠加 randomized response，论文得到：

$$
\Pr(C^{rgs}_{i,j}=1)
=
\frac{
1+(1-2\alpha)e^{-n\lambda p_j}
}{2}.
$$

---

#### 公式的目标 (Objective)

它把：

> **未知 cardinality \(n\)**

映射成：

> **一个可以实际观察到的 Bernoulli 概率。**

这是整个估计器的基础。

---

#### 各部分的含义 (Meaning of Terms)

\[
e^{-n\lambda p_j}
\]

代表该列的“未充分饱和程度”。

当 \(n\) 增大：

\[
e^{-n\lambda p_j}\rightarrow 0.
\]

于是 register 的输出逐渐趋向：

\[
\Pr(C=1)\rightarrow \frac12.
\]

也就是说，随着 cardinality 变大，XOR parity 趋于完全随机。

---

#### 公式的直觉 (Intuition)

可以把每一列看成不同灵敏度的“测量尺”。

- 小 \(j\)：\(p_j\) 大，很快饱和；
- 大 \(j\)：\(p_j\) 小，要很大的 \(n\) 才饱和。

因此把多列组合起来，就可以覆盖很宽的 cardinality 范围。

这与 FM/HLL 使用 leading/trailing zeros 扩展动态范围的思想高度一致。

---

### 公式二：总体估计器 \(\phi(n)\)

定义 active 1-register 比例：

$$
V=
\frac{1}{mw}
\sum_{i=0}^{m-1}
\sum_{j=0}^{w-1}
\mathbf 1
\left(
C^{rgs}_{i,j}=1
\land
C^{clock}_{i,j}\neq 0
\right).
$$

作者定义：

$$
\phi(n)
=
\mathbb E[V]
=
\frac1w
\sum_{j=0}^{w-1}
\frac{
1+(1-2\alpha)e^{-n\lambda p_j}
}{2}.
$$

观测到 \(V\) 后，求：

$$
\boxed{
\phi(\hat n)=V
}
$$

通过二分搜索或 Newton iteration 得到 \(\hat n\)。

---

#### 公式的目标 (Objective)

把二维 Sketch 压缩成一个统计量 \(V\)，再把 \(V\) 反演成 cardinality。

---

#### 各部分含义

- \(m\)：独立 row 数，本质上控制方差；
- \(w\)：不同尺度 column 数；
- \(\alpha\)：RR 参数；
- \(\lambda p_j\)：该列单位 cardinality 所对应的平均 Poisson hit rate。

---

#### 直觉

SlideDP 的估计不是：

> “有多少 bit 是 1，然后直接套 bitmap 公式”。

而是：

> “在当前 \(n\) 下，考虑 Poisson、XOR、列概率、LDP 噪声以后，理论上应该有多少比例的 active bit 为 1？”

然后反向寻找最符合当前观测 \(V\) 的 \(n\)。

这更接近一个 **method-of-moments / inverse probabilistic model estimator**。

---

### ⚠️ 公式层面需要特别注意的两个问题

#### 问题 1：论文公式 (21) 疑似存在符号错误

公式 (18) 已明确写出：

$$
P(C=1)
=
\frac{1+a}{2},
\qquad
a=(1-2\alpha)e^{-n\lambda p_j}.
$$

那么必然：

$$
P(C=0)
=
1-P(C=1)
=
\frac{1-a}{2}.
$$

但论文第 12 页公式 (21) 又印成了：

$$
P(C=0)=\frac{1+a}{2},
$$

与公式 (18) 以及概率归一性矛盾。

因此，这里应高度怀疑是排版/推导笔误。

---

#### 问题 2：论文公式 (23) 中 Bernoulli 方差的符号也值得核对

若：

$$
q=
\frac{1+a}{2},
$$

则 Bernoulli 方差应为：

$$
q(1-q)
=
\frac{1-a^2}{4}.
$$

因此单 row 平均量的 variance 理论上应包含：

$$
1-(1-2\alpha)^2e^{-2n\lambda p_j},
$$

而论文公式 (23) 打印的是“\(1+\cdots\)”形式。

这意味着后续公式 (26) 的 estimator variance 也可能继承了这个符号问题。

这不是单纯的文字问题，因为论文声称给出了 theoretical error guarantee。  
如果要严格使用其误差公式，建议重新从 Bernoulli variance 独立推导一遍，而不要机械照抄。

---

## 4. 实验设计与结果分析 (Experimental Design and Results Analysis)

### 实验设置 (Experimental Setup)

#### 数据集

论文使用一个合成数据集和两个真实数据集。

| 数据集 | 描述 |
|---|---|
| Synthetic | 从 32-bit 非负整数空间均匀采样；\(T\in\{2^{13},2^{14},2^{15},2^{16},2^{17}\}\) |
| CAIDA | 高速骨干网匿名流量，约 30 亿条记录，超过 60 万 unique network address |
| Criteo | 广告曝光数据，两个月，包含 timestamp 与匿名字段；6,142,256 distinct user IDs |

---

#### Baselines

- TSV
- CVS
- BM-Clock

这里要强调：

> **三个 baseline 都是 non-private 方法。**

因此主实验回答的是：

> “加入 LDP 后，SlideDP 能否仍接近非隐私 Sketch？”

而不是：

> “SlideDP 是否优于其他隐私算法？”

后者实际上没有被直接验证。

---

#### 默认参数

论文实验默认：

- \(\epsilon=1\)；
- counter size \(c=4\) bits；
- 所有方法在相同 memory budget 下比较；
- 哈希使用 MurmurHash3；
- 服务器：Intel Xeon Gold 6140；
- Ubuntu 18.04.6 LTS。

评价指标为 Average Relative Error：

$$
ARE=
\frac1N
\sum_{i=1}^N
\frac{|\hat n_i-n_i|}{n_i}.
$$

---

### 主实验结果 (Main Results)

### Figure 2：内存和隐私预算对 SlideDP 的影响

Figure 2 是很关键的一张图。

当 \(\epsilon=1\) 时：

- 16KB 下 ARE 约可到 0.22–0.25；
- 随内存增加明显下降；
- 256KB 下约到 0.05–0.07。

论文特别指出：

> error 从约 0.22（16KB）降至约 0.05（256KB）。

当 \(\epsilon=2\) 时：

- 低内存阶段明显比 \(\epsilon=1\) 更好；
- 64KB 之后多组窗口长度都趋近约 5%–8% 误差。

---

#### 这个结果验证了什么？

它支持了两个方法论假设：

1. **更多 cell / row 可以降低随机 estimator variance；**
2. **更大的 privacy budget 会减小 randomized response 引入的信息损失。**

但这里也有一个值得思考的现象：

- 当 cardinality 很大时，理论上许多 register 会向 0.5 饱和；
- 论文依靠不同 \(p_j\) 的 column 继续保留尺度信息；
- Figure 2 中大窗口在低内存下误差确实更高，说明“可用尺度不足 / 饱和”很可能已经发生。

---

### Figure 3：不同滑动窗口之间的稳定性

memory 固定为 256KB。

论文测试连续 9 个窗口：

- \(\epsilon=2\)：误差大致在 0.02–0.08；
- \(\epsilon=1\)：大致在 0.05–0.15。

中等窗口 \(T=2^{15},2^{16}\) 最稳定。

这说明 SlideDP 不是只对某一个随机窗口“撞好运气”，而是在连续窗口上保持了相对稳定的 error。

不过论文没有给 confidence interval，也没有报告不同随机种子的均值与标准差，因此这里的“稳定”更多是经验图示，不是严格统计显著性结论。

---

### Figure 4：与 TSV / CVS / BM-Clock 比较

这是论文最想强调的结果。

在 \(\epsilon=1\) 下：

- 低内存（16KB、32KB）时，部分 non-private baseline 甚至出现接近 1 的 ARE；
- SlideDP 虽然有 privacy noise，但误差仍约 0.1–0.3；
- 随内存增加，baseline 很快恢复；
- 到 256KB 时，SlideDP 也达到约 5% 左右，接近 non-private 方法。

---

#### 这是否证明 SlideDP “比 non-private 方法更好”？

不能这么理解。

低内存阶段 baseline 的失败主要可能来自：

- timestamp / clock cell 位宽更大；
- 在相同 memory 下有效 slot 数太少；
- 大窗口对时间状态存储需求更高。

因此 Figure 4 更准确的结论是：

> **SlideDP 的 cell representation 在低内存、大窗口条件下具有较好的 memory efficiency。**

而不是：

> “加了隐私之后反而统计更准”。

---

### Figure 5：CAIDA

论文报告：

- SlideDP 在不同内存下相对稳定；
- BM-Clock 在 16KB / 32KB 下表现很差；
- TSV 在 16KB 下误差较高；
- CVS 整体准确；
- 到 256KB，SlideDP 与 non-private 方法差距明显缩小。

连续窗口中，SlideDP 约在：

\[
0.05\sim0.08
\]

范围。

对于网络监控场景，这是相当可用的误差水平。

---

### Figure 6：Criteo

Criteo 上的结果与 CAIDA 类似。

在 256KB 下：

- SlideDP 已接近 CVS / TSV；
- 连续 9 个窗口中误差大致：
  \[
  0.06\sim0.09.
  \]

这说明方法不只依赖“均匀随机整数”的合成分布。

---

### Figure 7：效率

Figure 7(a) 表明：

- runtime 随窗口 \(T\) 增大明显上升；
- memory 增大带来的额外 runtime 相对有限。

Figure 7(b) 对比：

- Insert-only；
- Insert + Clock Update。

加入 clock 后 throughput 会下降，但幅度不是灾难性的。

论文给出的总体判断是：

> SlideDP 的主要计算压力来自窗口规模，而不是简单来自 memory 增长。

这与方法结构是一致的：窗口越大，需要维持的有效时间跨度越长，同时持续处理的输入也更多。

---

### 消融实验 (Ablation Studies)

这里必须明确指出：

> **论文没有做严格意义上的模块级 ablation study。**

没有看到类似以下实验：

- 去掉 ordered Poisson，只做普通 Poisson sampling；
- 去掉 Fisher–Yates；
- XOR 改成 OR / Set-1；
- 不使用 clock correction；
- 不加 randomized response；
- 不使用 \(L\) 的稀疏修正项。

因此，论文并不能直接回答：

> “到底是哪个创新模块贡献最大？”

---

### Figure 8 更准确地说是 Parameter Analysis

#### Figure 8(a)：privacy budget \(\epsilon\)

随着：

\[
\epsilon:1\rightarrow4,
\]

ARE 基本单调下降。

这符合 LDP 的基本规律：

- \(\epsilon\) 小：隐私强，噪声大；
- \(\epsilon\) 大：隐私弱，统计更准。

当 \(\epsilon\ge2.5\) 后，不同窗口长度之间的差距明显缩小。

---

#### Figure 8(b)：counter bit 数 \(c\)

这是整个实验中非常值得关注的一张图。

当：

- \(c=1\)：部分窗口 error 接近甚至超过 1；
- \(c=2\)：误差大幅下降但仍不稳定；
- \(c=3\) 后：误差快速进入较低区间；
- \(c\ge4\)：提升趋于饱和。

因此，如果把它视作“近似消融证据”，**时间 counter 的容量是非常关键的性能因素**。

它直接验证了论文误差分析中的观点：

> stale-state error 会随 \(c\) 增大快速减小。

---

### 哪个部分对性能贡献最大？

严格来说无法从现有实验得到唯一答案。

但从已提供的数据看：

1. **counter bit width \(c\)** 对准确率影响非常剧烈；
2. **memory budget** 对随机估计方差影响明显；
3. **\(\epsilon\)** 对隐私噪声影响稳定；
4. **ordered Poisson sampling** 的效率收益没有被独立量化。

所以目前最有实验支撑的结论是：

> **SlideDP 的“时间有效性编码”至少和隐私机制一样关键；若 counter 太短，窗口语义本身都会变得不可靠。**

---

### 具体实现的细节

论文披露的实现信息包括：

- CPU：Intel Xeon Gold 6140；
- OS：Ubuntu 18.04.6 LTS；
- hash：MurmurHash3；
- 默认：
  \[
  \epsilon=1,\qquad c=4;
  \]
- memory budget 多数实验使用：
  - 16KB
  - 32KB
  - 64KB
  - 128KB
  - 256KB
- cardinality query 的数值反演可用：
  - binary search；
  - Newton iteration。

#### 复现中仍缺的信息

论文没有清晰给出：

- 默认 \(\lambda\)；
- \(m\) 与 \(w\) 的具体设置；
- memory budget 到 \(m,w\) 的映射；
- random seed；
- query frequency；
- 每个实验重复次数 \(N\) 的具体值；
- Poisson inverse CDF 的工程实现；
- counter pointer 的整数化策略（因为 \(L\) 可能不是整数）；
- 是否缓存 \(\phi(n)\) / lookup table；
- RR 是原地修改本地状态还是仅生成发布副本。

所以从“论文可读性”看足够，从“完全可复现性”看仍明显不足。

---

## 5. 讨论与思考 (Discussion and Reflection)

### 优点与创新点 (Strengths & Innovations)

#### 1. 问题组合很有价值

单独的 sliding-window cardinality 已经有不少工作；单独的 private cardinality 也有不少工作。

SlideDP 真正有价值的切入点是：

> **把时间过期和 LDP 放在同一个极小状态结构中统一处理。**

这对网络 telemetry、边缘设备、分布式统计都很有实际意义。

---

#### 2. Poissonization 用得很聪明

从研究方法上，我认为本文最值得学习的不是 randomized response，而是：

> **通过 Poisson sampling 主动制造可分解的随机结构。**

Theorem 1 中的 Poisson thinning：

\[
n_{i,j}\sim\operatorname{Poisson}(n\lambda p_j)
\]

让不同 column 独立，极大降低后续概率推导难度。

这是一种很成熟的“算法—概率模型协同设计”思想。

---

#### 3. 时间状态和统计状态分离得比较干净

1-bit register：

- 负责统计。

\(c\)-bit counter：

- 负责 freshness。

这个结构比直接给 bitmap 加大 timestamp 更轻量，也比完全随机过期更有控制力。

---

#### 4. 实验覆盖面尚可

论文至少同时做了：

- synthetic；
- backbone network；
- advertising；
- memory；
- window size；
- privacy budget；
- counter size；
- runtime / throughput。

对于一篇 21 页的会议论文来说，维度比较完整。

---

### 局限性与可商榷之处 (Limitations & Debatable Points)

下面几项是我认为读这篇论文时最需要保持警惕的地方。

---

#### 1. “每个 register 都是 \(\epsilon\)-LDP”并不自动推出“整张 Sketch 是 \(\epsilon\)-LDP”

论文隐私分析的逻辑大致是：

- 每个 register 独立做 randomized response；
- binary GRR 满足 \(\epsilon\)-LDP；
- 因此发布的 registers 满足 \(\epsilon\)-LDP。

这个推导过于简略。

如果一次发布的是一个由很多 bit 构成的向量：

\[
\widetilde C
=
(\widetilde C_1,\ldots,\widetilde C_K),
\]

并且同一个 private input 会影响多个 bit，那么通常需要考虑 **composition**。

最朴素情况下：

- 一个 bit 是 \(\epsilon\)-LDP；
- \(k\) 个相关发布可能给出最高约 \(k\epsilon\) 的 privacy loss 上界。

要想整张 Sketch 仍然是 \(\epsilon\)-LDP，需要进一步证明：

- 不同 bit 是否对应 disjoint privacy units；
- 邻接关系到底是“一个用户”“一个元素”还是“一个 cell”；
- 单个输入最多影响多少 register；
- RR 参数是否已按总敏感度重新缩放。

论文当前的 Privacy Analysis 没有把这些问题展开。

**这是全文最重要的理论疑问之一。**

---

#### 2. 连续发布（continual release）的隐私累积没有被处理

论文动机强调：

> repeated query 会导致 inference attack。

但是 SlideDP 自身也是 sliding window 系统，天然可能被连续发布：

\[
C^{(t)},C^{(t+1)},C^{(t+2)},\ldots
\]

即使每次发布单独满足某个 \(\epsilon\)-LDP，反复发布也需要讨论 privacy composition。

特别是同一个元素在多个连续窗口内长期存在时，攻击者可以联合多个时刻观察其影响。

论文没有给出：

- 总 privacy budget；
- release 次数依赖；
- temporal composition；
- privacy amplification；
- event-level / user-level adjacency。

因此“Repeated query attack”虽然是它的研究动机，但“Repeated release privacy accounting”并没有真正闭环。

---

#### 3. XOR + duplicate arrival 与 distinct semantics 之间存在潜在冲突

Theorem 1 的分析建立在：

> 窗口有 \(n\) 个 distinct elements，每个 element 产生 Poisson tuples。

但 Algorithm 1 的输入是每个 arriving item \(e^{(t)}\)。

如果一个元素在窗口内出现多次：

\[
e,e,e,\ldots
\]

那么从伪代码看它仍会被重复更新。

尤其是：

\[
u=d(i,k,t)
\]

显式依赖时间 \(t\)，意味着同一元素的重复出现可能产生不同 XOR 随机量。

这就提出一个非常基本的问题：

> **Sketch 的状态到底只依赖“元素是否出现”，还是还会依赖“元素出现多少次”？**

如果频率会影响 register parity，那么理论模型中的 \(n\) 就不再只是 distinct cardinality。

论文没有专门解释 deduplication 或 duplicate-invariance。

这是值得复现时优先验证的 corner case。

---

#### 4. Randomized Response 的符号定义与文字描述不一致

Algorithm 2 使用：

$$
\alpha=\frac1{1+e^\epsilon},
$$

并令：

$$
y\sim\operatorname{Bernoulli}(1-\alpha),
\qquad
C'=C\oplus y.
$$

这意味着“保留原 bit”的概率是 \(\alpha\)。

但第 9 页在计算 clock 扫描量时又写成：

> true value 1 以 \(e^\epsilon/(1+e^\epsilon)\) 的概率被保留。

两个叙述方向相反。

虽然 binary RR 把输出标签整体翻转仍可保持 LDP，但：

- estimator；
- clock correction；
- 概率公式；

必须使用同一套定义。

当前论文至少在表述上没有完全统一。

---

#### 5. 公式 (21) 和方差公式 (23) 很可能有数学排版错误

如前文所述：

\[
1-P(C=1)
\]

不可能仍与 \(P(C=1)\) 完全同式。

此外 Bernoulli variance 应是：

\[
q(1-q),
\]

因此中间应出现：

\[
1-a^2,
\]

而不是 \(1+a^2\)。

如果这不是单纯 typo，而是作者实际代码也按论文公式实现，那么误差模型会发生系统偏差。

---

#### 6. 没有真正的“隐私方法 baseline”

论文对比：

- TSV
- CVS
- BM-Clock

全部 non-private。

这能证明：

> “隐私代价没有大到完全不可用”。

但不能证明：

> “SlideDP 是最好的 private sliding-window cardinality estimator”。

比较理想的补充实验包括：

- naïve RR + BM-Clock；
- naïve LDP bitmap；
- 分时间桶后做 private FM/HLL；
- continual-release DP 方法的合理改造版本。

哪怕这些方法不是完全公平，也能更清楚地分离：

> SlideDP 的优势究竟来自“新 privacy design”，还是主要来自“更节省内存的 sketch layout”。

---

#### 7. 缺乏核心模块消融

作者称 ordered Poisson sampling 能显著减少 computation，但没有给：

\[
\text{ordered Poisson}
\quad\text{vs.}\quad
\text{independent Poisson}
\]

的 runtime / throughput 对比。

因此 Figure 7 只能说明 SlideDP 总体很快，却没有直接证明：

> “快的原因就是 ordered Poisson early stopping”。

这削弱了对这一创新点的实验支撑。

---

#### 8. 对真实 time-based window 的验证不足

论文主要研究 count-based window，并通过“uniform arrival rate”说明二者可等价。

但真实网络和广告流通常存在：

- burst；
- diurnal pattern；
- highly non-uniform arrival；
- long idle interval。

这时：

> 最近 \(T\) 个 item

和

> 最近 \(T\) 秒

完全不是一个概念。

如果应用目标确实是 time-aware stream analytics，未来应该直接做真实 timestamp window 实验。

---

#### 9. 复现信息不足

尤其是 \(\lambda,m,w\) 没有充分公开，会直接影响：

- estimator dynamic range；
- register saturation；
- update cost；
- memory；
- \(\gamma=P(X>0)\)。

而这些又是论文理论公式的核心参数。

没有代码的情况下，这个缺口会非常明显。

---

### 未来工作与启发 (Future Work & Inspirations)

论文结论中明确提出未来希望支持：

- heavy hitters；
- entropy；

这很自然，因为当前结构已经同时提供：

- hashed occupancy；
- 时间有效性；
- 本地扰动。

在此基础上，我认为还有几条更值得继续做。

---

#### 方向 1：重新建立“整张 Sketch”的严格 LDP / continual-release 隐私证明

下一版最优先需要做的，不是换更复杂的 Sketch，而是把 privacy model 定义清楚：

- privacy unit：一个 event，还是一个 user？
- 邻接数据集是什么？
- 一次发布多少 bit？
- 多 bit 如何 compose？
- 多时间点如何 compose？
- 总 privacy budget 如何分配？

如果能证明一个真正的：

\[
(\epsilon,\delta)\text{-LDP}
\]

或 event-level continual local privacy guarantee，论文的理论完整性会大幅提升。

---

#### 方向 2：让 randomized response 与 Sketch 结构耦合，而不是逐 bit 独立扰动

逐 bit RR 往往非常浪费 privacy budget。

可以考虑：

- 一次只随机选择部分 cells 上报；
- Hadamard response；
- unary encoding / optimized local hashing；
- correlated perturbation；
- privatized sufficient statistic 而不是 privatized raw register vector。

目标是：

> 同样的 global privacy budget 下，让更多统计信号留在 \(V\) 中。

---

#### 方向 3：针对 duplicate 做严格 frequency-invariance

可以设计：

- idempotent update；
- stable hashing；
- per-element deterministic Bernoulli；
- OR / max 结构与 privacy-aware estimator 的结合。

使得同一个元素出现：

\[
1,10,1000
\]

次，对 distinct estimator 的期望影响仍一致。

这会让 Theorem 1 与真实数据流语义更加匹配。

---

#### 方向 4：改进 clock expiration

当前 fixed-rate pointer 的缺陷是过期不精确。

可以探索：

- hierarchical timing wheel；
- stochastic aging；
- exponential histogram；
- bucketized window；
- adaptive decay；
- learned arrival-rate-aware scan rate。

尤其是非均匀到达下，让 pointer 速度由 wall-clock time 而不是 arrival count 驱动。

---

#### 方向 5：使用最大似然估计代替单一统计量 \(V\)

当前把整个二维 Sketch 压缩成一个全局比例：

\[
V.
\]

这会损失不同 column 的信息。

实际上每个 \(j\) 有不同：

\[
p_j.
\]

可以保留：

\[
V_j
=
\frac1m\sum_i
\mathbf 1(C_{i,j}=1),
\]

然后建立 likelihood：

$$
\mathcal L(n)
=
\prod_j
q_j(n)^{mV_j}
(1-q_j(n))^{m(1-V_j)}.
$$

再求：

\[
\hat n_{\mathrm{MLE}}
=
\arg\max_n\mathcal L(n).
\]

这很可能比只用一个 \(V\) 更充分利用列尺度信息。

---

#### 方向 6：自适应选择 \(\lambda,m,w,c\)

论文里的这些参数实际上强耦合：

- \(\lambda\)：hit rate；
- \(w\)：dynamic range；
- \(m\)：variance；
- \(c\)：expiration precision；
- memory budget：
  \[
  M\approx mw(1+c).
  \]

因此可以把参数选择写成一个 constrained optimization：

$$
\min_{m,w,c,\lambda}
\operatorname{MSE}(\hat n)
$$

subject to

$$
mw(1+c)\le M.
$$

这样就从“经验调参数”升级成“给定目标窗口与 cardinality range 自动配置 Sketch”。

---

### 对研究工作的直接启发

这篇论文最值得带走的三点研究方法论是：

1. **不要只从数据结构角度设计 Sketch，也要从概率可分析性角度设计。**  
   Poissonization 就是典型例子。

2. **滑动窗口问题中，时间状态本身也是一种需要压缩的信息。**  
   不一定非要显式 timestamp。

3. **隐私机制必须进入 estimator，而不能只在最后机械加噪声。**  
   SlideDP 至少在这个方向上是对的：它直接推导被扰动 register 的分布。

---

### 推荐进一步思考的问题

1. **论文声称整张 Sketch 满足 \(\epsilon\)-LDP，这一证明在多 register 联合发布时是否成立？如果不成立，正确的 global privacy budget 是多少？**

2. **同一个 element 在一个窗口里重复出现 100 次，SlideDP 的期望输出是否与只出现 1 次完全相同？如果不同，它还是严格意义上的 cardinality sketch 吗？**

3. **公式 (12) 为什么让内部 clock decay rate 依赖 randomized response？如果 RR 只作用于发布副本，这一项是否应该被删除？**

4. **能否不用全局平均 \(V\)，而利用每一列的 \(V_j\) 做 MLE，从而改善高 cardinality 区域的饱和问题？**

5. **如果数据到达速率剧烈波动，count-based clock 是否还能代表真实时间窗口？怎样改成 wall-clock-aware SlideDP？**

6. **ordered Poisson 的理论优雅性很强，但实际节省了多少 CPU？如果没有 early stop，吞吐量究竟下降多少？**

7. **如果对整个 Sketch 做一次结构化的 LDP 编码，而不是对每个 bit 独立 RR，是否可以显著改善 privacy–utility trade-off？**

---

## 最终评价

如果从“研究构思”看，SlideDP 是一篇**想法很紧凑、组合设计有新意**的工作：

> 它把 sliding-window expiration、Poisson sketch、XOR parity 和 randomized response 放进了一个统一框架。

其中最值得学习的是：

- Poisson thinning 带来的独立性；
- register / clock 状态解耦；
- 从扰动后 bit 分布反演 cardinality。

但如果从“理论严谨性与可复现性”看，目前仍有几个明显需要进一步核验的问题：

- 整张 Sketch 的 LDP composition；
- repeated release 的隐私累积；
- duplicate semantics；
- RR 描述不一致；
- 公式 (21)/(23) 疑似符号错误；
- 缺少真正的模块消融；
- \(\lambda,m,w\) 等实现参数未充分披露；
- 无官方代码。

因此我会把这篇论文评价为：

> **一个很值得借鉴的系统化设计思路，但在真正引用其隐私保证或误差上界之前，建议自行重新推导并做复现实验。**
