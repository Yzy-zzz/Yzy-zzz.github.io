---
layout: post
title: "Advancing Sketch-Based Network Measurement: A General, Fine-Grained, Bit-Adaptive Sliding Window Framework"
date: "2026-05-20 23:50:06"
updated: "2026-05-20 23:50:06"
permalink: papers/advancing-sketch-based-network-measurement/
categories: ["论文阅读"]
tags: ["Sketch","滑动窗口"]
excerpt: "标题: Advancing Sketch-Based Network Measurement: A General, Fine-Grained, Bit-Adaptive Sliding Window Framework 会议: IEEE/ACM IWQoS 2024 (International Symposium on Quality…"
disableNunjucks: true
comments: false
---

## 基本信息

**标题**: Advancing Sketch-Based Network Measurement: A General, Fine-Grained, Bit-Adaptive Sliding Window Framework
**会议**: IEEE/ACM IWQoS 2024 (International Symposium on Quality of Service)
**CCF等级**: CCF B类会议
**DOI**: 10.1109/IWQoS61813.2024.10682923
**作者**: Kejun Guo, Fuliang Li (通讯), Jiaxing Shen, Xingwei Wang
**单位**: 东北大学, 岭南大学
**开源情况**: 论文中未提供开源链接

---

## 一、摘要与核心贡献

**一句话总结**: 针对现有 Sketch 滑动窗口方案通用性差、粒度粗、内存利用率低的问题，本文提出了两个通用滑动窗口框架（传统型与流级别型）以及一个按位自适应分配算法，可无缝适配多种 Sketch 模型，显著提升滑动窗口网络测量的精度与内存效率。

**核心贡献**:

1. **提出两个通用滑动窗口框架**: 传统滑动窗口框架采用"集中刷新"策略替代 Sliding Sketch 的扫描策略，可适配 k-hash 模型和非 k-hash 模型的 Sketch；流级别滑动窗口框架通过维护每条流的时间戳，在任意时刻都能获得完整一个周期的流特征，实现细粒度测量。

2. **设计按位自适应分配算法 (Bit-wise Adaptive Allocation)**: 让多个计数器共享一个 bit 数组，利用网络流量的偏斜特性，让大象流的大计数器动态"借用"蚂蚁流小计数器的闲置 bit，实现近无损的计数器压缩。

3. **在五种 Sketch、三类任务上验证了框架的通用性**: 覆盖了频率估计（CM Sketch、Elastic Sketch）、重流检测（HeavyKeeper、Hashpipe）和频率分布估计（Mrac），实验结果表明精度远超现有滑动窗口方案。

---

## 二、引言：问题背景与研究动机

### 2.1 问题定义

网络测量是流量工程、异常检测、拥塞控制等网络应用的基础。Sketch 作为一种概率数据结构，以一定的误差为代价，能在低内存占用下实现高精度测量。然而，**绝大多数现有 Sketch 方案只支持静态窗口**（即从头到尾统计所有到达的包），而在实际应用中，人们更关心的是**最近一段时间**的流量特征——例如入侵检测系统更关注近期的攻击行为。这就需要 **滑动窗口** 模型。

滑动窗口的核心挑战在于：在高速海量流场景下，如何高效地清除过期流的状态，同时保持低内存开销和高精度。

### 2.2 现有方法的局限

论文指出已有滑动窗口方案存在三个核心瓶颈：

- **粒度粗 (Coarse Granularity)**: 如图1所示，传统滑动窗口以固定的窗口长度 $N$ 查询，只能对那些在窗口内经历了完整周期的持久流（persistent flow）有好的估计，而对大量短命的瞬时流（ephemeral flow）估计很差。然而现实中瞬时流总是占多数。

- **通用性差 (Poor Generality)**: 现有的通用框架（如 Sliding Sketch）只适用于 k-hash 模型的 Sketch（如 CM Sketch），对单 hash 模型和复杂 Sketch（如 Hashpipe、Elastic Sketch）则不再通用。这是因为 Sliding Sketch 依赖 k 个分段中的拷贝来确保总有一个分段记录了查询流在某个时间片的信息，而非 k-hash 模型的各分段更新并不独立，这一前提不成立。

- **内存利用率低 (Poor Memory Utilization)**: 为支持滑动窗口，现有方案通常需要额外的 bucket（如 Sliding Sketch），而片上内存资源宝贵。现有的计数器压缩方案（如 SEAD、SALSA）各有局限：SEAD 无法让大计数值利用小计数值的闲置 bit；SALSA 合并邻居计数器可能引入误差。

### 2.3 本文思路

作者从三个维度分别突破：
1. 用"集中刷新"替代"逐桶扫描"来提升通用性；
2. 用"流级别"替代"窗口级别"的滑动模型来实现细粒度；
3. 用"按位自适应分配"让计数器共享 bit 数组来提升内存利用率。

---

## 三、方法论深度解析

### 3.1 整体架构

本文的方法由三个独立但可组合的模块构成：

1. **传统滑动窗口框架 (Traditional Sliding Window Framework)**: 适用于需要"最近 $N$ 时间单位内所有到达包"的场景。
2. **流级别滑动窗口框架 (Flow-Level Sliding Window Framework)**: 适用于需要"每条流自身最近一个完整周期"的场景。
3. **按位自适应分配算法 (Bit-wise Adaptive Allocation Algorithm)**: 对上述两个框架的计数器层进行内存优化，可独立使用。

如论文图1所示，传统滑动窗口的窗口终点是固定的当前查询时间，而流级别滑动窗口的窗口终点是每条流的最后一次活动时间。这意味着流级别窗口能为每条流提供精确的完整周期统计。

### 3.2 核心组件拆解

#### 3.2.1 传统滑动窗口框架

**输入**: 流元素 $e$，系统时间 $T_{cur}$，窗口长度 $N$，分段数 $d$。

**内部机理**:

核心思想是将一个窗口周期 $N$ 均分为 $d$ 个 part，每个 part 时长为 $N/d$。始终维护 $d+1$ 个 part 的空间。

- **初始化**: 维护 $d+1$ 个 part，`cur_part` 和 `last_part` 初始化为 0。
- **插入 (Algorithm 1)**: 对于到达的流 $e$，计算当前所在 part: $cur\_part = \lfloor (T_{cur} - T_{init}) / (N/d) \rfloor \mod (d+1)$。
  - **Case 1**: 若 `cur_part == last_part`，直接执行正常的 Sketch 插入操作。
  - **Case 2**: 若 `cur_part != last_part`，说明上一个 part 已完全过期。此时**集中清除**所有 bucket 中 `cur_part` 对应的数据，然后执行插入。
- **查询 (Algorithm 2)**: 将最近 $d$ 个 part 的计数值累加，再用拟合参数 $s$ 进行时间修正，实现无偏查询。

**设计动机**: 与 Sliding Sketch 的"逐桶扫描"不同，集中刷新策略不依赖 k 个分段的独立性，因此天然适用于所有 Sketch 模型。同时，对非 k-hash 模型的 Sketch，避免了 Sliding Sketch 中重复扫描的问题（如论文图2b所示的 Hashpipe 交换场景）。

**与 S-ACE 的区别**: S-ACE 在每个 part 中放置完整的 Sketch 副本（包括 flow key 字段），而本文只扩展必要的字段（如 count 字段），维护的是**一个** Sketch，不是多个副本。

#### 3.2.2 流级别滑动窗口框架

**输入**: 同上，但额外为每个 bucket 维护两个时间戳 $T_{start}$ 和 $T_{final}$。

**内部机理 (Algorithm 3)**:

每个 bucket 维护 $d+1$ 个 part 以及 $T_{start}$（该 bucket 中第一条包到达时间）和 $T_{final}$（最后一条包到达时间）。

- **Case 1**: 若 $T_{final} < T_{cur} - N$ 且 $T_{final} \neq 0$，说明该 bucket 中的流记录已完全过期，清除该 bucket。
- **Case 2**: 时间戳为零，流首次到达，插入第一个 part，记录 $T_{start}$。
- **Case 3**: 若 $T_{cur} - T_{start} < \frac{N}{d} \times (d+1)$，bucket 尚未满，直接插入对应 part。
- **Case 4**: 否则，流已超过一个周期。先清除过期的 part，然后将 part 按时间升序重排（shift 操作），更新 $T_{start}$，最后插入。

**查询 (Algorithm 4)**: 累加 bucket 中所有 part 的计数值。若 $T_{final} - T_{start} \geq N$，说明已覆盖完整一个周期，用拟合参数 $s$ 减去多余部分。

**设计动机**: 流级别窗口的关键洞察是——以每条流的最后一次活动为窗口终点，而非固定的查询时间。这在推荐系统等场景下有明确的应用价值：基于每个用户最近一段时间的行为做推荐，终点是用户最后一次活跃时间。该框架还自然地附加了两个能力：提供流的时间范围和流速率。

#### 3.2.3 按位自适应分配算法

**输入**: 一个 64-bit 的共享数组，$n$ 个计数器共享该数组。

**内部机理**:

如论文图3所示，64-bit 数组被划分为三个字段：
- `count_bits`（5 bit）: 记录当前计数器占用的 bit 数
- `count`（若干 bit）: 计数值本身
- `index`（5 bit）: 计数单位的指数（以 2 为底）

**关键事实**: 网络流量高度偏斜，绝大多数计数器值很小，但最大值需要足够多的 bit 来容纳。

- **Increase (Algorithm 5)**:
  - 先以 $2^{index}$ 为概率决定是否累加（类似 Morris 计数器的思想）。
  - **Case 1**: 计数器未溢出，直接加。
  - **Case 2.1**: 溢出，且其他计数器有足够闲置 bit（$remainder \geq need\_bits$），执行"借用"操作——从其他计数器借 bit 给溢出的计数器。
  - **Case 2.2**: 溢出，但闲置 bit 不够。先借用所有可用 bit，再递增 `index`（相当于所有计数器的精度降低一个数量级，但容量翻倍）。

- **Decrease (Algorithm 6)**:
  - **Case 1**: 释放的 bit 不够降低 `index`，保持不变。
  - **Case 2**: 释放的 bit 足够，降低 `index`（精度恢复），将所有计数器左移并均匀分配释放的 bit。

- **Query**: 返回 $count \times 2^{index}$。

**设计动机**: 这一设计的精妙之处在于：它利用了"连续多个 bucket 同时包含大象流的概率极低"这一统计事实，让相邻的计数器共享 bit 空间。大计数器可以动态借用小计数器的闲置 bit，而当大象流离开后，`index` 可以回落，精度自动恢复。与 SEAD（只能在同一计数器内调整）和 SALSA（合并邻居可能引入误差）不同，本文方案在支持增减操作的同时，实现了跨计数器的 bit 共享。

### 3.3 关键公式与算法

**公式1: 查询时的时间修正**

传统滑动窗口查询时：
$$ans = \sum_{j=0}^{d-1} bucket[pos][j] - s \times bucket[pos][(cur\_part+1) \mod (d+1)]$$

其中 $s = \frac{T_{cur} - T_{start}}{N/d} - d$（或类似的时间偏移量）。

- **目标**: 在非整数倍 $N/d$ 时间点查询时，修正因时间不对齐带来的偏差。
- **含义**: 累加最近 $d$ 个 part 的值，减去超出窗口范围的那一小段时间对应的估计值。
- **直觉**: 本质上是一个线性插值——假设流量在时间上均匀分布，按比例减去窗口外的部分。

**公式2: 按位自适应分配的内存公式**

传统方案: $Memory = 32 \times n$（每个计数器固定 32 bit）

本文方案: $Memory = \log_2 32 \times (n+1) + allocated\_bits$

- 前半部分是 `count_bits` 和 `index` 的固定开销（约 5 bit/计数器）；
- 后半部分是实际分配的 bit 总量，由用户根据内存预算设定。

当 $n=4$、总数组 64 bit 时，固定开销为 $5 \times 5 = 25$ bit，实际可用 39 bit，远优于每个计数器固定 8 bit 的传统方案（32 bit 总量）。

---

## 四、实验设计与结果分析

### 4.1 实验设置

- **数据集**: CAIDA 2018 匿名 IP 追踪数据，读取 2000 万个包，滑动窗口长度 $N = 250$ 万，按源 IP 聚合约 7 万条流。
- **评测指标**: ARE（平均相对误差）、AAE（平均绝对误差）、Recall Rate、Precision Rate。
- **基线方法**: Sliding Sketch (SI)、ECM、SWCM、WCSS、Lambda、Baseline（流级别窗口的朴素实现）。
- **测试 Sketch**: CM Sketch（频率估计）、Elastic Sketch（频率估计+重流检测）、HeavyKeeper（重流检测）、Hashpipe（重流检测）、Mrac（频率分布估计）。
- **实现**: C++，参数 $n=4$（4 个计数器共享 64-bit 数组），k-hash 模型 $k=10$。

### 4.2 主实验结果

**传统滑动窗口 — 频率估计**（如论文图6）:

- TBSW-CM 的 ARE 在 2MB 内存下比 SI-CM 低约 8.5 倍，比 ECM 低约 402 倍，比 SWCM 低约 167 倍。
- 在非 k-hash 模型（Elastic Sketch）上，TBSW-Elastic 的 ARE 比 SI-Elastic 低约 2 倍，比 ECM 低约 1850 倍。

这验证了作者的核心假设：集中刷新策略在 k-hash 和非 k-hash 模型上都优于 Sliding Sketch 的扫描策略，且远优于只适用于特定 Sketch 的 ECM/SWCM。

**传统滑动窗口 — 重流检测**（如论文图8）:

- TBSW-HK 在 200KB 内存下 ARE 比 SI-HK 低约 3 倍，比 Lambda 低约 10 倍，比 WCSS 低约 8 倍。
- Recall Rate 方面，TBSW-HK 比 SI-HK 高约 15%，比 Lambda 高约 60%。
- 三种 Sketch（HeavyKeeper、Elastic、Hashpipe）上 TBSW 系列全面胜出。

**流级别滑动窗口**（如论文图7、图9）:

- FBSW-CM 的 ARE 在 3MB 内存下比 Baseline-CM 低约 3.3 倍。
- FBSW-HK 在 300KB 内存下 ARE 比 Baseline-HK 低约 4.2 倍，Recall Rate 高约 20%。

**频率分布估计**（如论文图10）:

- TBSW-CM 和 TBSW-Mrac 的估计分布与真实分布高度吻合，而 SI-CM/SI-Mrac 严重偏离。

### 4.3 消融实验

**参数 $d$ 的影响**（如论文图4、图5）:

- 小内存时，$d$ 越小精度越高（因为每个 part 分到的 bit 更多）。
- 大内存时，$d$ 越大精度越高（因为时间粒度更细，过期数据清除更及时）。
- 但 $d$ 的影响随内存增大而减弱。
- 论文推荐 $d=3$ 作为折中。

**按位自适应分配的贡献**: 论文将 TBSW（带 bit 自适应）与不带 bit 自适应的版本对比，验证了该算法在各内存条件下都能进一步降低误差。

### 4.4 实现细节

- 64-bit 数组可在大多数计算机上单次读写操作完成，对硬件友好。
- `count_bits` 和 `index` 各占 5 bit（因为最大计数值占 32 bit，$\log_2 32 = 5$）。
- 对 Elastic Sketch 的轻量部分（light part）不使用 bit 自适应算法。
- 每隔 $N/(10d)$ 个包滑动一次窗口，取平均值作为实验结果。

---

## 五、讨论与思考

### 5.1 优点与创新点

1. **通用性设计思路巧妙**: 集中刷新策略极其简洁——只需判断 `cur_part` 是否变化，就能适配所有 Sketch 模型。这种"不侵入 Sketch 内部结构"的设计哲学是通用框架的最佳实践。

2. **流级别窗口的概念新颖**: 区别于传统的"以当前时间为窗口终点"的思路，流级别窗口以"每条流最后活跃时间为终点"，这在推荐系统等场景下有明确的应用逻辑支撑。

3. **按位自适应分配的工程直觉好**: 利用"连续多个 bucket 同时包含大象流的概率极低"这一统计事实来论证 bit 共享的合理性，比纯理论的压缩方案更接地气。

4. **实验覆盖面广**: 覆盖了 5 种 Sketch、3 类任务、k-hash 和非 k-hash 两种模型，说服力强。

### 5.2 局限性与可商榷之处

1. **流级别窗口的适用场景受限**: 流级别窗口要求"以每条流最后活跃时间为终点"，这在推荐系统等场景下合理，但在需要实时全局视图的场景（如 DDoS 检测、实时负载均衡）下，传统滑动窗口更合适。论文对流级别窗口的适用边界讨论不足。

2. **$T_{start}$ 和 $T_{final}$ 的额外内存开销未充分讨论**: 流级别框架为每个 bucket 额外维护两个时间戳，在 $d$ 较大或 bucket 数量很多时，这部分开销不可忽略。论文的内存分析主要聚焦于 bit 自适应分配，对时间戳开销的量化分析不足。

3. **按位自适应分配的概率性引入额外误差**: 以 $2^{index}$ 为概率决定是否累加/减少，这本质上是一个近似计数器（类似 Morris 计数器）。在 `index` 较大时，计数的相对误差会增大。论文未给出这一误差的理论分析。

4. **仅在 CAIDA 数据集上验证**: 实验只使用了一个真实流量追踪数据集。不同网络环境（数据中心 vs. 边缘网络 vs. ISP）的流量偏斜程度不同，bit 自适应分配的效果可能有差异。

5. **集中刷新的时序开销**: 当 `cur_part` 变化时，需要清除所有 bucket 中对应 part 的数据。在 bucket 数量很大时，这个集中清除操作可能成为延迟尖峰。论文未讨论这一 worst-case 的时序影响。

6. **Baseline 设计偏弱**: 流级别窗口的 Baseline 需要 $2d+1$ 个 part，内存开销是 FBSW 的近两倍，这使得 FBSW 的优势有些"胜之不武"。更好的对比应该是与其他细粒度窗口方案比较。

### 5.3 未来工作与启发

1. **与硬件卸载结合**: 按位自适应分配的 64-bit 共享数组天然适合 FPGA/ASIC 实现。如果能在可编程交换机上验证，将大幅提升实用价值。

2. **动态调整 $d$**: 当前 $d$ 是固定的，但可以根据当前内存压力和流量动态特征自适应调整 $d$ 的值，在精度和内存之间做更灵活的权衡。

3. **扩展到分布式场景**: 当前方案是单点部署。如果能在分布式 Sketch（如 Deltoid、Mergeable 摘要）上实现滑动窗口，将覆盖更多真实部署场景。

4. **思考题**:
   - 按位自适应分配方案中，如果 $n$ 从 4 增大到 8 或 16，性能会如何变化？是否存在一个最优的 $n$？
   - 流级别窗口中，如果流的活跃时间跨度远超窗口长度 $N$，`index` 是否会持续增长导致精度严重退化？
   - 集中刷新策略在"突发流量"场景下（大量流同时到达导致 `cur_part` 频繁跳变），性能表现如何？
