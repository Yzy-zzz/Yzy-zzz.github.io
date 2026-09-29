---
layout: post
title: "GeminiSketch 论文阅读笔记：面向时间图流的双矩阵 Sketch 与 Rolling-out 过期边淘汰"
date: "2026-09-06 15:17:32"
updated: "2026-09-15 23:37:56"
permalink: papers/geminisketch/
categories: ["论文阅读"]
tags: ["Sketch","滑动窗口"]
excerpt: "GeminiSketch 通过“双矩阵轮换 + 链式哈希 + 虚拟 bucket 队列上的 Rolling-out 淘汰”，在固定内存的一遍式处理条件下，同时降低时间图流查询误差、加快时间范围查询，并避免每次窗口滑动都全表扫描或重建数据结构。"
disableNunjucks: true
comments: false
---

> **论文**：*GeminiSketch: An Accurate and Efficient Sketch for Summarizing Temporal Graph Streams with Rolling-Out Elimination*  
> **作者**：Xuyang Jing, Chenhao Zhang, Zheng Yan, Qingze Jiang, Witold Pedrycz, Mingjun Wang, Cong Wang  
> **会议**：2026 IEEE 42nd International Conference on Data Engineering (**ICDE 2026**)  
> **会议时间与地点**：2026 年 5 月 4–8 日，加拿大 Montréal（蒙特利尔）  
> **CCF 级别**：**CCF A 类**（数据库 / 数据挖掘 / 内容检索方向）  
> **DOI**：`10.1109/ICDE65706.2026.00010`  
> **开源情况**：✅ 已开源  
> **代码仓库**：[https://github.com/NOWEVERYTHINGISFINE/GeminiSketch](https://github.com/NOWEVERYTHINGISFINE/GeminiSketch)  
> **ICDE 2026 官网**：[https://icde2026.github.io/](https://icde2026.github.io/)

> 💡 **先给结论**：这篇论文真正有价值的地方，不是“又设计了一个 hash sketch”，而是把**时间图流中最棘手的过期边管理问题**转化成了一个可以沿着“虚拟 bucket 队列”定向推进的在线淘汰过程，再用“双矩阵轮换 + 链式哈希”控制冲突与更新时间。它是一篇典型的数据库/流处理系统论文：核心数据结构并不复杂，但对**数据生命周期、查询路径、哈希冲突和滑动窗口**的耦合关系处理得很干净。

---

## 1. 摘要 (Abstract) 与核心贡献 (Core Contribution)

### 一句话总结

**GeminiSketch 通过“双矩阵轮换 + 链式哈希 + 虚拟 bucket 队列上的 Rolling-out 淘汰”，在固定内存的一遍式处理条件下，同时降低时间图流查询误差、加快时间范围查询，并避免每次窗口滑动都全表扫描或重建数据结构。**

### 贡献列表 (Contribution List)

- **提出面向 temporal graph stream 的 GeminiSketch 数据结构。** 与传统“单矩阵压缩所有边”不同，它使用两个矩阵轮流承担 working / idle 角色，用矩阵的时间边界把不同时间阶段的数据隔离开；查询时先根据时间范围定位矩阵，从而减少无关扫描。
- **设计链式哈希（chain hashing）与矩阵切换机制。** 当主哈希位置冲突时，不立即聚合或丢弃边，而是沿多个候选哈希位置寻找空 bucket；同时根据最近一段插入所需的哈希次数判断矩阵拥塞程度，在冲突变严重之前切换到另一矩阵。
- **提出 Rolling-out 过期边淘汰策略，并补偿 chain cut-off。** 作者用按 bucket 首次访问顺序组织的虚拟队列隐式保存时间顺序，从队头定向清理过期边；同时针对 bucket 被清空后可能截断别的边的哈希链问题，引入有限线性探测补偿。

论文还给出了时间/空间复杂度和查询失败概率分析，并在 4 个真实时间图数据集上与多种 graph sketch、temporal graph representation 方法以及 Neo4j 做了实验比较。

---

## 2. 引言 (Introduction)：问题背景与研究动机

### 2.1 问题定义 (Problem Definition)

论文研究的是 **Temporal Graph Stream Summarization（时间图流摘要）**。

一条持续到达的时间边写成：

$$
e_x=(\langle s_x,d_x\rangle,w_x,t_x)
$$

其中：

- $s_x$：源顶点；
- $d_x$：目标顶点；
- $w_x$：边权；
- $t_x$：时间戳。

同一对顶点可能在不同时间多次产生边事件，因此一个时间图可写为：

$$
G=(V,E,T)
$$

- $V$ 是顶点集合；
- $E$ 是给定时间范围 $T$ 内的活动边；
- $T$ 可以是一个时间点，也可以是一个时间区间。

论文进一步定义 temporal graph sketch：通过哈希 $F(\cdot)$ 把大量原始顶点和边映射到远小于原图的摘要结构：

$$
G_s=(V_s,E_s,T),\qquad |V_s|\ll |V|,\quad |E_s|\ll |E|
$$

这里不可避免会出现哈希冲突，因此 sketch 本质上是**以一定查询误差换取亚线性内存与高速更新**。

论文支持三类基础时间查询：

- **Edge-related query**：某条边在 $[t_b,t_e]$ 内是否存在、累计权重是多少；
- **Vertex-related query**：某顶点是否存在、出/入邻居与出/入边权等；
- **Time-related query**：给定时间段内有哪些活动边，以及进一步派生出的子图、可达性等。

### 为什么这个问题重要？

很多真实网络既是“图”，又是“流”：

- 社交网络中的关注/互动关系不断产生和消失；
- 网络监控中的主机通信具有明确发生时间；
- 金融交易图持续追加新交易；
- 推荐系统中“近期行为”通常比几个月前的行为更重要。

这类场景有三个同时存在的硬约束：

1. **数据量太大，不能把完整历史图全部留在内存中；**
2. **流式到达要求 one-pass，不能反复重扫历史；**
3. **时间窗口持续滑动，旧边必须及时失效，否则查询语义会被污染。**

换句话说，普通 graph sketch 解决的是“图太大”，而 temporal graph sketch 还要额外解决“**图会老化**”。

---

### 2.2 现有方法的局限 (Limitations of Prior Work)

论文首先把已有时间图表示方式归为两大类。

#### 路线 A：Log-based

代表思路是 EdgeLog / EveLog 等：把边的激活、失活事件按时间记录下来。

**优点**：历史信息完整。  
**痛点**：回答一个时间区间查询时往往需要扫描大量 change events，查询时间会随历史事件数增长；同时保留完整日志也需要较大空间。

#### 路线 B：Snapshot-based

把不同时刻的图状态保存成一系列 snapshot，或者保存 snapshot + delta。

**优点**：某个时刻的图状态比较直接。  
**痛点**：相邻时刻可能只有少量变化，但仍需要维护大量快照或快照差分；窗口滑动时也有额外维护成本。

#### 路线 C：Graph-stream sketch

TCM、SBG、GSS、Auxo 等通过 hash 把图压缩到矩阵中，空间与查询速度都很好，但最初主要针对**无显式时间语义的 graph stream**。

后续 Horae、ITeM、PGSS、HIGGS 等开始加入时间索引或分层结构，但又带来了新的问题：

- 多层矩阵/时间树会增加查询时需要访问的结构数；
- 时间粒度越细，维护成本越高；
- 窗口移动后清理过期数据通常不够直接；
- 一些方法必须重建/重初始化才能得到“当前窗口”的干净结果。

论文在 Table I 中想表达的核心对比就是：**时间信息、滑动更新、低插入成本、线性空间和低过期边淘汰成本，很难同时做到。**

---

### 2.3 本文思路 (Overall Idea)

作者把问题拆成三个瓶颈：

1. **怎么在固定内存中单遍压缩时间图流？**
2. **怎么避免时间范围查询扫描大量历史结构？**
3. **怎么不做 full scan 也能把过期边及时删掉？**

GeminiSketch 的答案可以概括为：

> **空间上用两个矩阵做“时间代际隔离”；位置上用 chain hashing 保留边身份；生命周期上用虚拟 bucket 队列做定向淘汰。**

这三个机制不是独立拼装的，而是互相配合：

- 双矩阵减少一个矩阵长期堆积导致的拥塞；
- 拥塞下降后，chain hashing 的搜索链变短；
- bucket 有比较稳定的生命周期后，可以建立虚拟到达队列；
- 虚拟队列又让过期删除不需要遍历完整 $n\times n$ 矩阵；
- 过期数据及时清除，又进一步降低碰撞与查询误差。

这就是论文最重要的“闭环设计”。

---

# 3. 方法论深度解析 (In-depth Methodological Analysis)

## 3.1 整体架构 (Overall Architecture)

论文 Figure 1 是理解全文最重要的一张图。

![Figure 1 - GeminiSketch 整体结构](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/fig1_architecture.png)

*图：论文 Figure 1，GeminiSketch 的矩阵、虚拟 bucket 队列以及 bucket 内部字段。*

### 3.1.1 双矩阵：$G_1$ 与 $G_2$

GeminiSketch 有两个 $n\times n$ 的矩阵：

$$
G_1, G_2\in \text{Bucket}^{n\times n}
$$

任意时刻，一个是 **working matrix**，另一个是 **idle matrix**。

- working matrix：接收当前新到达的边；
- idle/frozen matrix：不再接收新边，但仍可能保留当前时间窗口中的旧边，并继续执行过期淘汰；
- 当 working matrix 过于拥塞，就“冻结”它，切换另一个矩阵开始接收新边。

这里的关键不是简单“双倍容量”，而是**用两个有限容量区域形成时间上的 generation**。新旧数据不再无限混杂于一个矩阵中。

> 🧠 可以把它类比成非常轻量的 generational storage：一个 generation 正在写，另一个 generation 正在衰老并被回收。

论文强调在相同内存预算下比较，因此双矩阵并不是把总内存简单扩大为两倍，而是把既定预算拆到两个矩阵中。

### 3.1.2 矩阵级元数据：WS、GT、HP、TP、MP

每个矩阵维护：

- **WS (Working Status)**：0 表示 working，1 表示 idle；
- **GT (Global Timestamp)**：该矩阵中最近写入边的时间戳；
- **HP (Head Pointer)**：虚拟 bucket 队列头；
- **TP (Tail Pointer)**：虚拟 bucket 队列尾；
- **MP (Middle/Marker Pointer)**：记录本轮过期淘汰扫描推进到的位置。

其中 GT 负责“**查询应该去哪张矩阵**”，HP/TP/MP 负责“**过期数据从哪里开始删、删到哪里**”。

### 3.1.3 Bucket 内部结构

每个 bucket $G[i][j]$ 保存三类信息。

**(1) 边/链元数据**

- `ec`：bucket 内事件数量；
- `vx`：该 bucket 对应的 source/destination vertex pair；
- `CF`：chain flag，表示是否为某条 hash chain 的尾部位置。

**(2) 边事件链表**

每个事件包含：

$$
\{w,t,suc\}
$$

也就是权重、时间戳和后继指针。

同一对顶点在不同时间反复出现时，不会反复占用多个 bucket，而是追加到同一 bucket 的事件链表中。

**(3) 队列/链表指针**

- `bqp`：虚拟 bucket 队列中的后继 bucket；
- `lhp`：事件链表头；
- `ltp`：事件链表尾。

因此，一个 bucket 同时处于两个逻辑结构中：

1. **二维 hash 矩阵中的物理位置**；
2. **按访问时间串起来的虚拟 bucket 队列**。

这是 GeminiSketch 最巧妙的实现点之一：作者没有另开一个庞大的时间索引，而是给 bucket 增加少量指针，让同一批 bucket 同时承担“空间哈希”和“时间回收”两种职责。

---

### 3.1.4 一条边从输入到查询的完整数据流

以输入边

$$
e=(\langle s,d\rangle,w,t)
$$

为例：

1. 使用压缩哈希 $F(\cdot)$：
   $$
   \tilde{s}=F(s),\qquad \tilde{d}=F(d)
   $$
2. 在当前 working matrix 中，用 chain hashing $H(\cdot)$ 寻找合适 bucket；
3. 如果 bucket 第一次被占用，把它接到虚拟 bucket 队列尾部；
4. 如果相同 $(s,d)$ 再次出现，只在该 bucket 的事件链表尾部追加 $(w,t)$；
5. 持续统计最近插入的 hash probe 次数，如果平均值超过阈值 $k$，触发矩阵 switchover；
6. 窗口前沿推进时，从 HP/MP 附近运行 Rolling-out，把已经过期的事件弹出；
7. 查询到来时，先用两张矩阵的 GT 判断目标时间区间落在哪个 generation，再做 edge / vertex / subgraph / reachability 查询。

宏观上，GeminiSketch 与 Horae/HIGGS 一类多层结构最大的不同是：

> **它不试图用很多时间层级去精确编码所有时间范围，而是把“时间管理”压缩成“两代矩阵 + 一条回收队列”。**

因此结构更平、更容易在线维护，但代价是时间分辨率和历史保留能力没有多层索引那么自由。

---

## 3.2 核心组件/模块拆解 (Core Component Breakdown)

### 3.2.1 模块一：Chain Hashing —— “冲突时换位置，而不是混在一起”

![Figure 2 - 插入操作](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/fig2_insertion.png)

*图：论文 Figure 2。$e_1,e_2,e_3$ 到达后，通过 chain hashing 选择 bucket；同一顶点对的事件进入同一 bucket list。*

#### 输入和输出

**输入**：压缩后的顶点对 $(\tilde{s},\tilde{d})$。  
**输出**：一个空 bucket，或已经属于同一 $(s,d)$ 的 bucket。

#### 内部机理

GeminiSketch 不只使用一个位置函数，而是准备一组 hash：

$$
H=\{h_1,h_2,\dots,h_r\}
$$

先尝试：

$$
G[h_1(\tilde{s})][h_1(\tilde{d})]
$$

如果该位置已被另一条边占用，再尝试 $h_2$，直到找到：

- 空 bucket；或
- 已经保存同一对顶点的 bucket。

这与传统 sketch 中“冲突后直接累加计数”非常不同。

例如 Count-Min 风格结构遇到冲突时，会把不同原始 key 的值混到一个 counter 里，导致估计偏大。GeminiSketch 更像开放寻址：**尽可能让不同 edge identity 分开存储。**

#### 它解决了什么问题？

它直接降低两类错误：

1. **权重污染**：不同边被聚合在同一 bucket；
2. **拓扑污染**：本来不存在的边/邻接关系因为 hash collision 被“制造”出来。

对于 subgraph 和 reachability，这一点尤其重要。因为一个错误边不只是让某个 counter 多一点，它可能让整个子图匹配或路径判断发生错误。

#### 设计动机

为什么不直接用一个更大的矩阵？

因为内存预算固定，矩阵尺寸不能无限增长。作者的思路是：

> **既然无法让 collision 消失，就让 collision 发生后有“第二、第三……候选位置”。**

而且 $r$ 被固定为较小常数，因此仍希望保持近似常数时间。

---

### 3.2.2 模块二：Dual-Matrix Switchover —— 把“拥塞”变成可控生命周期

chain hashing 的问题是：矩阵越满，平均 probe 越长。

作者没有等到矩阵彻底满才切换，而是维护一个长度为 $l$ 的短队列，记录最近 $l$ 次更新各自进行了多少次 hash 计算。

设这些 probe 次数的均值为：

$$
\bar c=\frac{1}{l}\sum_{i=1}^{l}c_i
$$

若：

$$
\bar c>k
$$

就认为 working matrix 已经进入高冲突状态，触发 switchover。

#### 输入和输出

**输入**：最近 $l$ 次更新的 hash probe 数。  
**输出**：是否冻结当前矩阵并激活另一个矩阵。

#### 内部机理

- 当前 working matrix 停止接收新边；
- idle matrix 改成 working；
- 原矩阵仍保留未过期数据，并继续 Rolling-out；
- 等它完全被清空后，才真正成为下一轮可复用的 idle matrix。

因此两张矩阵形成一个循环：

$$
G_1\ \text{write}\rightarrow \text{freeze/decay}\rightarrow \text{empty}
$$

$$
G_2\ \text{empty}\rightarrow \text{write}\rightarrow \text{freeze/decay}
$$

#### 设计动机

这个机制同时解决两个问题：

1. **更新效率**：在 hash chain 变得过长前切走；
2. **时间隔离**：较老数据主要留在 frozen matrix，较新数据进入 working matrix。

所以双矩阵并不是单纯为了“多一份空间”，更像是一个**通过负载信号自动触发的代际切换机制**。

---

### 3.2.3 模块三：Rolling-out Elimination —— 论文最核心的创新

![Figure 3 - Rolling-out](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/fig3_rollingout.png)

*图：论文 Figure 3。第一轮在 $t_4$ 淘汰一批过期事件，第二轮在 $t_6$ 从上次标记位置继续推进。*

#### 为什么不能直接用普通 LRU？

虚拟 bucket 队列按照 **bucket 第一次被访问/创建的先后顺序**组织。

但一个 bucket 可能包含：

$$
(s,d,t_1), (s,d,t_3), (s,d,t_8),\dots
$$

也就是说，**bucket 很老，不等于 bucket 里的所有事件都老。**

如果每次同一 $(s,d)$ 有新事件到达，就把整个 bucket 移到队尾，那么 bucket 中早期事件的时间顺序会被“拖后”，队列不再能反映旧数据在哪里。

所以论文采取了一个看似反直觉的设计：

> 同一个 bucket 再次被更新时，**不把 bucket 移到虚拟队列尾部**，只在 bucket 内部 list 末尾追加事件。

这样 bucket 在队列里的位置仍代表其“最早一批数据”的时间位置。

#### Rolling-out 如何工作？

设淘汰阈值为 $T_e$。

对于当前扫描到的 bucket $B$：

1. 检查 $B.list$ 的头部事件；
2. 如果
   $$
   B.list.head.t\le T_e
   $$
   则不断弹出过期事件；
3. 如果 bucket 被删空，则把整个 bucket 从虚拟队列中摘除并初始化；
4. 如果 bucket 头部已经是未过期事件，则保留 bucket，并继续按队列方向推进；
5. MP 记录这一轮推进的边界；下一次只有当 MP 附近的数据也开始过期时才继续向后滚动。

可以把它理解成：

> **不是“每次窗口移动都扫完整矩阵”，而是维护一条单向垃圾回收前沿。时间前进多少，回收前沿就向后推进多少。**

一个简化版伪代码可以写成：

```text
p <- 当前淘汰前沿
while p 仍可能包含过期数据:
    while p.list.head.timestamp <= Te:
        删除 head
    if p 为空:
        从 bucket queue 中摘除 p
    p <- 后继 bucket
更新 MP
```

这和 LSM-tree compaction、generational GC、stream watermark 的思想都有一点相似：**核心不是重新寻找所有旧对象，而是让“旧对象的位置”随时间单调推进。**

#### 为什么比 Full Scan 快？

完整矩阵有 $n^2$ 个 bucket，而真正需要处理的只是“刚刚跨出时间窗口的那部分数据”。Rolling-out 的目标就是把工作量从：

$$
O(n^2)
$$

转成“与本轮实际过期的数据量相关”。

这是其系统性能优势的根源。

---

### 3.2.4 Chain Cut-off Compensation —— 删除数据后，哈希链会被“剪断”

链式哈希和过期删除组合后会出现一个不容易察觉的问题。

假设边 $e_2$ 的查找过程是：

$$
h_1(e_2)\rightarrow h_2(e_2)\rightarrow h_3(e_2)
$$

其中前面的某个 bucket 实际存的是另一条冲突边 $e_1$。如果 $e_1$ 过期后，该 bucket 被 Rolling-out 初始化为空，那么查询 $e_2$ 时可能看到“空 bucket”就误以为链已经结束，于是找不到后面的真实 $e_2$。

作者称之为 **chain cut-off problem**。

解决方式很简单：

> 遇到空 bucket 后，不立即停止，而是再做至多 $g$ 个位置的有限线性探测。

实验中 $g=1$ 最好。

这是一个很典型的工程补丁：它没有改变主要结构，却修复了“删除 + open addressing”组合中常见的检索可达性问题。

---

## 3.3 关键公式与算法 (Key Equations and Algorithms)

### 3.3.1 链式哈希递推公式

论文给出的 hash family 为：

$$
h_1(\tilde{s})=(q\tilde{s}+p)\bmod n
$$

$$
h_c(\tilde{s})=(q\,h_{c-1}(\tilde{s})+p)\bmod n,\qquad 2\le c\le r
$$

对 $\tilde d$ 同样计算。

#### 符号解释

- $\tilde{s}=F(s)$：原始顶点经过第一次压缩后的 ID；
- $n$：矩阵边长；
- $r$：最大 chain hash 长度；
- $p,q$：选定的素数；
- $h_c$：第 $c$ 个候选位置函数。

#### 公式的目标

目标不是得到“一个完美 hash”，而是构造**一串可复现的候选 bucket 坐标**。

如果第一个位置冲突，就去第二个；第二个也冲突，再去第三个，直到：

- 找到同一 edge 的 bucket；
- 找到空 bucket；
- 或达到最大长度 $r$。

#### 直觉

普通 sketch 是：

> “我只有一个房间，撞车就合住。”

GeminiSketch 是：

> “先给你一串候选房间，只要还有空房，就尽量不要让两个不同 edge 合住。”

因此 $r$ 越大，edge loss 越少，但每次更新和查询的 probe 成本也会上升。这正是 Figure 4(a) 做参数实验的原因。

---

### 3.3.2 Chain cut-off 概率分析

作者把与目标边 $\tilde e$ 的冲突边分为两类：

- $E_1(\tilde e)$：与 $\tilde e$ 共享 source 或 destination 的边；
- $E_2(\tilde e)$：与 $\tilde e$ 两端点都不同的边。

对 $E_1$ 中一条边，与目标边不发生相关位置冲突的概率写成：

$$
P_1=1-\frac{1}{n}
$$

对 $E_2$ 中一条边，两维都不落入同一 bucket 的概率为：

$$
P_2=\left(1-\frac{1}{n}\right)^2
$$

若目标边最终位于 hash chain 的第 $y+1$ 个 bucket，那么作者给出至少一次相关冲突的概率近似为：

$$
\bar P_1
=1-\left(\left(1-\frac1n\right)^y\right)^{|E_1(\tilde e)|}
\approx 1-e^{-y|E_1(\tilde e)|/n}
$$

以及：

$$
\bar P_2
=1-\left(\left(1-\frac1n\right)^{2y}\right)^{|E_2(\tilde e)|}
\approx 1-e^{-2y|E_2(\tilde e)|/n}
$$

最终把 chain cut-off 概率表示为：

$$
P_{cut}=\bar P_1\bar P_2
$$

#### 公式的目标

证明 chain cut-off 虽然存在，但在：

$$
y<r\ll n
$$

时概率总体较小，而且可以用 $g$ 个额外探测进一步补偿。

#### 直觉

cut-off 需要同时满足两件事：

1. 目标边前面存在一个“别人的冲突 bucket”；
2. 那个 bucket 又恰好先过期并被清空。

这属于一个“碰撞 + 生命周期先后”的联合事件，因此作者认为概率不会太大。

#### 值得注意的一点

论文把 $(1-1/n)^m$ 写成指数形式时，本质上使用了常见近似：

$$
\left(1-\frac1n\right)^m\approx e^{-m/n}
$$

这个近似在 $n$ 大、单次碰撞概率小时合理，但它仍依赖独立性/均匀哈希等假设。后面“讨论与思考”会进一步评价这一点。

---

## 3.4 查询路径与复杂度

GeminiSketch 查询前先看两张矩阵的 GT。

令两张矩阵较小的 GT 为 $T_m$，对于查询区间 $[t_b,t_e]$：

1. 若 $t_e\le T_m$：只查较老的那张矩阵；
2. 若 $T_m<t_b$：只查较新的矩阵；
3. 若 $t_b\le T_m\le t_e$：把区间拆为
   $$
   [t_b,T_m]\quad\text{和}\quad(T_m,t_e]
   $$
   分别查询两张矩阵再合并。

这说明双矩阵除了控制冲突，还有一个重要作用：**时间范围路由**。

### Edge query

通过 chain hashing 定位 $(s,d)$ 的 bucket，然后只扫描这个 bucket 内的事件 list，把时间在 $[t_b,t_e]$ 内的权重累加。

### Vertex query

对顶点 $v$，计算 $r$ 个候选行/列，扫描对应行/列 bucket，得到邻接边或出入权重。

### Subgraph query

把子图中的每一条边拆成 edge query。任意一条边不存在，则 exact matching 失败；否则聚合各边权。

### Reachability query

在候选矩阵中运行带时间限制的 BFS/图遍历；如果查询跨越两张矩阵，则在两个时间段之间衔接搜索。

论文给出的复杂度为：

- 插入：$O(1)$（把 $r$ 视为小常数）；
- 过期淘汰：$O(1)$；
- edge query：与插入同阶；
- vertex query：$O(rn)$；
- $k$ 条边的 subgraph query：$O(rk)$；
- reachability：最好 $O(rn)$，最坏 $O(rn|V_s|)$；
- 空间：$O(|E_s|)$。

这里需要注意：这些 $O(1)$ 结论更多是**作者采用固定 $r$、摊销式流处理直觉后的系统级表达**，严格最坏情况是否为 $O(1)$ 是本文后续批判分析中的一个重要问题。

---

# 4. 实验设计与结果分析 (Experimental Design and Results Analysis)

## 4.1 实验设置 (Experimental Setup)

### 实验平台

- 语言：C++
- CPU：Intel Xeon Silver 4210R @ 2.40 GHz
- 10 cores / 20 threads
- 内存：64 GB DRAM

### 数据集

| 数据集 | 顶点数 | Temporal edges | 特点 |
|---|---:|---:|---|
| StackOverflow | 2,601,977 | 63,497,050 | 最大规模、时间跨度较长 |
| Wiki | 1,140,149 | 7,833,140 | Wikipedia Talk 交互 |
| Reddit | 55,863 | 858,490 | subreddit hyperlink |
| Super User | 194,085 | 1,443,339 | StackExchange 交互 |

### 评价指标

#### Average Relative Error (ARE)

用于 edge / vertex / subgraph 的权重估计：

$$
ARE=\frac1{|q|}\sum_{i=1}^{|q|}\frac{|\hat q_i-q_i|}{q_i}
$$

$\hat q_i$ 是 sketch 查询结果，$q_i$ 是真值。

#### Average Precision

用于 reachability。论文认为 graph sketch 的可达性错误主要表现为 false positive，因此采用：

$$
\text{AvgPrecision}
=\frac1{|z|}\sum_{i=1}^{|z|}\frac{|z_i|}{|\hat z_i|}
$$

其中 $z_i$ 为真实可达顶点集，$\hat z_i$ 为查询得到的可达顶点集。

#### Throughput

以 million operations per second (**Mops**) 衡量。

---

### Baselines

**Graph sketch 类：**

- TCM
- GSS
- SBG
- Auxo
- PGSS
- Horae
- ITeM
- HIGGS

其中 TCM/GSS/SBG/Auxo 本身不直接支持 temporal range query，作者使用 Horae 中的 temporal range decomposition 方案扩展成 `+time` 版本。

**Temporal graph representation / indexing 类：**

- EdgeLog
- EveLog
- Smo-index
- WBIndex+time

此外还有与 **Neo4j** 的案例比较。

---

### 关键默认参数

- 所有 sketch 默认内存预算：**20 MB**；
- GeminiSketch expiration threshold：**100 days**；
- 最近 probe 次数短队列长度：$l=10$；
- hash chain 长度：$r=20$；
- matrix conflict threshold：$k=14$；
- chain cut-off 补偿：$g=1$。

### 查询构造

- Edge query：随机 10,000 个；
- Vertex query：5,000 个；
- Subgraph query：子图规模 50–200，每种规模 1,000 个；
- Reachability：路径长度 1–10，每种长度 1,000 个；
- 每个最终结果取 **1000 次运行平均**。

论文把数据划分成非重叠固定窗口，并通过 window step 模拟窗口不断向前滑动。对于不能在线淘汰过期边的方法，作者在新窗口中重新初始化结构，以保证查询只含当前窗口数据。

---

## 4.2 参数实验：作者到底在调什么？

### Hash chain 长度 $r$

Figure 4(a) 显示，随着 $r$ 增大，edge loss rate 快速下降；到约 $r=20$ 后收益趋于饱和，因此作者取：

$$
r=20
$$

这是一个典型的 accuracy-latency trade-off：

- $r$ 太小：冲突后无处可去，边被丢弃；
- $r$ 太大：每次插入/查询要尝试更多位置。

### Conflict threshold $k$

Figure 4(b) 研究矩阵切换阈值。

- 切得太早：bucket 还没充分利用，空间浪费；
- 切得太晚：hash probe 已经很长，更新变慢。

最终设置：

$$
k=14
$$

这说明 GeminiSketch 的 switchover 本质是一个**通过 probe cost 观测负载的反馈控制器**。

---

## 4.3 消融实验 (Ablation Studies)

### 4.3.1 Dual-matrix 是否真的有用？

![Figure 5-6 - 双矩阵消融](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/fig5_6_dualmatrix.png)

*图：论文 Figure 5/6。相同总内存预算下，dual-matrix 与 single-matrix 的 edge query ARE 和平均 hash chain 长度。*

作者控制两种方案使用**相同内存**，比较 dual-matrix 与 single-matrix。

结果：

- dual-matrix 的 edge-query ARE **平均降低约 26%**；
- hash chain 明显更短。

作者原文把 hash-chain 改善描述为“约 70%–108%”。若把这个数字理解为严格“降低比例”，超过 100% 在数学上并不自然，更可能是相对差值/相对倍数的表述问题；但从 Figure 6 的曲线本身可以明确看出：**单矩阵的平均链长持续高于双矩阵，差距很明显。**

#### 这个消融验证了什么假设？

它验证了本文的一个核心系统假设：

> 把新旧时间段隔离后，不只是“时间查询更容易”，还会间接降低矩阵负载，从而减少 hash collision。

所以双矩阵同时改善 accuracy 和 efficiency，而不是单纯时间索引技巧。

---

### 4.3.2 Rolling-out 是否比 Lazy / Full Scan 更好？

![Figure 7 - 三种淘汰策略](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/fig7_elimination.png)

*图：论文 Figure 7，Rolling-out、Lazy elimination 与 Full Scan 的吞吐量和 edge-query ARE。*

作者比较三种策略：

1. **Rolling-out**：本文方法；
2. **Full Scan**：每轮遍历整个矩阵找过期边；
3. **Lazy**：只有某个 bucket 被新边访问时才顺便清理。

结果非常关键：

- Rolling-out 和 Lazy 的吞吐量大约是 Full Scan 的 **5 倍**；
- 但 Lazy 因为过期边不能及时删除，会明显增加查询误差；
- Rolling-out 同时保持接近 Lazy 的速度和更好的准确性。

这组实验实际上是全篇最有说服力的 ablation，因为它直接回答了：

> **为什么不能简单偷懒（Lazy），也不能暴力扫描（Full Scan）？**

Rolling-out 正好位于两者之间：只清真正需要清理的区域，同时让淘汰前沿持续推进。

---

### 4.3.3 Chain cut-off compensation 是否必要？

Figure 8 中：

- $g=0$：不补偿；
- $g=1$：ARE 改善约 **16%–21%**；
- 继续增大 $g$：没有继续变好，甚至可能因为越过正确 hash chain、碰到错误 edge 而增加误差。

所以默认：

$$
g=1
$$

这说明 cut-off 并不是一个纯理论边角问题，它对最终 accuracy 有可测量影响。

### 哪个模块贡献最大？

不能简单用一个数字回答，因为不同消融测的是不同维度：

- **效率维度**：Rolling-out 相对 Full Scan 的提升最大，吞吐可到约 5×；
- **准确率维度**：dual-matrix 带来约 26% 的 ARE 改善，而 $g=1$ 又能在此基础上改善约 16%–21%；
- **系统稳定性维度**：switchover 让 hash chain 不会随着窗口推进持续恶化。

因此更准确的判断是：

> **Rolling-out 是性能上的“主引擎”，dual-matrix + chain compensation 是准确率上的“主支撑”。**

---

## 4.4 主实验结果 (Main Results)

### 4.4.1 Query Accuracy

![Figure 9-12 - 查询准确率](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/fig9_12_accuracy.png)

*图：论文 Figure 9–12，分别为 edge、vertex、subgraph 和 reachability 查询准确率。*

#### Edge query（Figure 9）

GeminiSketch 在四个数据集上整体取得最低 ARE。

论文给出的 StackOverflow 例子尤其夸张：相对 Horae、Auxo、HIGGS、ITeM、GSS、TCM、SBG、PGSS，GeminiSketch 的 ARE 分别低约：

**3.59×、6.52×、10.99×、11.51×、12.92×、36.08×、37.12×、805.6×。**

这个结果与方法部分的假设高度一致：

- chain hashing 降低不同 edge 之间的合并污染；
- Rolling-out 不让过期 edge 长期残留；
- dual-matrix 降低持续拥塞。

三件事都会直接降低 edge-weight estimation error。

#### Vertex query（Figure 10）

GeminiSketch 同样总体最低。Horae 在部分数据集上较接近，因为 Horae 本身也显式建模时间范围。

作者特别指出 StackOverflow 时间跨度最长，GeminiSketch 在该数据集优势更明显——这支持了“**时间越长，及时淘汰和代际隔离越重要**”的叙事。

#### Subgraph query（Figure 11）

GeminiSketch 的 ARE 保持在很小的水平，论文称低于 0.1。

这是一个比单边查询更强的证据。因为 subgraph query 会把多个 edge error 叠加，如果底层 sketch 产生大量拓扑 false positive，子图级误差会被放大。

因此 Figure 11 说明 chain hashing 的“保留 edge identity”确实对结构查询有价值。

#### Reachability（Figure 12）

GeminiSketch 的 average precision 整体更高。

reachability 对 false positive 非常敏感：路径上只要凭空多出一条错误边，就可能把原本不可达的两个点判断成可达。

因此这项结果同样从侧面说明：GeminiSketch 比传统聚合式 sketch 更少制造“幽灵边”。

---

### 4.4.2 Query Time

![Figure 13 - Graph sketch 查询时间](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/fig13_query_time.png)

*图：论文 Figure 13，GeminiSketch 与 graph-sketch baselines 的平均查询时间。*

Figure 13 和 Figure 14 显示 GeminiSketch 在 edge / vertex / subgraph / reachability 上都有较强查询效率，尤其是更复杂的 subgraph 与 reachability 查询。

为什么复杂查询收益更大？

因为复杂查询需要反复调用底层 edge/vertex primitive。若每个 primitive 都需要跨多个时间层级、多个矩阵或大量日志，那么这种额外成本会被多次放大。

GeminiSketch 的优势是：

1. 先用 GT 把时间范围路由到 1–2 张矩阵；
2. 再通过 chain hashing 直接定位边；
3. 过期边已被持续清理，不需要在查询时临时过滤大量陈旧数据。

因此它的设计不是只优化“单次查边”，而是在提高复杂图查询的**基础操作局部性**。

---

### 4.4.3 Window Sliding Delay

![Table II - Window 移动延迟](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/table2_delay.png)

*图：论文 Table II，不同方法在窗口移动时的 delay time。*

这是论文最直观的系统结果之一：GeminiSketch 在四个数据集上的 delay time 都是：

$$
0.00\text{ ms}
$$

而其他方法从几十毫秒到 1 秒以上不等。例如：

- TCM+time：约 973–1054 ms；
- GSS+time：约 223–321 ms；
- Horae：约 124–168 ms；
- HIGGS：约 53–79 ms；
- Smo-index：约 19–28 ms。

原因是作者为了让这些方法只保留当前窗口数据，需要在窗口切换时重新初始化；GeminiSketch 则把删除工作摊到持续的 Rolling-out 中，因此没有单独的 window-reset stall。

这项指标验证的不是“hash 更快”，而是：

> **GeminiSketch 把窗口维护从批处理式停顿，变成了持续在线维护。**

对于在线监控系统，这一点往往比平均吞吐量更重要。

---

### 4.4.4 Throughput 与 Memory

Figure 15 显示 GeminiSketch 在 graph sketch 中具有明显插入吞吐优势；Figure 16 显示它与 temporal graph representation 方法相比也具有竞争力。

作者把性能收益主要归因于 matrix switchover：当链式哈希开始拥塞时及时切换，避免 probe cost 长期上升。

Figure 17 则显示 GeminiSketch 在四个数据集上的实际平均内存使用量显著低于 WBIndex+time、EdgeLog、EveLog、Smo-index 等时间图表示方法。

这符合 sketch 方法的基本优势：**它保留的是压缩后的图结构，而不是完整的时间图历史表示。**

---

### 4.4.5 与 Neo4j 的案例实验

![Figure 17-18 - Memory 与 Neo4j](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/fig17_18_memory_neo4j.png)

*图：论文 Figure 17–18，内存使用以及 GeminiSketch 与 Neo4j 的更新/边查询时间对比。*

作者报告：

- GeminiSketch 的平均 edge query 至少比原生 Neo4j 快 **4.32×**；
- 当数据规模为 1.3M 时，GeminiSketch edge query 平均为 **6.52 ms**，约比 Neo4j 快 **15.38×**；
- 但 GeminiSketch 的 insertion 平均 **5.564 ms**，比 Neo4j **慢约 10.03%**。

这个结果很有趣：说明 GeminiSketch 不是“所有操作都更快”，而是明显把优化预算放在了**查询与在线窗口维护**上。

不过这组比较只能看作工程 case study，而不能等价理解为“GeminiSketch 全面优于图数据库”。Neo4j 提供精确存储、持久化、事务、索引、属性图语义等大量 GeminiSketch 不提供的功能，两者系统目标不同。后面会继续讨论这一点。

---

## 4.5 具体实现细节

下面这些细节如果要复现实验非常重要：

- 实现语言：C++；
- 总 sketch memory budget：20 MB；
- 时间窗口过期阈值：100 天；
- $r=20$：最多 20 个 chain-hash 候选；
- $k=14$：最近 probe 均值超过 14 时切换矩阵；
- $l=10$：统计最近 10 次更新的 probe 次数；
- $g=1$：遇到 chain cut-off 后额外探测 1 个位置；
- frozen matrix 不再接收新事件，但 Rolling-out 继续运行；
- 当 frozen matrix 过期边全部删除后，该矩阵才能被下一轮复用；
- 同一 $(s,d)$ 的事件追加到 bucket list 尾部，bucket 本身不因为再次访问而移动到虚拟队列尾部；
- 查询跨越两张矩阵的 GT 边界时，把时间区间切成两段分别查询再聚合。

开源仓库 README 已给出 `make experiment`、`./experiment` 等复现实验入口，因此从系统论文角度看，复现门槛相对友好。

---

# 5. 讨论与思考 (Discussion and Reflection)

## 5.1 优点与创新点 (Strengths & Innovations)

### ① 最好的创新是“生命周期组织方式”，不是单点哈希技巧

GeminiSketch 最值得称道的是：作者没有再堆一个复杂 temporal index，而是重新思考**过期数据到底应该如何被组织**。

把 bucket 串成虚拟队列后，过期删除变成一个单向推进的前沿。这个设计非常适合 streaming system，因为时间本身就是单调前进的系统信号。

从系统设计角度看，这是一个很好的原则：

> **如果数据具有单调生命周期，最好让物理/逻辑组织方式也尽量具有单调性。**

### ② 双矩阵既是时间分区，也是冲突控制机制

双矩阵并不只是把“旧数据”和“新数据”分开。更深层的作用是：当 hash load 开始恶化时，立刻把新流量切到另一片较空区域。

因此 matrix switchover 同时扮演：

- temporal generation；
- congestion control；
- incremental reclamation boundary。

这使整个结构非常紧凑。

### ③ Chain hashing 对“结构查询”比对单纯计数查询更重要

对于 frequency estimation，collision 可能只是把计数抬高；但对于 subgraph / reachability，collision 会直接制造不存在的拓扑关系。

GeminiSketch 通过额外候选 bucket 尽量维持 edge identity，正好针对了 temporal graph query 中更严重的“结构污染”。

### ④ 消融实验基本覆盖了主要设计选择

论文分别验证了：

- $r$ 为什么取 20；
- $k$ 为什么取 14；
- 双矩阵是否优于单矩阵；
- Rolling-out 是否优于 Full Scan/Lazy；
- chain cut-off compensation 是否必要。

对一篇 data structure / systems 论文来说，这种实验链条比较完整。

---

## 5.2 局限性与可商榷之处 (Limitations & Debatable Points)

### ① “过期边淘汰 $O(1)$”更像摊销结论，不像严格 worst-case

论文声称过期淘汰是 $O(1)$，因为不再扫描 $n^2$ 个 bucket。

但 Algorithm 2 一次触发时可能：

- 连续删除一个 bucket 中很多过期事件；
- 连续清空多个 bucket；
- 沿虚拟队列推进较长距离。

因此单次调用的工作量显然可能大于常数。

更严谨的表述应该是：

> **每个事件最多被插入一次、删除一次，因此在长期流处理上可以获得较好的摊销成本；但单轮 elimination 的 worst-case 并非显然 $O(1)$。**

如果这篇论文后续扩展成理论版本，我认为最应该补的是一个正式的 amortized analysis 或 high-probability bound。

---

### ② Edge query 也不一定是严格 $O(1)$

Algorithm 3 找到 bucket 后，还要：

```text
for each edge e in bucket.list
```

扫描同一 $(s,d)$ 在不同时间的事件。

如果某条 edge 极其频繁，例如高频通信对、热点用户对，那么 list 长度可能很大。

所以更精确的复杂度应包含该 bucket 的事件数，例如：

$$
O(r+L_{s,d})
$$

其中 $L_{s,d}$ 是当前窗口内该顶点对的事件数。

只有在 $L_{s,d}$ 也被认为是小常数，或做了额外聚合时，才能近似写成 $O(1)$。

---

### ③ 对 out-of-order event time 的支持存在值得追问的假设

这是我认为论文最值得进一步验证的问题。

Rolling-out 对 bucket list 的处理是从 `list.head` 开始：只要 head 的时间戳未过期，就不会继续删除后面的元素。

但插入逻辑是按**到达顺序** append 到 list tail。

如果时间事件可能乱序到达，例如：

$$
t_1=100,\quad t_2=90
$$

而 $t_2$ 晚于 $t_1$ 到达，那么 list 可能是：

$$
[100,90]
$$

当淘汰阈值为 95 时，head=100 仍有效，于是后面的 90 可能暂时无法被发现。

论文理论部分甚至提到 temporal edges “arrive out of order”，但正文没有清楚给出 watermark、bounded lateness 或 list 内按时间排序机制。

因此需要追问：

> **GeminiSketch 是否实际假设输入流按 event timestamp 基本有序？如果允许任意乱序，Rolling-out 的及时性/准确性如何保证？**

这是一个非常重要的工程语义问题。

---

### ④ Chain cut-off 的概率模型有较强独立性假设

论文的 $P_{cut}$ 分析依赖：

- hash 近似均匀；
- 多次 collision 可近似独立；
- 两类 collision 的组合可乘；
- $(1-1/n)^m$ 可用指数近似。

在真实图中，度分布往往高度 skewed，热门顶点会产生大量相关 edge。此时二维 hash 冲突不是完全“均匀随机”的。

论文通过四个真实数据集证明实践效果不错，但理论部分更像**解释性概率模型**，还不是非常强的严格误差界。

---

### ⑤ 只有“两代矩阵”，时间查询能力仍有边界

双矩阵非常简洁，但它的代价是时间层级不丰富。

当前设计更适合：

- 一个主要 sliding window；
- 近期数据为主；
- 查询时间范围大多落在当前保留窗口。

如果应用需要同时回答：

- 最近 1 分钟；
- 最近 1 小时；
- 最近 7 天；
- 任意历史区间；

那么仅靠两张矩阵不够灵活。

作者在结论中也明确把 **temporal information compression 和 fine-grained temporal range query** 作为未来工作，这其实侧面承认了这一局限。

---

### ⑥ Baseline 的“每个新窗口重初始化”会放大 GeminiSketch 的延迟优势

为了保证 baselines 不携带过期边，作者在每个新窗口重建某些不支持在线淘汰的结构。

这在语义上是合理的，因为否则结果会不正确；但它也意味着 Table II 的 delay time 比较衡量的是：

> “原方法 + 作者选择的 temporal adaptation” vs. “原生支持 sliding 的 GeminiSketch”。

因此 0 ms 对 1000 ms 这种结果不能简单解释为底层 hash 操作快了 1000 倍，而应该理解为：

**GeminiSketch 的系统接口原生匹配 sliding-window workload，而一些 baseline 并不是为这个 workload 设计的。**

这是论文的优势，但也是比较口径需要注意的地方。

---

### ⑦ Neo4j 对比并非 apples-to-apples

GeminiSketch 是：

- 内存中的近似摘要；
- 固定预算；
- 允许估计误差。

Neo4j 是：

- 通用图数据库；
- 精确存储；
- 有持久化、事务、属性、索引等完整语义。

所以“查询快 15.38×”可以说明 GeminiSketch 在**专用近似查询**上很高效，但不能说明它能替代 Neo4j。

更理想的系统实验应该额外比较：

- 同样内存 resident 的专用 temporal graph engine；
- 精确 vs 近似在相同误差/资源预算下的 Pareto frontier；
- p95/p99 latency，而不仅是平均时间。

---

### ⑧ Temporal reachability 的语义还可以定义得更严谨

论文描述的是“在 $[t_b,t_e]$ 中施加时间约束的 BFS”，但没有特别细致地区分：

- 区间内静态聚合图上的 reachability；
- time-respecting path（路径上事件时间必须单调递增）；
- journey / foremost / fastest 等更严格 temporal-path semantics。

这几种定义在 temporal graph 文献中并不等价。

如果 GeminiSketch 面向更复杂 temporal path query，时间语义需要进一步形式化。

---

## 5.3 未来工作与启发 (Future Work & Inspirations)

### 方向 1：从“两矩阵”推广为自适应 generation ring

可以考虑把：

$$
2\text{ matrices}
$$

推广为：

$$
K\text{-generation ring}
$$

但 $K$ 不必固定很大，而是根据：

- 写入速率；
- 过期速率；
- hash congestion；
- 查询时间跨度

自适应决定。

这样有机会兼顾 GeminiSketch 的平坦结构和更细粒度时间范围查询。

### 方向 2：加入 watermark / bounded-lateness 机制处理乱序事件

如果流系统允许 event-time lateness，可以在每个 bucket 中维护：

- 最小 timestamp；
- 小型 time-ordered buffer；
- watermark；
- 或分段聚合的时间块。

这样 Rolling-out 就能从“按 arrival order”升级成真正对 event time 健壮的回收机制。

### 方向 3：用 deletion-friendly hashing 替代 cut-off 补丁

chain cut-off 本质上来自 open-addressing 删除后的搜索路径断裂。

可以尝试：

- tombstone；
- Robin Hood hashing；
- hopscotch hashing；
- cuckoo-style relocation；
- quotient/filter 类可删除结构。

目标是让“边过期”成为 hash table 的一等公民，而不是删除后再用 $g=1$ 线性探测补偿。

### 方向 4：给 Rolling-out 建立严格摊销复杂度

可以证明：

- 每条 event 被访问/删除的最大次数；
- 单位流量下的 amortized elimination cost；
- 在某种到达分布和窗口长度下的 tail latency bound。

这样会让论文从“系统设计有效”进一步上升到“理论保证更完整”。

### 方向 5：研究 skew、burst 与 adversarial workload

现实时间图常有：

- 超级节点；
- 热点 edge；
- 突发事件；
- 周期性高峰。

这会导致某些 bucket list 特别长，或某些 hash row/column 热点严重。

如果能让 $r,k$ 根据局部负载自适应，而不是全局固定，可能进一步降低 tail latency。

### 方向 6：从单机 sketch 扩展到并发/分布式 temporal sketch

论文实验平台虽然有 20 threads，但方法论本身主要按单结构逻辑描述，并没有重点讨论：

- 多线程同时 insert/query/eliminate 时的锁粒度；
- HP/TP/MP 的并发更新；
- matrix switchover 的一致性；
- NUMA / cache locality；
- 分布式 shard 下的时间边界对齐。

如果要真正落地到高速网络监控或金融流系统，这些问题很关键。

---

## 5.4 对研究工作的几点方法论启发

### 启发 A：不要把“删除”当成数据结构的附属操作

很多 streaming 论文先设计 insertion/query，再补一个 expiration mechanism。

GeminiSketch 的启发是：

> **如果 workload 的核心语义就是 sliding window，那么 expiration 应该从数据结构第一天就参与布局设计。**

这也是 Rolling-out 能做得简洁的原因。

### 启发 B：查询性能常常来自“减少应该看的地方”，而不是单个算子更快

GeminiSketch 的速度主要来自：

- 时间范围先定位到 1–2 张矩阵；
- edge 再定位到少量 hash buckets；
- 过期数据提前清理。

也就是说，优化逻辑是不断缩小候选空间：

$$
\text{all history}
\rightarrow
\text{relevant matrix}
\rightarrow
\text{relevant hash bucket}
\rightarrow
\text{relevant timestamps}
$$

这是数据库索引设计中非常通用的思想。

### 启发 C：一个好系统结构往往让多个问题互相“顺带解决”

双矩阵降低冲突；冲突降低后 query 更快；旧矩阵独立后 deletion 更好做；删除及时后准确率又更高。

这种互相正反馈的结构，比为每个问题单独加一个复杂模块更优雅。

---

## 5.5 值得继续追问的几个问题

1. **如果输入 timestamp 严重乱序，Rolling-out 是否仍能保证所有过期事件及时删除？**需要 watermark 还是 list 排序？
2. **为什么只用两张矩阵？**3–8 张小矩阵组成 ring 是否可以获得更细的 temporal granularity，而仍避免 Horae/HIGGS 那种深层树结构？
3. **能否彻底消除 chain cut-off？**与其用 $g=1$ 补偿，是否可以采用 tombstone 或 deletion-aware open addressing？
4. **热点 edge 会不会让单 bucket list 变得很长？**此时 edge query 的 $O(1)$ 假设是否失效？
5. **reachability precision 会如何随 path length 增长？**一条路径由多条近似边组合，false positive 是否会累积放大？
6. **如果同时存在多个不同长度的窗口查询，GeminiSketch 还能保持同样优势吗？**
7. **矩阵切换阈值 $k$ 能否在线学习？**例如根据 p99 update latency 而不是平均 probe 次数触发切换。
8. **与精确 temporal graph engine 比较时，accuracy-memory-latency 的 Pareto frontier 是什么样？**这比单独报告“快多少倍”更有解释力。

---

# 总结

GeminiSketch 是一篇结构非常“数据库系统化”的工作：它没有追求复杂的模型，而是围绕时间图流中的三个基本矛盾——**内存有限、查询要快、旧边必须及时消失**——设计了一套紧凑的数据生命周期机制。

如果只记住三个关键词，可以记：

> **Dual Matrix → 控制时间代际与拥塞**  
> **Chain Hashing → 尽量保留 edge identity**  
> **Rolling-out → 用单向回收前沿替代 full scan**

从实验看，这三者确实形成了比较完整的因果链：dual-matrix 减少 hash chain 和 ARE，Rolling-out 在保持高吞吐的同时避免 Lazy deletion 的误差，cut-off compensation 进一步修复删除引起的查询失败。

不过论文在理论复杂度、乱序 event-time 语义、temporal reachability 定义以及通用数据库对比公平性上仍有值得进一步打磨之处。换言之，**它的工程思想很强，严格理论刻画还有继续深入的空间。**

---

## 参考链接

- GeminiSketch 开源代码：<https://github.com/NOWEVERYTHINGISFINE/GeminiSketch>
- ICDE 2026：<https://icde2026.github.io/>
- DOI：<https://doi.org/10.1109/ICDE65706.2026.00010>
- CCF 推荐目录可检索 ICDE（A 类）：<https://www.ccfrankings.org/>

> 注：本文中的 Figure 1/2/3/5/6/7/9–13/17/18 与 Table II 均来自用户提供的论文 PDF，仅用于论文阅读笔记中的技术解读。
