---
layout: post
title: "QSketch：面向流式加权基数估计的高效量化 Sketch"
date: "2026-11-02 20:51:38"
updated: "2026-11-02 20:51:38"
permalink: papers/qsketch/
categories: ["Sketch","基数估计与超级传播者"]
tags: ["Sketch","基数估计","网络安全"]
excerpt: "QSketch 通过对指数分布寄存器做二进制对数量化来大幅压缩内存，再用量化后分布的 MLE 恢复加权基数；QSketch-Dyn 则进一步把每次“寄存器是否被新元素改变”视为一次随机采样事件，通过逆概率校正实现在线、无偏、近常数时间的加权基数追踪。"
disableNunjucks: true
comments: false
---

> **论文**：Yiyan Qi, Rundong Li, Pinghui Wang, Yufang Sun, Rui Xing. *QSketch: An Efficient Sketch for Weighted Cardinality Estimation in Streams*  
> **阅读定位**：流式算法 / Sketch / Weighted Cardinality Estimation / 数据库与网络测量  
> **核心关键词**：Exponential race、Quantization、MLE、Newton-Raphson、Inverse-probability weighting、Packed registers

---

### 开头：论文发表信息、CCF 级别与开源情况

| 项目 | 信息 |
|---|---|
| 正式发表 | **KDD 2024（The 30th ACM SIGKDD Conference on Knowledge Discovery and Data Mining）**，2024 年 8 月 25–29 日，Barcelona, Spain |
| 预印本 | arXiv:2406.19143v1，2024 年 6 月 27 日 |
| DOI | https://doi.org/10.1145/3637528.3671695 |
| CCF 级别 | **CCF A 类**，归入“数据库 / 数据挖掘 / 内容检索”方向；CCF 当前目录中 SIGKDD 位列 A 类会议 |
| 代码 | 作者论文中明确给出源码，当前 GitHub 仓库仍为 Public：https://github.com/Rezerolird/QSketch |
| 开源许可提示 | 仓库公开了源码和复现实验入口，但当前仓库根目录未看到 LICENSE 文件。因此更严谨的说法是“**公开源码**”；若涉及再分发、商用或衍生发布，应额外确认授权条款 |

**先给结论**：这篇论文最有价值的地方，不是简单地“把 64-bit 浮点数换成 8-bit 整数”，而是完成了两个关键转换：

1. 把原始 WCE 方法中的连续指数随机变量做 **log-domain 量化**，将“连续最小值统计”变成小整数寄存器，同时重新推导量化后的概率模型与 MLE；
2. 进一步利用 sketch 随时间发生的**状态变化事件**，构造 QSketch-Dyn，以逆概率加权的方式在流到达时直接累计估计值，从而避免每次查询再做全寄存器求解。

---

## 1. 摘要 (Abstract) 与核心贡献 (Core Contribution)

### 一句话总结

**QSketch 通过对指数分布寄存器做二进制对数量化来大幅压缩内存，再用量化后分布的 MLE 恢复加权基数；QSketch-Dyn 则进一步把每次“寄存器是否被新元素改变”视为一次随机采样事件，通过逆概率校正实现在线、无偏、近常数时间的加权基数追踪。**

### 贡献列表 (Contribution List)

- **贡献 1：提出 QSketch，解决 WCE sketch 的浮点寄存器过重问题。** 传统 Lemiesz / FastGM 使用 32-bit 或 64-bit 浮点寄存器保存指数随机变量；QSketch 将连续变量
  $$r=-\frac{\ln h(x)}{w}$$
  映射为
  $$y=\left\lfloor-\log_2 r\right\rfloor,$$
  使寄存器可以由短整数表示。论文主实验使用 8-bit 寄存器，因此同样寄存器数量下仅约为 64-bit 基线的 **1/8 内存**。

- **贡献 2：为量化后的寄存器重新建立统计模型，而不是直接套用旧估计器。** 作者推导每个离散寄存器值的概率质量函数，构造似然函数，并用 Newton-Raphson 求解 MLE。这个设计很关键：量化会丢失连续数值精度，如果仍使用 Lemiesz 的连续估计公式，会产生明显误差。

- **贡献 3：提出 QSketch-Dyn，利用 sketch 的动态演化做在线估计。** 每个元素只选择一个寄存器；若该元素成功改变寄存器，则按其“改变 sketch 的概率”进行逆概率校正。作者证明该估计在论文假设下无偏，并在实验中取得比 QSketch / LM / FastGM / FastExp 更低的误差和更高的更新吞吐。

---

## 2. 引言 (Introduction)：问题背景与研究动机

### 2.1 问题定义 (Problem Definition)

设数据流为

$$
\Pi=e^{(1)},e^{(2)},\ldots,e^{(t)},\ldots
$$

每次到达的元素对应某个标识 $x_i$，且该**唯一元素**关联一个正权重 $w_i>0$。同一个 $x_i$ 可以在流中重复出现。令 $N_\Pi^{(t)}$ 表示截至时刻 $t$ 已经出现过的不同元素集合，则加权基数定义为：

$$
C^{(t)}=\sum_{x_i\in N_\Pi^{(t)}}w_i.
$$

普通 distinct counting 是它的特例：如果所有 $w_i=1$，那么 $C^{(t)}$ 就是 distinct 元素个数。

这里真正困难的地方有三点：

- **流可能极长甚至无限**，不能保存所有历史元素；
- **重复元素不能被重复计权**，因此不能简单累加每个到达事件的 $w$；
- **高吞吐场景要求“更新快 + 内存小 + 随时可查询”同时成立**，例如路由器、IoT、网络安全监控。

论文还给出数据库结果集大小、加权投票、活跃度加权用户等应用。更抽象地说，WCE 估计的是一个集合上的加权测度：

$$
\mu(S)=\sum_{x\in S}w_x,
$$

而我们只能看见高速到达、可能重复的 stream。

### 2.2 现有方法的局限 (Limitations of Prior Work)

#### Lemiesz 方法：统计上优雅，但每个元素太贵

对第 $j$ 个寄存器，使用独立哈希 $h_j(x)\sim U(0,1)$，定义

$$
r_j(x_i)=-\frac{\ln h_j(x_i)}{w_i}.
$$

由于 $-\ln U\sim \mathrm{Exp}(1)$，因此

$$
r_j(x_i)\sim \mathrm{Exp}(w_i).
$$

寄存器保存所有不同元素对应随机变量的最小值：

$$
R[j]=\min_{x_i\in N_\Pi}r_j(x_i).
$$

指数分布有一个非常漂亮的性质：若 $X_i\sim\mathrm{Exp}(w_i)$ 独立，则

$$
\min_iX_i\sim\mathrm{Exp}\left(\sum_iw_i\right)=\mathrm{Exp}(C).
$$

于是 $m$ 个寄存器就相当于 $m$ 个独立的 $\mathrm{Exp}(C)$ 样本。Lemiesz 给出无偏估计器：

$$
\hat C=\frac{m-1}{\sum_{j=1}^{m}R[j]},
$$

且

$$
\mathrm{Var}\left(\frac{\hat C}{C}\right)=\frac{1}{m-2}.
$$

**痛点**：每来一个元素，需要为 $m$ 个寄存器生成并比较 $m$ 个随机变量，更新是 $O(m)$；为了高精度，$m$ 往往需要数百到数千。同时每个寄存器保存 32/64-bit 浮点值，内存代价也高。

#### FastGM / FastExp Sketch：把“全部生成”变成“有机会才继续生成”，但寄存器仍很重

FastGM 不再独立生成 $m$ 个指数变量后排序，而是直接按从小到大的顺序生成 order statistics。因为后续生成值只会更大，所以一旦当前值已经大到不可能更新任何寄存器，就可以提前停止。

这一策略显著加速更新，但仍有两类瓶颈：

1. **空间瓶颈没有解决**：仍保存 64-bit 浮点寄存器；
2. **查询仍需要扫描 $m$ 个寄存器**，即估计阶段仍是 $O(m)$；在需要 anytime estimation 的实时系统中，这一点并不理想。

此外，FastGM 在不利的数据顺序（例如权重随时间增长）下仍可能退化到较高更新成本。

### 2.3 本文思路 (Overall Idea)

作者的切入点可以概括成一句话：

> **既然最终只需要从指数随机变量中恢复参数 $C$，就没有必要高精度保存每一个连续样本；只要保留足够的“尺度信息”即可。**

因此，QSketch 对 $r$ 做 $-\log_2(\cdot)$ 变换。这个变换有两个效果：

- 把指数随机变量跨越多个数量级的连续取值压缩为整数；
- 把原来的“越小越重要”的 $r$，变成“越大越重要”的整数 $y$，从而可以使用类似 LogLog / HyperLogLog 风格的小寄存器。

但作者没有停在“工程量化”层面，而是承认量化后信息已经发生变化，因此重新建立离散分布并做 MLE。这使 QSketch 的设计形成完整的统计闭环。

QSketch-Dyn 再进一步：**终态寄存器只是信息的一部分，寄存器如何从旧状态跳到新状态本身也包含关于 distinct 元素的统计信息。** 作者利用这些状态变化构造在线估计量。

---

## 3. 方法论深度解析 (In-depth Methodological Analysis)

### 3.1 整体架构 (Overall Architecture)

论文没有一个传统深度学习式的大型网络架构图，核心示意是 **Figure 1（论文第 3 页）**：它展示了 FastGM/Lemiesz 的连续 $r$ 值如何经由对数量化映射为 QSketch 的整数层级。例如连续尺度大致按 $\ldots,1/4,1/2,1,2,4,\ldots$ 分桶，而 QSketch 只保存对应的整数级别 $\ldots,2,1,0,-1,-2,\ldots$。

可以把完整流程重画为：

```mermaid
flowchart LR
    A[流元素 (x,w)] --> B{QSketch}
    B --> C[按顺序生成 Exp(w) order statistics]
    C --> D[y = floor(-log2 r)]
    D --> E[更新 b-bit packed registers]
    E --> F[量化后 likelihood]
    F --> G[Newton-Raphson MLE]
    G --> H[weighted cardinality C_hat]

    A --> I{QSketch-Dyn}
    I --> J[j = g(x), 只选择一个寄存器]
    J --> K[计算 y 并判断是否改变 R[j]]
    K -->|未改变| L[估计值不变]
    K -->|改变| M[由直方图 T 计算改变概率 q_R]
    M --> N[C_hat += w / q_R]
```

#### 宏观设计差异

| 方法 | 保存什么 | 每个新元素尝试多少寄存器 | 估计发生在哪里 |
|---|---|---:|---|
| Lemiesz | 连续 64-bit exponential minima | $m$ | 查询时扫描寄存器 |
| FastGM | 同上，但按顺序生成并 early-stop | 0 到 $m$ | 查询时扫描寄存器 |
| QSketch | **量化后的整数尺度** | 0 到 $m$，可 early-stop | 查询时做离散 MLE |
| QSketch-Dyn | 量化整数 + 频数表 $T$ | **1** | **更新时增量维护** |

因此，QSketch 与 QSketch-Dyn 分别解决两个不同瓶颈：

- QSketch：**空间压缩**是第一目标；
- QSketch-Dyn：在保留空间优势的基础上进一步解决**在线查询和更新吞吐**。

---

### 3.2 核心组件/模块拆解 (Core Component Breakdown)

#### 3.2.1 组件一：对数量化——把连续指数变量变成小整数

##### 输入与输出

- **输入**：对元素 $(x,w)$ 生成的指数随机变量
  $$r_j(e)=-\frac{\ln h_j(x)}{w}.$$
- **输出**：整数
  $$y_j(e)=\left\lfloor-\log_2r_j(e)\right\rfloor.$$

寄存器更新由原来的

$$R[j]\leftarrow\min(R[j],r_j)$$

变为

$$R[j]\leftarrow\max(R[j],y_j).$$

##### 内部机理

这是整篇论文最容易“看起来简单、实际上很关键”的一步。

若

$$
y=r,
$$

则原始连续随机变量落在区间

$$
2^{-(r+1)}<R^*\le 2^{-r}.
$$

换句话说，一个整数寄存器并不是在保存某个精确 exponential sample，而是在保存：

> **“这个 exponential minimum 落在哪个二进制数量级区间里。”**

这可以理解成对连续 exponential race 的 **logarithmic interval censoring（对数区间删失）**。

##### 为什么设计成 $-\log_2$？

1. **动态范围巨大**：指数随机变量可能跨很多数量级，而对数会把乘法尺度压成加法尺度；
2. **二进制友好**：base-2 量化可以直接对应寄存器 bit 范围和位打包；
3. **顺序关系反转但保持单调**：$r$ 越小，$-\log_2r$ 越大，因此“保留最小 $r$”等价于“保留最大 $y$”；
4. **便于 early stop**：FastGM 产生的 $r$ 是递增的，因此对应的 $y$ 自动递减。

论文 **Figure 5（第 8 页）**进一步验证了 bit 数与动态范围之间的关系：4/5-bit 在有限基数范围内表现正常，一旦真实加权基数超出可表达尺度，误差迅速恶化；7/8-bit 则在测试范围内更加稳健。这与作者的 Theorem 1 是一致的。

#### 3.2.2 组件二：有序生成 + 全局最小寄存器 early stop

QSketch 继承 FastGM 的 order-statistics 生成思想，但在量化空间中利用了更直观的停止条件。

FastGM 生成的连续变量满足：

$$
r_{\pi_1}<r_{\pi_2}<\cdots<r_{\pi_m}.
$$

经过量化后：

$$
y_{\pi_1}\ge y_{\pi_2}\ge\cdots\ge y_{\pi_m}.
$$

QSketch 维护当前所有寄存器中的最小值位置

$$
j^*=\arg\min_jR[j].
$$

当当前生成的 $y$ 已满足

$$
y\le R[j^*],
$$

则可以立即停止。原因是 $R[j^*]$ 已经是所有寄存器的最小值，因此

$$
y\le R[j^*]\le R[j],\quad\forall j.
$$

而后续 $y$ 只会更小，于是它们不可能满足 $y>R[j]$，也就不可能再更新任何寄存器。

**设计动机**：作者并不是为了让 QSketch 在最坏情况下摆脱 $O(m)$，而是希望让“大多数普通流”尽早终止。论文承认，在权重不断增大的不利场景下，QSketch 仍可能出现 $O(mn)$ 的最坏总复杂度，这也是 QSketch-Dyn 被提出的直接动机之一。

#### 3.2.3 组件三：QSketch-Dyn——把“寄存器变化”变成一次可校正的随机采样

这是论文中我认为**最有思想性**的部分。

##### 输入与输出

对于每个到达的 $(x,w)$：

1. 用额外哈希函数 $g(x)$ 在 $m$ 个寄存器中选择一个 $j$；
2. 只计算该寄存器对应的 $y_j(e)$；
3. 判断 $y_j(e)$ 是否足以改变 $R[j]$；
4. 若改变，则立即对当前加权基数估计做一次增量更新。

##### 内部机理

设当前 sketch 状态为 $R$，新 distinct 元素权重为 $w$。该元素成功改变随机选中寄存器的概率为：

$$
q_R
=1-\frac{1}{m}\sum_{j=1}^{m}
\exp\left[-w\,2^{-(R[j]+1)}\right].
$$

令事件指示变量为

$$
I=\mathbf 1\{R_j^{(t)}\neq R_j^{(t-1)}\}.
$$

则

$$
\mathbb E[I\mid R]=q_R.
$$

作者于是使用：

$$
\Delta\hat C=\frac{I}{q_R}w.
$$

因为

$$
\mathbb E\left[\frac{I}{q_R}w\mid R\right]
=\frac{\mathbb E[I\mid R]}{q_R}w=w,
$$

所以每个首次出现的 distinct 元素在期望意义下恰好贡献它真实的 $w$。

这其实可以看成一种 **Horvitz-Thompson / inverse-probability weighting 风格的估计**：

- 一个元素不一定“被观察到”（即不一定改变寄存器）；
- 它以概率 $q_R$ 被观察到；
- 一旦被观察到，就把贡献放大为 $w/q_R$ 来抵消漏采样。

##### 为什么 QSketch-Dyn 可能比只看终态的 QSketch 更准？

QSketch / LM / FastGM 最终只使用**流结束时的寄存器快照**。大量“这个寄存器在什么时候、被哪些新元素推动过”的路径信息被丢掉。

QSketch-Dyn 则把每一次有效状态转移都利用起来。它不再只问：

> “最终寄存器是多少？”

而是不断问：

> “当前这个元素有多大概率会让 sketch 发生可观测变化？如果真的变化了，它代表了多少未被直接观察的质量？”

这就是动态方法能在 Figure 2 / Figure 3 中持续降低误差的核心统计直觉。

##### 频数表 $T$：把 $O(m)$ 的概率计算压成 $O(2^b)$

直接计算 $q_R$ 仍需遍历 $m$ 个寄存器。由于每个寄存器只有 $b$ bit，可能值最多为 $2^b$ 种。作者维护一个直方图：

$$
T[r]=\#\{j:R[j]=r\}.
$$

于是可把

$$
\sum_{j=1}^m f(R[j])
$$

改写成

$$
\sum_rT[r]f(r),
$$

复杂度从与 $m$ 相关变成与 $2^b$ 相关。对默认 $b=8$，表大小是 256。

因此更严格地说：

- QSketch-Dyn 每个元素只**尝试一个寄存器**，这部分是 $O(1)$；
- 需要更新估计时，$q_R$ 的计算是 $O(2^b)$；
- 作者把 $b$ 当作很小的固定常数，因此整体称为 $O(1)$ 更新。

这个“$O(1)$”是工程上合理的说法，但从参数化复杂度角度，写成 $O(1+2^b)$ 会更精确。

---

### 3.3 关键公式与算法 (Key Equations and Algorithms)

下面挑两组最关键的公式来讲。第一组解释“为什么量化后还能估”；第二组解释“为什么 QSketch-Dyn 在线累加仍然无偏”。

#### 3.3.1 关键公式一：量化寄存器的离散分布与 MLE

记未量化的单个寄存器最小值为 $R^*$。由指数最小值性质：

$$
R^*\sim\mathrm{Exp}(C).
$$

量化后保存的是

$$
R=\left\lfloor-\log_2R^*\right\rfloor.
$$

事件 $R=r$ 等价于：

$$
2^{-(r+1)}<R^*\le2^{-r}.
$$

因此：

$$
\Pr(R=r\mid C)
=\int_{2^{-(r+1)}}^{2^{-r}}Ce^{-Cx}\,dx
=e^{-C2^{-(r+1)}}-e^{-C2^{-r}}.
$$

##### 公式的目标

这一步不是直接输出 $C$，而是建立“**给定真实加权基数 $C$ 时，看到某个整数寄存器值的概率是多少**”。只有建立了这个离散观测模型，才能从 $m$ 个量化寄存器反推 $C$。

给定 $R[1],\ldots,R[m]$，似然为：

$$
L(C)=\prod_{j=1}^{m}
\left(
 e^{-C2^{-(R[j]+1)}}-e^{-C2^{-R[j]}}
\right).
$$

令

$$
a_j=2^{-(R[j]+1)},
$$

论文把对数似然的一阶导数整理为：

$$
f(C)=\sum_{j=1}^{m}
a_j\cdot
\frac{2-e^{Ca_j}}{e^{Ca_j}-1}.
$$

MLE 要求：

$$
f(C)=0.
$$

该方程没有方便的闭式解，于是使用 Newton-Raphson：

$$
\hat C^{(\ell+1)}
=\hat C^{(\ell)}-
\frac{f(\hat C^{(\ell)})}{f'(\hat C^{(\ell)})}.
$$

初值取：

$$
\hat C^{(0)}
=\frac{m-1}{\sum_{j=1}^{m}2^{-R[j]}}.
$$

##### 各部分的逻辑含义

- $2^{-R[j]}$：把量化尺度粗略映回连续 $r$ 的数量级；
- likelihood：承认每个寄存器只告诉我们一个区间，而非精确值；
- Newton-Raphson：在没有闭式 MLE 的情况下数值求根；
- 初值：用“把每个桶代表值近似看成连续样本”的估计做 warm start。

##### 直觉

这是一个典型的“**量化换空间，统计建模补精度**”方案。

如果只是把 64-bit $r$ 截成 8-bit $y$，再直接把 $2^{-y}$ 当成真实 $r$，量化误差会系统性进入估计器；而 MLE 的做法是说：

> 我并不知道真实 $r$ 是多少，但我知道它一定在这个 dyadic interval 里；那就直接对“落入这个 interval 的概率”做参数估计。

所以 QSketch 的统计合理性并不来自量化本身，而来自**量化 + 正确 likelihood**的组合。

#### 3.3.2 截断与动态范围：Theorem 1 的意义

实际寄存器只有 $b$ bit，不可能保存任意大的正负整数，因此作者将 $R$ 截断到 $[r_{\min},r_{\max}]$。

对给定很小的 $\varepsilon$，当

$$
-2^{r_{\min}+1}\ln\varepsilon
<C<
-2^{r_{\max}}\ln(1-\varepsilon),
$$

寄存器落到可表达范围之外的概率可以被控制在很小水平。

论文给出一个很有冲击力的例子：当

$$
r_{\min}=-127,\qquad r_{\max}=127,\qquad\varepsilon=0.001,
$$

其覆盖的加权基数尺度约为：

$$
8.1\times10^{-38}\le C\le3.4\times10^{35}.
$$

这解释了为什么 8-bit 仍能覆盖极其宽的数值范围：保存的不是线性数值，而是**对数尺度索引**。

需要注意：论文中的 8-bit 表示与有符号区间写法是理论描述；公开代码使用 packed unsigned integer，并通过不同实现细节处理范围。复现时应以代码中的 offset / range 逻辑为准并核对论文设定，后文会专门讨论这一点。

#### 3.3.3 关键公式二：QSketch-Dyn 的逆概率在线估计

QSketch-Dyn 最核心的更新式是论文 Equation (12)：

$$
\hat C^{(t)}
\leftarrow
\hat C^{(t-1)}+
\frac{
\mathbf 1\left(R[j]^{(t)}\neq R[j]^{(t-1)}\right)
}{q_R^{(t)}}\cdot w.
$$

其中：

- $w$：当前 distinct 元素的权重；
- $j=g(x)$：该元素被哈希到的寄存器；
- 指示变量：该元素是否真的把寄存器推高；
- $q_R^{(t)}$：在当前 sketch 状态下，该元素能够触发寄存器变化的概率。

作者推导：

$$
q_R^{(t)}
=1-\frac{1}{m}
\sum_{j=1}^{m}
\exp\left[-w\,2^{-(R[j]+1)}\right].
$$

##### 公式的目标

目标是让每个首次出现的 distinct 元素，即使只有概率 $q_R$ 能被 sketch “看见”，其**期望贡献仍然等于真实权重 $w$**。

因为

$$
\mathbb E[I\mid R]=q_R,
$$

所以

$$
\mathbb E\left[\frac{I}{q_R}w\mid R\right]=w.
$$

对所有 distinct 元素利用期望线性性即可得到：

$$
\mathbb E[\hat C^{(t)}]=C^{(t)}.
$$

这与 QSketch 的 MLE 有一个重要区别：

- **QSketch MLE：渐近无偏（asymptotically unbiased）**；
- **QSketch-Dyn：在作者假设与哈希随机性模型下给出无偏性证明**。

##### 公式的直觉

设某个元素只有 $10\%$ 概率改变 sketch，即 $q=0.1$。如果它真的改变了，就把它的 $w$ 放大为 $10w$；90% 情况下贡献 0。期望仍为：

$$
0.1\times10w+0.9\times0=w.
$$

这种做法也直接暴露了 QSketch-Dyn 的风险：**当 $q_R$ 很小时，$w/q_R$ 会变得很大，方差会被放大。**

论文 Theorem 2 的方差正好体现这一点：

$$
\mathrm{Var}(\hat C^{(t)})
=\sum_{i\in T_s^{(t)}}
(w^{(i)})^2
\mathbb E\left[
\frac{1-q_R^{(i)}}{q_R^{(i)}}
\right],
$$

其中 $T_s^{(t)}$ 是各 distinct 元素**第一次出现**的时间戳集合。

因此：

- $q_R\approx1$：几乎每个元素都能改变 sketch，估计接近精确计数；
- $q_R\ll1$：变化事件稀少，单次校正权重巨大，方差会明显上升。

这也解释了论文 Figure 4 中小数据规模时 QSketch-Dyn 非常准确的现象：寄存器还很“空”，新元素很容易触发状态变化，$q_R$ 接近 1。

---

## 4. 实验设计与结果分析 (Experimental Design and Results Analysis)

### 4.1 实验设置 (Experimental Setup)

#### 实现与硬件

- 所有算法使用 **C++** 实现；
- CPU：Quad-Core Intel Xeon E3-1226 v3 @ 3.30 GHz；
- 默认结果由 **100 次独立运行**统计；
- QSketch / QSketch-Dyn 默认使用 8-bit 寄存器；
- LM / FastGM / FastExp Sketch 使用 64-bit 寄存器；
- 在同样的寄存器数 $m$ 下，QSketch 系列的寄存器主体内存约为基线的 1/8。

作者还采用 `PackedVector` 思路：一个 32-bit word 中打包多个短寄存器。对于 8-bit register，一个 word 可容纳 4 个寄存器，既省空间，也减少部分内存访问。

#### 数据集

**Synthetic：**

- Uniform $U(0,1)$；
- Gaussian $N(1,0.1)$；
- Gamma $\gamma(1,2)$；
- 数据规模从约 $10^2$ 到 $10^6$。

**Real-world：**

- Twitter；
- Real-sim；
- Rcv1；
- Webspam；
- News20；
- Libimseti。

论文 Table 1 给出的多流数据规模如下：

| Dataset | #Documents | Vector Size |
|---|---:|---:|
| Real-sim | 72,309 | 20,958 |
| Rcv1 | 20,242 | 47,236 |
| Webspam | 350,000 | 16,609,143 |
| News20 | 19,996 | 1,355,191 |
| Libimseti | 220,970 | 220,970 |

其中 Real-sim / Rcv1 / Webspam / News20 使用文档向量中的 TF-IDF 作为权重，Libimseti 使用评分值。

**Appendix A.4 还加入 CAIDA 大规模流量数据：**1 分钟 trace 约 27M packets，元素标识为 $(srcIP,dstIP)$，packet size 作为权重。这一组实验很重要，因为它比主文档数据更接近真正的高速网络 stream。

#### Baselines

- LM（Lemiesz）；
- FastGM；
- FastExp Sketch；
- 本文 QSketch；
- 本文 QSketch-Dyn。

#### Metrics

单流用 RRMSE：

$$
\mathrm{RRMSE}(\hat C)
=\frac{\sqrt{\mathbb E[(\hat C-C)^2]}}{C}.
$$

多流用 AARE：

$$
\mathrm{AARE}
=\frac1n\sum_{i=1}^n
\frac{|\hat C_i-C_i|}{|C_i|}.
$$

效率使用：

- Throughput：Million updates per second (Mops)；
- Estimation Time：从 sketch 计算当前 weighted cardinality 的时间。

---

### 4.2 主实验结果 (Main Results)

#### Figure 2：真实数据上的准确率

论文 Figure 2（第 7 页）改变寄存器数：

$$
m\in\{2^6,2^7,\ldots,2^{12}\}.
$$

主要结论有两层：

1. **QSketch 与 LM / FastGM / FastExp 的误差大体相当。** 这非常关键，因为 QSketch 每个寄存器只有 8 bit，却没有因为量化而明显牺牲精度。这验证了“量化 + 离散 MLE”能够补偿大部分量化信息损失。
2. **QSketch-Dyn 多数情况下进一步更准。** 论文举例：Twitter 上 $m=2^8$ 时，QSketch-Dyn 相对其他方法约提升 30% 的准确度。

这里真正支持作者方法论假设的不是“曲线更低”本身，而是：

> 如果终态寄存器量化造成了不可接受的信息损失，那么 QSketch 应显著差于 LM/FastGM；但结果没有出现这种退化，说明对数尺度确实保留了估计 $C$ 所需的大部分信息。

而 QSketch-Dyn 更低的误差，则支持“**动态路径信息比单一终态快照更丰富**”这一假设。

#### Figure 3：不同权重分布

Uniform / Gaussian / Gamma 下趋势一致：QSketch 仍与浮点基线接近，QSketch-Dyn 通常最好。

这个实验说明方法并非只在某个特定权重分布下成立。但需要指出，三种分布仍然属于比较温和的合成分布，并没有专门测试极端 heavy-tail、超高 skew 或 adversarial weight order；因此“分布鲁棒性”的结论仍有边界。

#### Figure 4：数据规模变化

固定 $m=2^8$，数据量从 $10^2$ 增到 $10^6$。

- LM / FastGM / FastExp / QSketch 的误差基本不随数据规模变化；
- QSketch-Dyn 在小规模下误差非常低，随后逐渐接近约 0.05 的稳定区间。

这里有一个值得注意的**论文文字与图形不完全一致**之处：正文说 QSketch-Dyn 随数据规模增大有 “slight improvement”，但从 Figure 4 的曲线和紧接着的解释看，更合理的解读是：**小规模时更接近精确计数，规模变大后误差上升并趋于稳定**。作者自己给出的原因也是“小规模时多数寄存器只被一个元素占据，因此几乎精确”，这与“误差从低位上升到稳定值”的解释更一致。

这是阅读论文时值得保留的一个小警惕：不要只读 caption / prose，要同时看曲线。

#### Figure 5：寄存器 bit 数与动态范围

作者测试 4/5/6/7/8-bit，并把数据的最大权重跨越 $10^{-10}$ 到 $10^{10}$。

结果非常符合 Theorem 1：

- bit 少时，某个有限区间内仍然准确；
- 一旦 $C$ 超出寄存器可表达范围，截断导致误差迅速放大；
- 7/8-bit 在测试范围内较稳定。

因此，bit 数主要控制的是**可表达动态范围**，而不是简单地“bit 越多、所有情况下越准”。只要真实 $C$ 处在安全区间内，再增加 bit 的收益会迅速变小。

---

### 4.3 效率结果

#### Figure 6：真实数据上的更新吞吐

随着 $m$ 增加：

- LM 吞吐明显下降；
- FastGM / FastExp 比 LM 更快，但仍随 $m$ 下降；
- QSketch 因短整数打包和更少内存访问，很多数据集上比 FastGM/FastExp 更快；
- **QSketch-Dyn 的吞吐几乎不随 $m$ 变化。**

在 Rcv1 上，论文报告 QSketch-Dyn 的更新时间相对 FastGM / LM 可短约 2–3 个数量级。

这直接验证了 QSketch-Dyn 的核心复杂度主张：它不再让“每元素要尝试多少寄存器”随 $m$ 增长。

#### Figure 7：合成数据吞吐

三个分布趋势一致。论文总结 QSketch-Dyn 大致可比 FastGM 快约 10 倍、比 LM 快约 100 倍。

不过需要谨慎理解摘要中的“two orders of magnitude faster”：

- 对 LM 或某些数据/参数确实能达到约 100×；
- 对更强的 FastGM，以及 Appendix CAIDA 的超大规模设置，优势可能是 5×、10× 或更高，而不是始终 100×。

因此，“两个数量级”更像代表性峰值/典型结论，而不是所有 benchmark 上的统一下界。

#### Figure 8：估计时间

QSketch 的弱点在这里非常明确：MLE 需要多次 Newton 迭代，每次都扫描寄存器，因此 query 比 LM/FastGM/FastExp 更贵。

作者给出的量级是：$m=4096$ 时，QSketch 估计时间约 0.01 s，认为在“更新频繁、查询较少”的场景仍可接受。

QSketch-Dyn 则没有单独 estimation phase，因为 $\hat C$ 在更新过程中已经维护完成。这是它在 anytime estimation 场景下的真正优势。

#### Appendix Figure 10：CAIDA 大规模数据

CAIDA 上 $m$ 扩展到 $2^{20}$：

- 所有方法随寄存器数增加而更准，但吞吐下降；
- QSketch-Dyn 准确率仍最好；
- 当 $m=2^{20}$ 时，作者称其估计精度约为其他方法的 2 倍；
- 当 $m\approx2^{19}$ 时，QSketch-Dyn 约 1 Mops，而 FastGM / QSketch / FastExp 约 0.2 Mops，即约 5×。

这一结果很有价值，因为它说明 QSketch-Dyn 的优势在大 $m$ 时仍能保持，但也提醒我们：**实际加速比随数据、$m$ 和 baseline 而变化。**

---

### 4.4 消融实验 (Ablation Studies)

严格地说，这篇论文**没有提供典型的 component-wise ablation table**。因此不能像深度学习论文那样直接回答“去掉模块 A 降多少、去掉模块 B 降多少”。最接近消融的证据有两类。

#### 近似消融 1：QSketch vs QSketch-Dyn

这组比较显示引入动态在线估计后，准确率与吞吐都明显改善。

但它不是纯净消融，因为 QSketch-Dyn 同时改变了：

- 每元素更新的寄存器数量；
- 估计方式（MLE → 动态逆概率）；
- 是否使用 histogram $T$；
- 是否使用终态查询。

因此我们可以说“动态版本整体贡献最大”，但**不能仅凭这组实验把增益归因到某一个子机制**。

#### 近似消融 2：Figure 5 的 register bit 数

这是对“量化/截断强度”的直接敏感性实验。它验证了：

- bit 太少时，动态范围不足会导致严重截断；
- 进入理论安全区间后，更多 bit 的收益有限。

#### 论文缺失、但我认为最应该补的消融

1. **Quantization + naive estimator vs Quantization + MLE**：直接验证 MLE 到底补回多少量化损失；
2. **QSketch early-stop on/off**：量化后停止条件究竟带来多少吞吐收益；
3. **QSketch-Dyn 直接 $O(m)$ 计算 $q_R$ vs histogram $T$**：定量验证 $T$ 的工程价值；
4. **同一个动态估计器在浮点寄存器 vs 8-bit 寄存器上比较**：分离动态估计增益与量化影响；
5. **equal-memory budget 对比**：例如固定 64 KB，让 QSketch 使用 8× 寄存器，而 baseline 使用较少寄存器，比较最终 accuracy-throughput Pareto frontier。

最后一项尤其重要：论文当前主要采用“相同寄存器数”比较，所以可以很好地证明“同等统计样本数下，我只用 1/8 寄存器内存”；但工业系统往往更关心“**给我同样 64 KB，谁最准确/最快**”。这两种比较回答的是不同问题。

---

### 4.5 具体实现细节

论文与公开仓库结合起来看，有以下实现要点：

- 仓库包含 `lm.h`、`fastgm.h`、`fastexp.h`、`qsketch.h`、`qdyn.h`、`PackedVector.hpp`、`MurmurHash3.*` 和 `main.cpp`；
- README 给出的编译方式为：

```bash
g++ -o main main.cpp MurmurHash3.cpp -std=c++17 -O3
```

- `PackedVector.hpp` 使用 `uint32_t` word，把固定 bit-width 的多个 register 紧凑打包；
- `qsketch.h` 中 Newton-Raphson 的收敛阈值设为约 $10^{-5}$；
- `qdyn.h` 中 histogram 大小为 $2^b$，只有寄存器真的发生变化时才计算 $q_R$ 并增加估计值；
- 公开代码使用 MurmurHash3 生成哈希随机数。

#### 复现时值得核验的两个代码/论文差异

这些属于**我对公开代码的额外核验，不是论文正文自己的结论**。

**(1) QSketch-Dyn 的随机性实现与理论写法不完全一致。**

论文方法描述中，$g(x)$ 用来随机选择寄存器，而 $h_j(x)$ 用于生成 exponential variate，推导时把对应概率分解为

$$
\Pr(y>R[j]\land g(x)=j)
=\Pr(y>R[j])\Pr(g(x)=j),
$$

这隐含了相应独立性结构。

但当前 `qdyn.h` 里，一个 32-bit `hv` 同时用于：

- `counter_id = hv % m`；
- `u = hv / UINT32_MAX`；
- 然后 $r=-\ln u/w$。

也就是说，寄存器选择和 uniform variate 使用了同一个 hash result。工程上可能影响很小，但如果严格对应论文证明，最好改成两个独立 seed / 两个独立 hash stream 再复现实验。

**(2) 论文中的有符号寄存器区间与当前 demo 代码的 unsigned packed representation 需要仔细对应。**

论文实验写的是 $r_{\min}=-127,r_{\max}=127$；而公开实现为了放入 `PackedVector`，QSketch-Dyn 使用 offset 把量化值平移到非负整数区间。`qsketch.h` 与 `qdyn.h` 的 offset 处理也不完全同形。复现论文 Figure 5 时，不建议只依据公式手写代码，应逐项核对当前仓库的 register encoding。

此外，README 展示的运行参数顺序与 `main.cpp` 中 `argv` 的解析顺序存在可读性上的不一致，实际运行前也应以源码为准。

这些问题不否定论文方法，但说明该仓库更像**研究代码 / 最小复现实装**，而不是经过完整工程封装的 library。

---

## 5. 讨论与思考 (Discussion and Reflection)

### 5.1 优点与创新点 (Strengths & Innovations)

#### 优点 1：创新点非常“sketch-native”，不是硬套复杂模型

QSketch 的核心操作只有一行：

$$
y=\lfloor-\log_2r\rfloor.
$$

但它建立在指数 race、最小值分布、量化区间概率和 MLE 上，属于**结构简单、统计解释完整**的算法设计。这类工作往往比堆叠复杂模块更难，因为每一位内存都要有理论意义。

#### 优点 2：空间优化不是靠经验压缩，而是有概率模型兜底

很多“低 bit sketch”工作最大的风险是压缩之后 bias 无法解释。本文明确推导量化后的 PMF，再从该 PMF 出发重新做 MLE。这一步让“8-bit”不只是工程 trick。

#### 优点 3：QSketch-Dyn 把时间维度变成信息源

这是最值得借鉴的研究思路之一：

> 传统 sketch 往往只把状态当成 sufficient summary；本文进一步问，**state transition 本身能不能被统计利用？**

QSketch-Dyn 的答案是可以，而且它把一次 state transition 解释成有已知 inclusion probability 的抽样事件。

这个思路并不限于 weighted cardinality。凡是 sketch 有单调状态变化、且能计算“新样本触发状态改变的概率”，都可能尝试类似的动态逆概率估计。

#### 优点 4：理论、系统效率和真实数据三者结合得较完整

论文同时给出：

- 量化 PMF 与 MLE；
- 截断范围 Theorem 1；
- QSketch-Dyn 无偏与方差 Theorem 2；
- synthetic + 文本数据 + 社交数据 + CAIDA 网络流量；
- accuracy、throughput、estimation time；
- 公开代码。

对于一篇 systems-oriented data mining / sketch paper，这个证据链总体比较完整。

---

### 5.2 局限性与可商榷之处 (Limitations & Debatable Points)

#### 局限 1：只处理正权重、固定元素权重；不支持删除和负权重

问题定义要求：

$$
w_i>0.
$$

并且同一个 distinct element $x_i$ 对应固定权重 $w_i$。这意味着现实中下面几类场景并未覆盖：

- 元素后来被删除；
- 同一 key 的权重随时间改变；
- 正负贡献同时存在；
- sliding window / time decay。

作者也在结论中明确把 deletions 和 negative weights 作为未来工作。

#### 局限 2：QSketch-Dyn 的无偏不等于低方差，$q_R\to0$ 时可能不稳定

Theorem 2 已经把这一点写在公式里：

$$
\frac{1-q_R}{q_R}
$$

会在 $q_R$ 很小时迅速放大。

因此，QSketch-Dyn 的强项更准确地说是：

> **在 sketch 仍有足够“可变化空间”、即 inclusion probability 不太小时，它能够高效地利用动态信息。**

论文虽然在多组数据上表现很好，但没有系统地构造“$q_R$ 长期很小”的 stress test，例如：

- 极强 heavy-tail 权重；
- adversarial arrival order；
- sketch 长时间接近饱和；
- 少数超大 $w$ 与大量超小 $w$ 混合。

这些场景值得进一步验证。

#### 局限 3：QSketch-Dyn 很可能失去传统 sketch 最重要的“可合并性”优势

QSketch 的终态寄存器本身具有自然的 max-merge 直觉：若哈希一致，多个子流的寄存器可以按位取最大，得到类似联合流的状态。

但 QSketch-Dyn 的 $\hat C$ 是沿着**具体到达顺序与状态路径**累积得到的：

$$
\hat C\leftarrow\hat C+I\frac{w}{q_R}.
$$

两个机器各自处理一半数据后，单纯把两个 $\hat C$ 相加或把两个 register array merge，并不能显然恢复“如果所有元素按某个统一顺序进入同一个 QSketch-Dyn”时的估计过程。

论文没有讨论 distributed merge / union operator。这对真正的流式基础设施非常重要，因为 sketch 的经典价值之一就是可分布式聚合。

#### 局限 4：“O(1) 更新”依赖固定小 $b$

作者计算 $q_R$ 需要遍历最多 $2^b$ 个 histogram bin。因此严格复杂度是：

$$
O(2^b),
$$

只是在 $b=8$ 等固定小常数时可视为 $O(1)$。

这个表述没有实质问题，但做算法比较时应区分：

- 对 $m$ 的复杂度为常数；
- 对 register precision $b$ 并非常数。

#### 局限 5：内存“1/8”是主寄存器层面的近似，不是所有规模下精确的总内存比

QSketch-Dyn 除了 $mb$ bit 的寄存器，还需要：

$$
2^b\log_2m
$$

量级的 histogram counter 空间。

当 $m$ 很大时这项可以忽略，因此“约 1/8”合理；但在小 $m$ 场景，额外表并非完全免费。

此外，更公平的系统评估最好同时报告：

- same-$m$；
- same-byte-budget；
- same-throughput-budget。

论文主要强调第一种。

#### 局限 6：QSketch 的 query 端 MLE 开销是真实存在的

QSketch 把内存问题解决得很好，但代价是查询时需要数值迭代。若系统要求每个 packet 后都输出估计，QSketch 本体并不是最佳选择；真正适合这个需求的是 QSketch-Dyn。

因此两者不是简单的“基础版 / 高级版”，而更像两种部署点：

- **QSketch**：更新频繁、查询相对低频、强调紧凑存储；
- **QSketch-Dyn**：需要持续在线数值、强调 latency / throughput。

#### 局限 7：论文缺少真正的模块级消融与置信区间分析

虽然作者给了 100 次独立实验和误差指标，但多数图只画均值趋势，没有系统展示 error bar / confidence interval。对于随机 sketch，特别是 QSketch-Dyn 这种逆概率估计器，尾部方差和稳定性同样重要。

---

### 5.3 未来工作与启发 (Future Work & Inspirations)

如果沿着这篇论文继续做，我会优先考虑以下方向。

#### 方向 1：Fully-dynamic Weighted Cardinality

支持：

- insert/delete；
- weight update；
- negative weight；
- sliding window。

难点在于当前方法利用了寄存器单调 `max` 的性质，一旦删除元素，历史最大值可能失效，需要可撤销或多层次状态结构。

#### 方向 2：让 QSketch-Dyn 可合并

这是我认为最有研究价值的问题之一：能否设计一个额外的 path-summary，使两个子流的 QSketch-Dyn 可以 merge，并保持无偏或可控 bias？

如果能做到，就可以把 QSketch-Dyn 从单机在线 estimator 推到分布式 telemetry / data warehouse aggregation。

#### 方向 3：控制小 $q_R$ 引起的方差爆炸

可以考虑：

- clipping / stabilized inverse probability weighting；
- control variate；
- 分层寄存器；
- 自适应 rebase；
- 当 $q_R$ 低于阈值时切换 estimator；
- 利用 Rao-Blackwellization 降低 Bernoulli sampling 方差。

这类改进可能牺牲严格无偏，但换来更好的 MSE 和 tail behavior。

#### 方向 4：从 base-2 固定量化走向可学习/可优化量化

当前使用：

$$
y=\lfloor-\log_2r\rfloor.
$$

可以研究一般底数 $a>1$：

$$
y=\lfloor-\log_a r\rfloor,
$$

在给定 bit budget、目标 $C$ 范围、预期权重分布下选择最优 $a$。这本质上是“量化分辨率 vs 动态范围”的优化问题。

也可以研究 stochastic quantization，使量化本身满足某种无偏性质，从而简化 MLE。

#### 方向 5：真正按“固定内存预算”重新建立 Pareto frontier

例如固定每条 stream 只允许 1 KB / 4 KB / 64 KB，比较：

$$
\text{Accuracy}\;\times\;\text{Update Throughput}\;\times\;\text{Query Latency}.
$$

这会比“同样 $m$”更直接回答工程部署问题。

#### 方向 6：硬件友好优化

QSketch 很适合：

- SIMD packed registers；
- cache-line 对齐；
- FPGA / P4 programmable switch；
- 对 $e^{-w2^{-r}}$ 做 lookup / vectorization；
- 多 stream register sharing。

尤其 QSketch-Dyn 的 $2^b$ histogram 是固定小表，具有很强的 cache locality。

---

### 5.4 对研究工作的几点启发

1. **不要默认“连续随机变量必须用浮点数保存”。** 如果最终估计只依赖尺度信息，先问能否进入 log domain。
2. **量化不是结束，量化后的统计模型才是关键。** 把 quantization 当成 observation model，然后重新推 likelihood，往往比直接做 bias correction 更干净。
3. **Sketch 的演化路径可能比终态更有信息。** 如果能写出 state-change probability，就可能构造动态 estimator。
4. **无偏不是终点。** 逆概率估计最需要关注的是 variance、tail risk 和小 inclusion probability。
5. **系统论文的复杂度要看隐藏参数。** “$O(1)$”通常意味着对主规模参数 $m$ 常数，但可能仍依赖 register width、table size、hash cost 等。

---

### 5.5 建议继续追问的几个问题

- **Q1：为什么 QSketch 量化到 8 bit 后几乎不损失准确率？** 关键不是“8 bit 足够精确”，而是指数最小值对 $C$ 的信息主要体现在数量级，同时 MLE 正确处理了区间信息。
- **Q2：QSketch-Dyn 的 30% 精度提升到底来自哪里？** 更接近“利用了状态变化路径 + 逆概率估计”，而不是寄存器本身更精细。
- **Q3：QSketch-Dyn 是否能 merge？** 论文没有给出直接方案；这是一个很值得做后续研究的问题。
- **Q4：为什么 $q_R$ 变小时方差会变大？** 因为每次成功事件要乘以 $1/q_R$，稀有事件会带来大幅度估计跳变。
- **Q5：如果固定总内存，QSketch 能否用 8× 寄存器碾压 64-bit baseline？** 论文没有完整展示这条 equal-memory curve，值得自行补实验。
- **Q6：公开代码是否完全对应论文理论？** 大框架一致，但哈希独立性、register encoding、参数说明等细节值得复现者逐项核对。

---

## 总结：如何评价这篇论文？

如果用三句话概括：

1. **QSketch 的核心是把 weighted exponential-min sketch 做“对数量化 + 离散 MLE”，把 64-bit 浮点寄存器压到短整数而基本保持精度。**
2. **QSketch-Dyn 的核心是把 sketch 状态变化视为随机采样事件，通过 $w/q_R$ 的逆概率校正在线、无偏地累计 weighted cardinality。**
3. **真正值得后续研究的不是再省 1–2 bit，而是解决 QSketch-Dyn 的小-$q$ 方差、分布式 merge、动态删除/负权重和更严格的复现一致性。**

从研究品味上看，这是一篇典型的高质量 sketch 论文：公式不复杂，但每一个设计都围绕“统计信息到底需要多少 bit、如何把省下来的 bit 用理论补回来”展开。对于刚进入流式算法方向的研究生，我最建议反复理解的不是 Newton-Raphson 的推导细节，而是下面这两个抽象：

> **QSketch = exponential race 的对数区间删失估计。**  
> **QSketch-Dyn = sketch state transition 上的逆概率估计。**

把这两个抽象吃透，基本就抓住了整篇论文的灵魂。

---

## 资料与链接

- 论文 DOI：https://doi.org/10.1145/3637528.3671695
- arXiv：https://arxiv.org/abs/2406.19143
- 作者代码：https://github.com/Rezerolird/QSketch
- CCF 数据库/数据挖掘/内容检索会议目录：https://www.ccf.org.cn/Academic_Evaluation/DM_CS/

> 注：论文内容解读以用户提供的 KDD 2024 PDF 为主；CCF 等级和 GitHub 公开状态为额外在线核验。公开代码相关的“实现差异”属于复现层面的独立观察，不是论文作者在正文中提出的结论。
