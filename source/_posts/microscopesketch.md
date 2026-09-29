---
layout: post
title: "《MicroscopeSketch: Accurate Sliding Estimation Using Adaptive Zooming》阅读笔记"
date: "2026-07-10 00:39:52"
updated: "2026-07-14 22:24:47"
permalink: papers/microscopesketch/
categories: ["论文阅读"]
tags: ["Sketch","滑动窗口","网络安全"]
excerpt: "MicroscopeSketch 通过一种类似\"共享浮点指数\"的 自适应缩放机制，在滑动窗口的多个子窗口之间共享计数尺度，以更少的内存保存更高精度的频率信息，并可作为通用组件嵌入 CM Sketch、CU Sketch、HeavyGuardian 和 SpaceSaving 等算法。"
disableNunjucks: true
comments: false
---

> **论文信息**：Yuhan Wu 等，发表于 **ACM SIGKDD Conference on Knowledge Discovery and Data Mining 2023（KDD 2023）**，会议时间为 2023 年 8 月 6 日至 10 日，论文共 12 页，DOI 为 `10.1145/3580305.3599432`。(Wu 等 - 2023 - MicroscopeSketch Accurate Sliding Estimation Using Adaptive Zooming.pdf)  
> **CCF 级别**：KDD 在 CCF"数据库、数据挖掘、内容检索"方向被列为 **CCF A 类会议**。([China Computer Federation](https://www.ccf.org.cn/Academic_Evaluation/DM_CS/))  
> **代码情况**：作者公开了实验代码，包含频率估计、top-\(k\) 和 heavy change 三部分实现：  
> [MicroscopeSketch GitHub 仓库](https://github.com/MicroscopeSketch/MicroscopeSketch)。仓库是公开可访问的，并以 C++ 实现；不过当前仓库首页没有显示明确的软件许可证，因此更严谨地说是"代码公开"，是否具备严格的开源授权需要进一步确认。([GitHub](https://github.com/MicroscopeSketch/MicroscopeSketch))

---

## 1. 摘要（Abstract）与核心贡献（Core Contribution）

### 一句话总结

MicroscopeSketch 通过一种类似"共享浮点指数"的 **自适应缩放机制**，在滑动窗口的多个子窗口之间共享计数尺度，以更少的内存保存更高精度的频率信息，并可作为通用组件嵌入 CM Sketch、CU Sketch、HeavyGuardian 和 SpaceSaving 等算法。

### 贡献列表（Contribution List）

- **提出通用滑动窗口计数框架 MicroscopeSketch**：它不是一个只解决单一查询的算法，而是一种可以替换传统 sketch counter 的压缩计数结构，支持基于时间和基于元素数量的滑动窗口。

- **提出 Adaptive Zooming 自适应缩放机制**：将每个子窗口的频率表示为
  $$
  a_i c^b,
  $$
  其中各子窗口分别保存低位计数 \(a_i\)，但共享同一个指数 \(b\)。当频率增大或减小时，结构自动调整指数与计数粒度。

- **统一支持三类流式任务**：包括任意元素频率估计、top-\(k\) 高频元素发现，以及相邻窗口间的 top-\(k\) heavy change 检测。

- **设计无偏随机舍入策略**：在缩放过程中采用随机舍入，使量化误差的期望为零。实验中，无偏查询相比单边高估或低估查询具有明显更低的误差。(Wu 等 - 2023 - MicroscopeSketch Accurate Sliding Estimation Using Adaptive Zooming.pdf)

---

## 2. 引言（Introduction）：问题背景与研究动机

### 2.1 问题定义（Problem Definition）

论文研究的是：在一个高速、持续到达的数据流中，如何用有限内存实时回答"最近一段时间"内的统计查询。

每个流元素携带一个键 \(e\)，例如：

- 网络数据包的五元组；
- 用户标识；
- 搜索词；
- 商品编号。

论文考虑两种滑动窗口。

#### 基于数量的滑动窗口

窗口由最近到达的 \(W\) 个元素组成。对于元素 \(e\)，其真实频率为

$$
f(e)=\sum_{j=N-W+1}^{N}\mathbb{I}(x_j=e),
$$

其中 \(N\) 是当前已经到达的元素总数。

#### 基于时间的滑动窗口

窗口覆盖时间区间

$$
[t-W,t].
$$

频率为

$$
f_t(e)=\sum_{j:\,t_j\in[t-W,t]}\mathbb{I}(x_j=e).
$$

在此基础上，论文研究三个任务：

1. **频率估计**：估计指定元素 \(e\) 在当前窗口内出现了多少次。
2. **top-\(k\) 高频元素**：找出频率最高的 \(k\) 个元素。
3. **top-\(k\) heavy changes**：比较两个相邻窗口，找出频率变化最大的 \(k\) 个元素：
   $$
   \operatorname{score}(e)=\left|f_1(e)-f_2(e)\right|.
   $$

这些任务广泛存在于流量测量、异常检测、在线计费、实时数据库查询和热点发现中。其难点在于：数据流不能完整存储，旧数据还需要随着窗口滑动及时失效。

---

### 2.2 现有方法的局限（Limitations of Prior Work）

#### 方法一：Sliding Sketches

Sliding Sketches 将一个滑动窗口划分为 \(T\) 个固定大小的子窗口，并为最近的 \(T+1\) 个子窗口分别维护 sketch。

它主要解决的是**时间维度**问题：

- 如何划分窗口；
- 如何清除过期子窗口；
- 如何减少窗口边缘近似误差；
- 如何让多个 sketch 的子窗口边界错位，从而选择窗口误差较小的估计。

其问题是，每个子窗口通常仍需要一个完整精度的计数器。例如，若每个计数器占 32 bit，则一个逻辑计数单元需要保存大约

$$
32(T+1)
$$

bit 的状态。

这导致两个后果：

1. 在固定内存下，能够分配的哈希桶或候选元素单元减少；
2. 哈希冲突、候选元素驱逐和 sketch error 随之增加。

换句话说，Sliding Sketches 优化了"哪些时间段应该被统计"，却没有充分优化"这些时间段的频率应该如何紧凑表示"。

#### 方法二：Exponential Histogram 与 ECM

Exponential Histogram 使用大小呈指数增长的 bucket 维护滑动窗口统计。每个 bucket 通常需要同时存储：

$$
\langle \text{count},\text{timestamp}\rangle.
$$

ECM 将每个 Count-Min Sketch counter 替换成一个 Exponential Histogram。

问题在于，每个底层 counter 都需要维护多个 bucket 和时间戳。对于拥有大量 counter 的 sketch，这种元数据开销非常高。内存紧张时，ECM 能够维护的桶数量有限，估计误差会迅速增大。

#### 方法三：WCSS

WCSS 以 SpaceSaving 为基础，通过记录元素在不同 block 中的 overflow 次数估计滑动窗口频率。它需要额外维护多个 overflow queue，而且为了保证不低估，还会加入额外的 block-size 补偿。

当内存不足时，队列和候选元素状态之间产生明显竞争，精度较差。

---

### 2.3 本文思路（Overall Idea）

作者注意到一个重要经验现象：

> 对于同一个 sketch counter 或同一个元素，它在相邻子窗口中的频率往往处于相近数量级。

例如，最近若干子窗口中的计数可能为

$$
58,\ 180,\ 5,\ 15,\ 256,\ 120,\ 200,\ 18,\ 57.
$$

这些值不同，但通常不需要每个都拥有独立的 32 bit 动态范围。

因此，作者借用了类似浮点数和 block floating-point 的思想，将频率写成

$$
f_i\approx P_i c^Z.
$$

其中：

- \(P_i\) 是第 \(i\) 个子窗口的小型"像素计数器"；
- \(Z\) 是所有子窗口共享的指数；
- \(c\) 是预先设定的缩放底数，通常取 \(2\)。

这样，多个子窗口不再分别保存完整计数器，而是共享尺度 \(c^Z\)。当某个计数器即将溢出时，系统统一降低所有 \(P_i\) 的分辨率并增大 \(Z\)；当整体频率变小时，再执行相反操作，恢复更细的分辨率。

这就是论文所谓的 **Adaptive Zooming**。(Wu 等 - 2023 - MicroscopeSketch Accurate Sliding Estimation Using Adaptive Zooming.pdf)

---

## 3. 方法论深度解析（In-depth Methodological Analysis）

### 3.1 整体架构（Overall Architecture）

MicroscopeSketch 并不直接代替 CM Sketch、HeavyGuardian 等完整算法，而是替换这些算法中的**一个传统 counter**。

整体关系可以表示为：

```text
数据流元素 e
    |
    v
基础算法的哈希或候选元素定位
    |
    v
定位到一个逻辑 counter
    |
    v
使用 MicroscopeSketch 表示该 counter
    |
    +-- Pixel Counters P[0], ..., P[T+1]
    +-- Zooming Counter Z
    +-- Shutter Counter S
    |
    v
插入、删除、窗口切换和查询
```

因此，MicroSketch-CM 的每个哈希桶不是一个整数，而是一个 MicroscopeSketch；MicroSketch-HG 的每个键值单元中的 frequency 也不再是普通整数，而是一个 MicroscopeSketch。

#### 数据结构

一个 MicroscopeSketch 包含：

$$
P[0],P[1],\ldots,P[T+1],
$$

共 \(T+2\) 个 pixel counter，以及：

- 一个 zooming counter \(Z\)；
- 一个 shutter counter \(S\)。

论文中的默认位宽是：

- 每个 \(P[i]\) 使用 \(l\) bit；
- \(Z\) 使用 5 bit；
- \(S\) 使用 32 bit。

对应的粗略状态开销为

$$
M_{\mathrm{Micro}}
=
(T+2)l+5+32.
$$

作为对比，若直接为最近 \(T+1\) 个子窗口分别保存 32 bit counter，则开销约为

$$
M_{\mathrm{naive}}
=
32(T+1).
$$

例如，取 \(T=8\)、\(l=4\)，则

$$
M_{\mathrm{Micro}}=10\times 4+5+32=77\ \text{bit},
$$

而普通表示需要

$$
M_{\mathrm{naive}}=9\times 32=288\ \text{bit}.
$$

这只是逻辑位宽估算，实际内存还受到字节对齐和结构体布局影响，但它直观说明了共享指数的压缩潜力。

#### 为什么需要 \(T+2\) 个 pixel counter？

一个长度为 \(W\) 的滑动窗口即使被划分为 \(T\) 个子窗口，在任意时刻也可能与 \(T+1\) 个固定子窗口相交：

- \(T-1\) 个完整子窗口；
- 一个当前部分子窗口；
- 一个最老的部分子窗口。

因此最多需要同时访问 \(T+1\) 个计数状态。

额外的一个 counter 被作为 **zero counter**：当环形数组向前移动时，它用于安全清除下一轮即将复用的过期位置，避免将旧窗口状态误认为新窗口数据。

---

### 围绕 Figure 1 理解数据流

论文 PDF 第 5 页的 **Figure 1** 给出了 \(c=2\)、pixel counter 为 8 bit 时的例子。

某个 pixel counter 原值为 \(255\)，下一次进位将使其达到 \(256\)，超过 8 bit 可表示范围。此时执行：

1. 所有 pixel counter 除以 \(2\)；
2. 共享指数 \(Z\) 增加 \(1\)。

缩放前，某个频率近似为

$$
P_i 2^Z.
$$

缩放后变为

$$
\frac{P_i}{2}2^{Z+1},
$$

在忽略舍入的情况下，两者完全相同。

这说明 zooming 操作并不是"删除一半频率"，而是在保持实际数值基本不变的前提下，改变表示单位：

- 缩放前，一个 pixel 单位代表 \(2^Z\) 次出现；
- 缩放后，一个 pixel 单位代表 \(2^{Z+1}\) 次出现。

其本质是用更粗的量化粒度换取更大的动态范围。(Wu 等 - 2023 - MicroscopeSketch Accurate Sliding Estimation Using Adaptive Zooming.pdf)

---

### 3.2 核心组件／模块拆解（Core Component Breakdown）

#### 3.2.1 Pixel Counter 与共享 Zooming Counter

##### 输入和输出

输入是某个逻辑 counter 在不同子窗口中的真实频率：

$$
f_0,f_1,\ldots,f_T.
$$

输出是近似表示：

$$
\hat{f}_i=P_i c^Z.
$$

其中所有 \(\hat{f}_i\) 共享 \(Z\)。

##### 内部机理

\(P_i\) 类似浮点数中的 significand，\(Z\) 类似 exponent。但与标准浮点数不同，MicroscopeSketch 不是每个数独立保存一个指数，而是让一组相邻子窗口共享一个指数。

这种形式更准确地说类似 **block floating-point**：

$$
\begin{aligned}
\hat{f}_0 &= P_0c^Z,\\
\hat{f}_1 &= P_1c^Z,\\
&\vdots\\
\hat{f}_T &= P_Tc^Z.
\end{aligned}
$$

共享指数的代价是，各个子窗口不能独立选择最优量化精度；其收益则是极大减少指数和高位信息的重复存储。

##### Zoom-out

当当前 pixel counter 即将达到

$$
2^l
$$

时，执行

$$
Z\leftarrow Z+1,
$$

并对所有 pixel counter 执行

$$
P_i\leftarrow \operatorname{Round}\left(\frac{P_i}{c}\right).
$$

这会扩大动态范围，但降低频率分辨率。

##### Zoom-in

在每个子窗口结束时，若所有 pixel counter 都满足

$$
P_i<\frac{2^l}{c},
$$

则执行

$$
Z\leftarrow Z-1,
$$

以及

$$
P_i\leftarrow cP_i.
$$

因为所有 counter 都位于较低范围，放大后不会溢出。此时一个 pixel 单位代表的真实频率变小，估计精度提高。

##### 设计动机

如果只提供 zoom-out，结构的量化粒度会随着历史峰值单调增大：即使流量后来下降，估计仍停留在粗粒度状态。

加入 zoom-in 后，结构可以根据最近窗口中的频率水平动态恢复精度。因此它不只是"压缩计数器"，而是一个具有反馈机制的动态量化系统。

---

#### 3.2.2 Shutter Counter：保存低于量化单位的余数

如果当前尺度为

$$
q=c^Z,
$$

那么 pixel counter 每增加 \(1\)，就代表真实频率增加了 \(q\)。

但每个新元素只贡献 \(1\)，不能每次都直接修改 \(P_{\mathrm{cur}}\)。因此作者引入 shutter counter \(S\)。

每次插入：

$$
S\leftarrow S+1.
$$

当

$$
S=q
$$

时执行：

$$
P_{\mathrm{cur}}\leftarrow P_{\mathrm{cur}}+1,
\qquad
S\leftarrow 0.
$$

因此 \(S\) 可以理解为尚未完成一次量化进位的余数。理想情况下，局部累计值可写成

$$
N=P_{\mathrm{cur}}q+S.
$$

##### 为什么窗口切换时通常不清空 \(S\)？

作者让下一个子窗口继承当前的余数。

假设当前子窗口结束时还剩 \(r<q\) 个元素没有进入 pixel counter：

- 对当前子窗口而言，少记录了 \(r\)，形成低估；
- 余数进入下一个窗口，后续进位时会使下一窗口偏高。

当查询把相邻子窗口求和时，这两个方向相反的误差会部分抵消。

这是一种很巧妙的工程设计：它没有试图为每个子窗口单独保存余数，而是利用窗口求和的结构，让误差在时间维度上传递并相互抵消。

不过，这个设计也意味着单独查询某一个子窗口时，估计值未必无偏。MicroscopeSketch 的主要优化目标是整个滑动窗口之和，而不是每个子窗口的独立精确统计。

---

#### 3.2.3 滑动窗口边界估计

窗口通常会完整覆盖最近的 \(T\) 个子窗口，同时只覆盖最老子窗口的一部分。

因此总频率估计写成

$$
\hat{f}
=
S+
\sum_{i=n-T+1}^{n}\hat{f}_i
+
\Delta f,
$$

其中：

- \(n\) 是当前子窗口编号；
- \(S\) 是尚未进位的低位余数；
- 中间求和项是最近 \(T\) 个子窗口；
- \(\Delta f\) 是最老部分子窗口的贡献。

论文给出三种 \(\Delta f\) 计算方式。

##### 线性近似

设子窗口宽度为 \(w\)，当前时间为 \(t\)，则最老子窗口仍位于滑动窗口中的比例为

$$
p
=
1-\frac{t\bmod w}{w}.
$$

于是

$$
\Delta f
=
p\hat{f}_{n-T}.
$$

这种方法隐含的假设是：元素在最老子窗口内部近似均匀分布。

如果一个子窗口中有 \(100\) 次出现，而窗口只保留其后半部分，则估计保留约 \(50\) 次。

##### 高估查询

$$
\Delta f
=
\hat{f}_{n-T}.
$$

即把最老子窗口全部计入。它适用于需要单边高估保证的场景，例如 CM Sketch，因为 CM Sketch 的查询逻辑依赖"不会低估"。

##### 低估查询

论文还构造了相应的保守修正，使结果满足单边低估性质，供 HeavyGuardian 等需要低估语义的算法使用。

这里最值得注意的是：MicroscopeSketch 不只追求平均误差小，还允许上层算法根据自身理论要求选择：

- 高估；
- 低估；
- 更准确但不具单边保证的近似。

这使它能够兼容不同 sketch 的误差语义。(Wu 等 - 2023 - MicroscopeSketch Accurate Sliding Estimation Using Adaptive Zooming.pdf)

---

#### 3.2.4 与不同基础 Sketch 的组合

##### MicroSketch-CM

Count-Min Sketch 使用 \(d\) 组哈希表。元素 \(e\) 映射到

$$
D_j[h_j(e)],\qquad j=1,\ldots,d.
$$

传统 CM 将这些整数 counter 全部增加 \(1\)，查询时返回最小值：

$$
\hat{f}(e)
=
\min_j D_j[h_j(e)].
$$

MicroSketch-CM 直接用 MicroscopeSketch 替换每个整数 counter，并使用高估查询，从而保留 CM Sketch 的单边高估性质。

##### MicroSketch-CU

Conservative Update 只更新当前估计最小的哈希 counter，以减少碰撞噪声。

在滑动窗口中，作者不是简单比较整个窗口的估计，而是比较当前子窗口中的频率：

$$
S+P_{\mathrm{cur}}c^Z.
$$

查询时也不是先得到每个哈希位置的总频率再取最小值，而是：

1. 对每个子窗口分别取 \(d\) 个映射位置中的最小 pixel counter；
2. 再对这些子窗口结果求和。

这是一个重要细节，因为通常有

$$
\min_j\sum_i x_{ij}
\neq
\sum_i\min_j x_{ij}.
$$

作者选择后者，是为了在每个时间片上分别抑制哈希冲突。

##### MicroSketch-HG

HeavyGuardian 每个 bucket 保存若干键值对

$$
\langle \mathrm{ID},\mathrm{frequency}\rangle.
$$

MicroscopeSketch 替换 frequency。

当新元素未被保存且 bucket 已满时，对最弱 guardian 进行概率衰减。删除操作需要从 MicroscopeSketch 的 \(S\) 或 pixel counter 中减去一个单位，使其能够支持 HeavyGuardian 的 decay 逻辑。

##### MicroSketch-SS

SpaceSaving 在 bucket 满时直接：

1. 找到频率最小的单元；
2. 将其频率加 \(1\)；
3. 用新元素替换其 ID。

MicroSketch-SS 使用高估查询，以维持 SpaceSaving 的上界性质。

##### Heavy change

为了同时保存两个连续滑动窗口，pixel counter 数量扩展为

$$
2T+2.
$$

分别估计

$$
\hat{f}_1(e),\qquad \hat{f}_2(e),
$$

并以

$$
\left|\hat{f}_1(e)-\hat{f}_2(e)\right|
$$

排序，得到 top-\(k\) heavy changes。(Wu 等 - 2023 - MicroscopeSketch Accurate Sliding Estimation Using Adaptive Zooming.pdf)

---

### 3.3 关键公式与算法（Key Equations and Algorithms）

#### 3.3.1 子窗口频率重建

论文的第一个核心公式是

$$
\hat{f}_i
=
P[i\bmod(T+2)]c^Z.
$$

##### 符号含义

- \(i\)：子窗口编号；
- \(P[\cdot]\)：环形数组中的 pixel counter；
- \(T+2\)：pixel counter 数量；
- \(Z\)：共享指数；
- \(c\)：缩放底数；
- \(\hat{f}_i\)：第 \(i\) 个子窗口的估计频率。

##### 公式目标

利用小位宽整数 \(P_i\) 和共享指数 \(Z\)，重建一个具有较大动态范围的近似频率。

##### 直觉

若 \(c=2\)、\(Z=4\)，则一个 pixel 单位代表

$$
2^4=16
$$

次出现。

如果 \(P_i=29\)，则该子窗口估计频率为

$$
29\times 16=464.
$$

其量化间隔为 \(16\)，因此任意真实值只能被表示为 \(16\) 的整数倍。增大 \(Z\) 会扩大表示范围，但同时增加量化误差。

---

#### 3.3.2 无偏随机舍入

执行 zoom-out 时，需要计算

$$
\frac{P_i}{c}.
$$

当 \(P_i\) 不能被 \(c\) 整除时，直接向上或向下取整都会产生系统偏差。

令

$$
P_i=qc+r,\qquad 0\leq r<c.
$$

随机舍入定义为

$$
P_i'
=
\begin{cases}
q+1, & \text{以概率 }\dfrac{r}{c},\\[6pt]
q, & \text{以概率 }1-\dfrac{r}{c}.
\end{cases}
$$

其期望为

$$
\begin{aligned}
\mathbb{E}[P_i']
&=
(q+1)\frac{r}{c}
+
q\left(1-\frac{r}{c}\right)\\
&=
q+\frac{r}{c}\\
&=
\frac{P_i}{c}.
\end{aligned}
$$

因此

$$
\mathbb{E}\!\left[P_i'c^{Z+1}\right]
=
P_ic^Z.
$$

也就是说，虽然一次具体缩放可能向上或向下偏离，但在概率意义上，缩放前后的频率表示保持一致。

其单次舍入方差为

$$
\operatorname{Var}(P_i')
=
\frac{r}{c}
\left(
1-\frac{r}{c}
\right),
$$

最大不超过

$$
\frac{1}{4}.
$$

考虑实际频率尺度后，对应的舍入噪声还要乘以 \(c^{2(Z+1)}\)。这说明随机舍入解决的是**偏差问题**，并不会消除方差；频繁 zooming 仍可能积累随机误差。

---

#### 3.3.3 插入算法的核心流程

对于一个到达元素，MicroscopeSketch 执行：

1. 找到当前子窗口的 pixel counter；
2. 清除环形数组中已经过期的 zero counter；
3. 执行
   $$
   S\leftarrow S+1;
   $$
4. 若
   $$
   S=c^Z,
   $$
   则执行进位：
   $$
   S\leftarrow 0,\qquad
   P_{\mathrm{cur}}\leftarrow P_{\mathrm{cur}}+1;
   $$
5. 若
   $$
   P_{\mathrm{cur}}=2^l,
   $$
   则对所有 pixel counter 进行 zoom-out。

从算法复杂度看，大部分插入只涉及 \(S\) 的加法和一次条件判断，时间为

$$
O(1).
$$

只有发生溢出缩放时，才需要遍历所有 \(T+2\) 个 pixel counter，代价为

$$
O(T).
$$

但 zoom-out 并非每次插入都执行，其触发频率随着 \(P_{\mathrm{cur}}\) 的动态范围增大而降低，可以视为低频维护操作。

---

## 4. 实验设计与结果分析（Experimental Design and Results Analysis）

### 4.1 实验设置（Experimental Setup）

#### 数据集

论文使用四类数据。

| 数据集   | 规模与特征                                                   |
| -------- | ------------------------------------------------------------ |
| CAIDA    | 约 \(27\) million 个数据包，约 \(1.3\) million 个不同五元组  |
| IMC      | 约 \(14\) million 个数据包，约 \(3.3\) million 个不同五元组，频率分布较平坦 |
| Zipf     | 约 \(32\) million 个元素，偏斜参数从 \(\alpha=0.3\) 到 \(\alpha=3.0\) |
| Web Page | 每个元素表示网页中的 distinct term 数量                      |

论文 PDF 第 6 页的 **Figure 2** 展示了这些数据集的频率累积分布。IMC 和低偏斜 Zipf 数据更平坦，因此 top-\(k\) 边界元素之间的频率差异较小，识别难度更高。

#### 实验硬件

实验运行在：

- Intel Core i7-8750H；
- 6 核 12 线程；
- 384 KB L1 cache；
- 1.5 MB L2 cache；
- 9 MB L3 cache。

#### 查询设置

- 滑动窗口大小通常为
  $$
  W=10^6
  $$
  个数据包；
- 每经过
  $$
  \frac{1}{100}
  $$
  个滑动窗口执行一次查询；
- 通过改变 counter 或 bucket 的数量调整总内存；
- 其余参数基本保持固定。

#### 基线

##### 频率估计

- Sliding Sketches + CM；
- Sliding Sketches + CU；
- SHE；
- ECM；
- MicroSketch-CM；
- MicroSketch-CU。

各算法哈希函数数量均设为

$$
d=3.
$$

##### top-\(k\)

- Sliding Sketches + HeavyKeeper；
- WCSS；
- MicroSketch-HG；
- MicroSketch-SS。

查询目标为 top-\(500\)。

##### heavy change

由于论文声称此前没有可直接完成滑动窗口 top-\(k\) heavy change 的方法，只与一个 strawman 方案比较。

#### 指标

平均绝对误差：

$$
\operatorname{AAE}
=
\frac{1}{n}
\sum_{i=1}^{n}
\left|\hat{f}_i-f_i\right|.
$$

平均相对误差：

$$
\operatorname{ARE}
=
\frac{1}{n}
\sum_{i=1}^{n}
\frac{\left|\hat{f}_i-f_i\right|}{f_i}.
$$

召回率：

$$
\operatorname{RR}
=
\frac{|\Omega\cap\Psi|}{|\Psi|},
$$

其中 \(\Omega\) 是算法返回的 top-\(k\) 集合，\(\Psi\) 是真实 top-\(k\) 集合。

吞吐率使用每秒百万次插入操作，即 Mops。(Wu 等 - 2023 - MicroscopeSketch Accurate Sliding Estimation Using Adaptive Zooming.pdf)

---

### 4.2 主实验结果（Main Results）

#### 4.2.1 频率估计

论文 PDF 第 7 页的 **Figure 3** 和第 8 页的 **Figure 7、Figure 8** 展示了频率估计结果。

在 CAIDA 上，与 Sliding Sketches 相比，MicroSketch：

- AAE 降低约 \(2.23\) 到 \(5.06\) 倍；
- 插入速度提高约 \(1.36\) 到 \(1.95\) 倍。

与 ECM 相比：

- AAE 降低约 \(130\) 到 \(200\) 倍；
- 插入速度提高约 \(6.96\) 到 \(8.65\) 倍。

与 SHE 相比：

- AAE 降低约 \(19.2\) 到 \(29.5\) 倍。

在不同数据集上：

$$
\operatorname{AAE}_{\mathrm{MicroCM}}<13,
$$

而

$$
\operatorname{AAE}_{\mathrm{MicroCU}}<8.
$$

##### 这些结果验证了什么？

MicroscopeSketch 的优势不是来自更复杂的统计模型，而是来自更高的**单位内存有效信息量**。

在同样内存下，它可以保留更多 CM/CU 哈希桶，从而降低碰撞误差。虽然计数压缩会引入量化误差，但实验说明：

$$
\text{减少的碰撞误差}
>
\text{新增的量化误差}.
$$

速度提升也支持这一解释。MicroscopeSketch 增加了缩放和舍入操作，理论上算术指令更多，却仍比基线快。这表明瓶颈主要不是整数运算，而是内存占用和 cache miss。紧凑状态使更多工作集进入 CPU cache，从而弥补并超过额外计算成本。

---

#### 4.2.2 top-\(k\) 高频元素

论文 PDF 第 7 页的 **Figure 4** 与第 8 页的 **Figure 9** 展示了 top-\(k\) 结果。

与 Sliding Sketches + HeavyKeeper 相比：

- MicroSketch-HG 的误差降低约 \(5.6\) 到 \(7.2\) 倍；
- 速度提高约 \(3.8\) 到 \(5.2\) 倍；
- MicroSketch-SS 的误差降低约 \(3.56\) 到 \(4\) 倍；
- 速度提高约 \(4.97\) 到 \(5.57\) 倍。

与 WCSS 相比，MicroSketch-HG 在部分设置下可获得约 \(3\) 到 \(15.1\) 倍的误差降低。

在 CAIDA 上，当内存达到 320 KB 时，多种方法的召回率均接近 \(97\%\)。但内存更紧张时，MicroSketch-HG 和 MicroSketch-SS 的优势更明显。

##### 对方法假设的验证

top-\(k\) 的主要困难并不只是频率值是否准确，还包括候选元素是否因为空间不足而被驱逐。

MicroscopeSketch 压缩每个 frequency counter 后，同一内存中可以容纳更多键值单元。因此它同时降低：

1. 频率量化和估计误差；
2. 热点元素被错误淘汰的概率；
3. 新元素与已有元素竞争时产生的 admission error。

这也是为什么它在小内存区域的召回率优势最明显：内存充足时，所有算法都能够保存大多数真实热点；内存不足时，计数状态的紧凑程度直接决定候选集合质量。

---

#### 4.2.3 Heavy change

论文 PDF 第 7 页的 **Figure 6** 将 MicroSketch-HG 与 strawman 进行比较。

两者均将窗口划分为子窗口，主要区别是：

- strawman 为不同子窗口保存普通计数；
- MicroSketch 使用量化和 adaptive zooming 压缩频率维度。

结果显示：

- 内存越紧张，MicroSketch 的召回率优势越明显；
- MicroSketch 的速度也更快；
- 在 320 KB 下，CAIDA 和 IMC 上的召回率超过 \(91\%\)；
- 在测试的 Zipf 数据上召回率超过 \(78\%\)。

这个实验是论文中最接近"隔离 adaptive zooming 贡献"的实验，因为二者的时间窗口划分基本一致，主要变量是频率表示方式。

不过，由于比较对象只是作者自行构造的 strawman，而非成熟的 heavy-change 基线，因此该实验更能证明"adaptive zooming 优于普通逐窗口计数"，但不足以证明该方案已经全面优于所有可能的 heavy-change 设计。(Wu 等 - 2023 - MicroscopeSketch Accurate Sliding Estimation Using Adaptive Zooming.pdf)

---

### 4.3 消融实验（Ablation Studies）

论文没有给出非常标准的"逐个移除 shutter、zoom-in、zoom-out、共享指数"的完整消融表，但提供了三组具有消融性质的实验。

#### 4.3.1 查询与舍入策略

论文 PDF 第 7 页的 **Figure 3(d)** 和 **Figure 5** 比较了单边估计与无偏估计。

频率估计中：

- MicroSketch-CM 高估版本的 AAE 约为 \(13\)；
- 无偏版本约为 \(4\)；
- MicroSketch-CU 高估版本约为 \(11\)；
- 无偏版本约为 \(3\)。

top-\(k\) 中：

- MicroSketch-HG 的单边版本 ARE 约为 \(0.04\)，无偏版本约为 \(0.01\)；
- MicroSketch-SS 的单边版本 ARE 约为 \(0.12\)，无偏版本约为 \(0.02\)。

这说明无偏舍入不是一个无关紧要的实现技巧，而是显著影响数值估计质量的组成部分。

不过，是否使用无偏查询需要取决于上层算法：

- 追求平均精度时，应使用无偏策略；
- 需要理论上的单边误差时，仍必须选择高估或低估版本。

#### 4.3.2 与 strawman 的比较

Figure 6 中，MicroSketch-HG 在紧内存下明显优于不使用自适应频率压缩的 strawman。

这表明最主要的性能来源是：

> 共享指数和 adaptive zooming 提升了内存效率，从而允许结构保存更多候选元素。

因此，从论文现有证据判断，贡献最大的模块仍是 adaptive zooming，而随机舍入是在此基础上的重要精度增强。

#### 4.3.3 参数 \(T\)、\(l\) 与 \(c\)

论文 PDF 第 11 页的 **Figure 10 至 Figure 13** 展示了参数敏感性。

##### 子窗口数量 \(T\)

增大 \(T\) 有两种相反作用：

- 正面作用：子窗口更细，窗口边缘误差更小；
- 负面作用：每个 MicroscopeSketch 占用更多内存，在固定总内存下可保存的哈希桶或 KV 单元减少。

因此 top-\(k\) 实验中呈现先改善、后恶化的趋势。

频率估计最终选择

$$
T=1.
$$

这看似反直觉，因为时间划分非常粗；但在固定内存下，CM/CU 的哈希碰撞误差可能比窗口边界误差更重要。将内存用于增加哈希桶，反而比增加子窗口数量更划算。

##### Pixel 位宽 \(l\)

增大 \(l\) 可以减小舍入和量化误差，但会增加每个逻辑 counter 的空间。

论文选择：

$$
l=4
$$

用于 MicroSketch-CM 和 MicroSketch-CU；

$$
T=12,\qquad l=8
$$

用于 MicroSketch-HG；

$$
T=4,\qquad l=6
$$

用于 MicroSketch-SS。

这说明没有一组参数适用于所有任务。频率估计更看重哈希桶数量，而 top-\(k\) 还必须保证候选元素的局部排序足够准确。

##### 缩放底数 \(c\)

论文 PDF 第 12 页的 **Figure 14 至 Figure 16** 显示，大多数情况下 \(c\) 从 \(2\) 变化到 \(16\) 对性能影响不大。

但对 MicroSketch-SS 而言，较小的 \(c\) 通常更准确。这是因为较大的 \(c\) 会导致一次 zoom-out 后量化步长突然扩大，对最弱候选元素的相对排序产生更明显影响。

---

### 4.4 具体实现细节

- 代码使用 C++ 实现，并使用 BOBHash。([GitHub](https://github.com/MicroscopeSketch/MicroscopeSketch))
- 频率估计实验中所有算法使用 \(3\) 个哈希函数。
- ECM 的 Exponential Histogram 参数设置为 \(u=2\)。
- MicroSketch 适配不同内存时，主要改变 counter 或 bucket 数量，而不是重新调节全部参数。
- HeavyGuardian 中使用指数衰减，论文给出的示例衰减常数为
  $$
  \beta=1.08.
  $$
- 实验中的 Speed 指标主要测量插入吞吐量，不是完整的"插入加查询"端到端吞吐量。
- top-\(k\) 查询需要遍历所有 KV 单元，因此如果查询非常频繁，其总成本可能明显高于论文报告的插入成本。
- 作者未上传全部 CAIDA 数据，因为数据规模和数据集授权限制，需要使用者自行获取。([GitHub](https://github.com/MicroscopeSketch/MicroscopeSketch))

---

## 5. 讨论与思考（Discussion and Reflection）

### 5.1 优点与创新点（Strengths & Innovations）

#### 💡 1. 切入点非常准确：压缩的是"跨时间的高位冗余"

很多滑动窗口工作主要优化窗口切分、过期机制和时间戳表示。本文则观察到，同一个逻辑 counter 在相邻子窗口中的频率通常共享相近数量级。

它没有简单地减少每个 counter 的位宽，而是把计数拆成：

$$
\text{局部低位}\times\text{共享尺度}.
$$

这是比固定低位 counter 更有结构的压缩方式：既保留大动态范围，也避免为每个子窗口重复保存高位。

#### 💡 2. 框架化程度高

MicroscopeSketch 可以嵌入：

- CM Sketch；
- CU Sketch；
- HeavyGuardian；
- SpaceSaving。

这说明其抽象层次合理：它修改的是 counter representation，而不是绑定某一种 admission、hash 或 query 策略。

#### 💡 3. 同时考虑数值误差与算法误差语义

很多压缩 counter 只讨论平均误差，但 CM Sketch、SpaceSaving 等算法依赖单边估计性质。

本文提供：

- 高估查询；
- 低估查询；
- 无偏查询。

这种设计使上层算法可以在"理论保证"和"平均准确率"之间选择。

#### 💡 4. 实验覆盖较完整

论文覆盖：

- 两类滑动窗口；
- 三类查询任务；
- 多种真实和合成分布；
- 误差、召回率和吞吐量；
- 参数敏感性；
- 查询策略和舍入策略。

特别是结果显示，结构不仅更准确，而且更快。这使"更好的 cache locality"这一工程价值比较可信。

---

### 5.2 局限性与可商榷之处（Limitations & Debatable Points）

#### ⚠️ 1. 共享指数依赖"相邻子窗口处于相近数量级"

Adaptive zooming 的核心假设是，一组 pixel counter 能够合理共享指数。

但考虑一个突发流：

$$
f_0=1,\quad
f_1=2,\quad
f_2=1,\quad
f_3=10^6.
$$

最后一个子窗口的突发可能反复触发 zoom-out，使共享指数 \(Z\) 急剧增大。这样，前几个低频子窗口的有效分辨率也会被迫变粗，甚至被舍入为零。

可以将其称为 **共享指数污染**：

> 一个极端子窗口决定了整组子窗口的量化尺度。

这对于 heavy-change 任务尤其值得警惕，因为 heavy change 恰恰关注强烈的非平稳和突发行为。论文使用了真实流量和 Zipf 数据，但没有专门构造"单窗口极端爆发、其他窗口极低"的对抗性实验。

#### ⚠️ 2. 误差理论没有完整放在主论文中

论文第 5 节表示，由于篇幅限制，详细误差分析放在 GitHub 的 supplementary material 中。

这削弱了主论文的理论可读性，尤其是以下内容没有在正文充分展开：

- 多次 zoom-in 与 zoom-out 后的误差累积；
- 随机舍入噪声是否具有独立性；
- 共享 shutter counter 引入的跨窗口相关误差；
- 线性边界近似在非均匀到达条件下的偏差；
- 高频缩放情况下的概率误差界。

论文提到，在窗口边缘频率稳定的假设下可以证明估计无偏，但"边缘稳定"恰好可能在异常检测场景中失效。

#### ⚠️ 3. Heavy change 缺乏强基线

作者指出没有现有方法能直接完成该任务，因此只与 strawman 比较。这一解释可以理解，但实验结论应限定为：

> MicroscopeSketch 比朴素的逐子窗口计数表示更高效。

它不能充分说明该方案优于以下潜在设计：

- 两个独立滑动窗口 sketch 的差分；
- 专门的 change sketch；
- 候选过滤与差值估计分离；
- 多分辨率时间金字塔；
- 对变化量而非原始频率直接编码的结构。

#### ⚠️ 4. 只测量插入吞吐量

论文的 Speed 指标定义为每秒插入操作数。

但是实际系统的总开销还包括：

- top-\(k\) 全表扫描；
- heavy-change 差值计算；
- 窗口切换时的 zoom-in 检查；
- 多次随机数生成；
- 并发更新和 cache coherence；
- 查询快照一致性。

特别是无偏随机舍入需要随机数。如果缩放操作较频繁，随机数生成器的选择可能对吞吐量产生明显影响，但论文未深入讨论。

#### ⚠️ 5. 未验证网络设备部署

论文声称结构足够紧凑，可以放入 CPU cache 或网络设备中，但实验仅在普通 CPU 上进行。

若部署到 P4 交换机或 FPGA，还会遇到：

- 动态循环难以实现；
- zoom-out 需要同时修改 \(T+2\) 个 counter；
- 随机舍入能力有限；
- 乘除法和可变移位的硬件成本；
- 多包并发更新时的一致性问题。

当 \(c=2\) 时，乘除可以转化为移位，比较适合硬件；但"对所有 pixel counter 统一缩放"仍可能需要多阶段 pipeline 或后台重编码机制。

#### ⚠️ 6. 删除操作可能产生时间归属偏移

当 \(S=0\) 且当前 pixel counter 也为零时，论文的删除操作会向前寻找第一个非零 pixel counter 并将其减一。

这能够维持总频率的近似一致，但被删除的单位可能来自较早的子窗口，导致频率在时间轴上的归属发生移动。

对于 HeavyGuardian 的概率 decay，这种近似可能可以接受；但若上层算法高度依赖精确的时间定位，删除逻辑需要重新评估。

#### ⚠️ 7. 参数需要按任务调节

不同任务采用了明显不同的 \(T\) 和 \(l\)：

- 频率估计偏好极小的 \(T\)；
- HeavyGuardian 偏好较大的 \(T\)；
- SpaceSaving 又采用另一组参数。

这说明 MicroscopeSketch 是通用表示框架，但还不是完全免调参的系统。部署者需要根据：

- 数据偏斜程度；
- 总内存；
- 窗口大小；
- 查询类型；
- 目标是 AAE、ARE 还是 recall；

联合选择参数。

另外，Figure 1 的文字描述与正文中的 zoom-in／zoom-out 命名存在一定不一致。理解实现时应以第 3.2 节的定义为准：增大 \(Z\)、缩小 \(P_i\) 是降低分辨率的操作。

---

### 5.3 未来工作与启发（Future Work & Inspirations）

#### 🚀 1. 分组共享指数

当前所有 \(T+1\) 个有效子窗口共享一个 \(Z\)。可以将它们分成若干组：

$$
\{P_0,\ldots,P_{g-1}\},
\quad
\{P_g,\ldots,P_{2g-1}\},
\quad\ldots
$$

每组保存独立指数。

这会形成连续的空间—精度折中：

- 一个全局指数：最省空间，但容易被极端窗口污染；
- 每组一个指数：中等空间，中等精度；
- 每个窗口一个指数：空间最大，精度最高。

值得研究如何根据窗口方差动态决定分组。

#### 🚀 2. 异常感知的指数隔离

当检测到某个子窗口的频率远高于其他窗口时，不立即让其触发全局 zoom-out，而是将其标记为 outlier，并采用：

- 独立溢出区；
- 饱和 counter；
- 额外高位；
- 稀疏异常表。

这样可能更适合 burst 和 heavy-change 场景。

#### 🚀 3. 在线参数自适应

当前 \(T\)、\(l\) 和 \(c\) 主要通过离线实验选择。后续可以根据在线指标动态调整，例如：

$$
\text{collision rate},
\quad
\text{zoom frequency},
\quad
\text{counter saturation rate},
\quad
\text{candidate eviction rate}.
$$

如果 zoom-out 过于频繁，说明 \(l\) 太小或分组不合理；如果大量高位长期未使用，则可以缩小位宽并增加 bucket 数量。

#### 🚀 4. 将误差预算分解为三部分

论文指出总误差主要来自：

$$
E_{\mathrm{total}}
=
E_{\mathrm{base}}
+
E_{\mathrm{window}}
+
E_{\mathrm{quantization}}.
$$

其中：

- \(E_{\mathrm{base}}\)：CM、HG 等基础算法的碰撞或候选误差；
- \(E_{\mathrm{window}}\)：窗口边界近似误差；
- \(E_{\mathrm{quantization}}\)：adaptive zooming 和舍入误差。

一个更进一步的系统可以给定总内存预算，自动求解：

$$
\min_{T,l,\text{bucket count}}
E_{\mathrm{total}}.
$$

这会把当前经验调参提升为理论驱动的内存分配问题。

#### 🚀 5. 面向硬件的惰性缩放

全量修改所有 pixel counter 对交换机或高并发 CPU 不友好。可以使用"逻辑指数版本"实现惰性缩放：

- 全局只更新 \(Z\) 和版本号；
- 每个 pixel counter 在下次访问时再完成实际转换；
- 使用少量版本位区分旧尺度和新尺度。

这样可将一次 \(O(T)\) 的突发操作分散到后续更新中。

---

## 值得进一步追问的问题

1. 当子窗口频率跨越多个数量级时，共享指数方案的最坏情况误差是多少？
2. zoom-in 和 zoom-out 频繁交替时，随机舍入误差是否会形成长期相关性？
3. 是否可以根据各 pixel counter 的离散程度，自适应选择一个或多个共享指数？
4. 在相同内存下，提升 pixel 精度和增加哈希桶数量之间的最优分配如何计算？
5. 对 heavy change 而言，直接压缩
   $$
   f_t-f_{t-W}
   $$
   是否会比先保存两个频率再相减更高效？
6. 如果查询频率远高于论文设置的每
   $$
   \frac{1}{100}
   $$
   个窗口一次，端到端性能是否仍然领先？
7. 在 P4、FPGA 或多核并发环境中，如何原子地完成共享指数更新和多个 pixel counter 的重缩放？

---

## 总体评价

MicroscopeSketch 最有价值的地方，不是提出了一种新的 top-\(k\) 或频率估计算法，而是提出了一种值得复用的 **滑动窗口 counter 表示方式**。

其核心思想可以概括为：

$$
\boxed{
\text{用共享尺度压缩相邻时间片的高位冗余，
再用自适应缩放管理动态范围}
}
$$

论文的实验较有说服力地证明了：在内存受限的数据流处理中，减少 counter 状态不仅能降低量化误差之外的哈希冲突和候选驱逐，还可能因为提高 cache locality 而同时提升吞吐量。

但它的优势建立在相邻子窗口频率尺度相对接近这一经验条件上。对于极端突发、剧烈非平稳或硬件部署场景，仍需要更细致的理论分析和专门实验。总体而言，这是一篇**思想简洁、工程实现干净、框架通用性较强，但最坏情况分析和系统部署验证仍有提升空间**的工作。
