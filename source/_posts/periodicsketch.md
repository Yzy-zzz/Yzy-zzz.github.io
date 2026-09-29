---
layout: post
title: "《PeriodicSketch: Finding Periodic Items in Data Streams》阅读笔记"
date: "2026-09-01 22:33:06"
updated: "2026-09-01 22:33:06"
permalink: papers/periodicsketch/
categories: ["论文阅读"]
tags: ["Sketch","过滤器"]
excerpt: "论文摘要报告：PeriodicSketch 在只使用基线约 1/10 内存的情况下，AAE 平均降低约 737 倍、最高约 2019 倍，平均吞吐量约为基线的 3.1 倍。"
disableNunjucks: true
comments: false
---

> 👨‍🔬 **定位**：面向刚进入数据流 / Sketch / 网络测量方向的博士生、硕士生或跨领域研究者。  
> **阅读主线**：**问题定义 → 两阶段 Sketch 架构 → GSU 概率替换机制 → 理论保证 → 实验验证 → 批判性思考**。

---

## 开头：论文发表信息、CCF 级别与开源情况

**论文题目**：*PeriodicSketch: Finding Periodic Items in Data Streams*  
**作者**：Zhuochen Fan, Yinda Zhang, Tong Yang, Mingyi Yan, Gang Wen, Yuhan Wu, Hongze Li, Bin Cui  
**发表会议**：**IEEE International Conference on Data Engineering (ICDE 2022)**  
**会议时间**：2022 年 5 月 9–12 日  
**会议地点**：Kuala Lumpur, Malaysia  
**论文页码**：96–109  
**DOI**：`10.1109/ICDE53745.2022.00012`  
**CCF 等级**：**CCF A 类**（数据库 / 数据挖掘 / 内容检索方向）

🔗 相关链接：

- 代码仓库：[https://github.com/pkufzc/PeriodicSketch](https://github.com/pkufzc/PeriodicSketch)
- 作者公开 PDF：[https://yangtonghome.github.io/uploads/PeriodicSketch.pdf](https://yangtonghome.github.io/uploads/PeriodicSketch.pdf)
- DBLP 条目：[https://dblp.org/rec/conf/icde/FanZYYWWLC22](https://dblp.org/rec/conf/icde/FanZYYWWLC22)
- CCF 数据库方向会议目录：[https://www.ccf.org.cn/Academic_Evaluation/DM_CS/zgjsjxhtjgjxshy/](https://www.ccf.org.cn/Academic_Evaluation/DM_CS/zgjsjxhtjgjxshy/)

✅ **是否开源：是。**  
论文正文明确给出了 GitHub 仓库。当前仓库除了论文中的基础版 **PeriodicSketch** 外，还能看到后续扩展版本 **PeriodicSketch+** 及 FPGA、Tofino 等目录；但本文以下技术解读严格围绕 **ICDE 2022 论文中的 PeriodicSketch** 展开，不把后续版本的设计混入原论文贡献。

---

# 1. 摘要 (Abstract) 与核心贡献 (Core Contribution)

## 一句话总结

> **PeriodicSketch 将“寻找周期项”转化为“对 `<item, interval>` 复合元素寻找高频项”，再用一个负责估计相邻到达间隔的 Cover-Min Sketch 和一个采用概率替换策略的 GSU Sketch，在常数级单次处理时间和很小内存下实时找出 Top-K 周期项。**

## 贡献列表 (Contribution List)

- **首次系统定义并研究数据流中的 Top-K 周期项发现问题。**  
  论文不是做传统时间序列周期检测，而是关注高速、单遍、有限内存的数据流场景：如果某个 item 的某一到达间隔反复出现，则将 `<item, interval>` 视为具有高“周期频率”的候选。

- **提出两阶段数据结构 PeriodicSketch。**  
  第一阶段 **Cover-Min Sketch** 近似恢复每次到达与上次同 item 到达之间的时间间隔；第二阶段将 `<item, interval>` 作为新的“元素”，交给 **GSU Sketch** 做 Top-K 高频元素保留。

- **提出 Guaranteed Soft Uniform（GSU）替换机制。**  
  与 Space-Saving 在发生未命中时几乎“硬替换/硬抬高最小计数器”不同，GSU 使用随失败次数自适应增加的替换概率，尽量避免大量冷元素污染最小频率，同时又保证新来的真正高频元素最终有机会进入 Sketch。

论文摘要报告：PeriodicSketch 在只使用基线约 **1/10 内存**的情况下，AAE 平均降低约 **737 倍**、最高约 **2019 倍**，平均吞吐量约为基线的 **3.1 倍**。

---

# 2. 引言 (Introduction)：问题背景与研究动机

## 2.1 问题定义 (Problem Definition)

给定数据流：

$$
S=(e_1,e_2,\ldots,e_i,\ldots)
$$

对于一个具体 item \(e\)，设它第 \(i\) 次出现的时间戳为 \(t_i\)，相邻两次出现的时间间隔为：

$$
V_i=t_{i+1}-t_i
$$

论文对“周期”的定义非常工程化：  
如果某个时间间隔 \(V\) 在 item \(e\) 的相邻到达间隔中反复出现，那么 \(e\) 就在间隔 \(V\) 上表现出周期性。

考虑时间戳噪声后，论文把 \(V\) 的频率定义为：

$$
f(e,V)
=
\sum_i
\mathbf{1}
\left(
\left|V_i-V\right|\le \Delta T
\right)
$$

其中：

- \(e\)：item，例如网络中的一个流 / IP 对；
- \(V_i\)：相邻两次到达的实际时间差；
- \(V\)：待统计的周期；
- \(\Delta T\)：允许的时间误差；
- \(f(e,V)\)：这个 item 以该间隔重复出现的次数。

最终任务是找出频率最大的 Top-K 个：

$$
\langle e,V\rangle
$$

对。

### 一个非常容易忽略的点

**同一个 item 可以对应多个周期，并可以在 Top-K 中出现多次。**

例如：

- `<a, 2s>` 出现很多次；
- `<a, 4s>` 也出现很多次；

那么它们是两个独立的周期元素。

这意味着本文寻找的不是“哪个 item 最周期”，而是：

> **哪些 `<item, interval>` 组合最频繁地重复出现。**

---

## 2.2 为什么这个问题重要？

论文给了四类应用：

1. **Cache Prefetch**：发现某个对象每隔固定时间被请求，就可以在下一次预计到达前预取。
2. **APT 检测**：部分长期潜伏攻击会周期性建立 TCP 连接、发 DNS 请求或回传数据。
3. **网络流量预测 / 分类**：周期性可以作为机器学习模型的重要统计特征。
4. **金融交易与用户行为**：周期性交易、点击、购买行为可能对应异常操作或稳定兴趣。

它们有一个共同特征：

> 数据不是离线静态序列，而是持续、快速到来的 **stream**。

因此算法必须满足论文强调的两个条件：

- **one-pass**：每条数据只能看一遍；
- **O(1) 级单条处理时间**：必须跟得上高速流。

这正是很多经典周期挖掘方法无法直接满足的地方。

---

## 2.3 现有方法的局限 (Limitations of Prior Work)

### 路线一：传统周期模式 / 时间序列周期检测

诸如 TiCom、SAZED、STAGGER、RobustPeriod 等工作也研究周期性，但问题定义和计算模型不同。

论文指出，这些方法往往具有：

- \(O(n\log n)\)；
- \(O(n^2)\)；
- 需要固定长度窗口；
- 需要处理整个时间序列或复杂候选模式。

对于高速数据流而言，最大问题不是“能不能检测周期”，而是：

> **每来一个包/请求，能不能在常数时间和有限内存中更新状态？**

这是本文真正的切入点。

### 路线二：Bloom Filter + Space-Saving 基线

作者构造了一个很直观的基线：

1. 用大量 Bloom Filter 记录不同时间片中出现过哪些 item；
2. 当 item 再次到达时，向前查询其上次出现的时间片；
3. 得到近似间隔；
4. 将 `<item, interval>` 放入 Space-Saving，找高频元素。

问题很明显：

- 若可能的 interval 很多，就需要维护大量时间片 / Bloom Filter；
- 单次插入要查询多个历史结构；
- 时间间隔被离散成预定义粒度，难以表达 1.5s、1.6s 之类非预设周期；
- Space-Saving 容易被大量冷元素不断“抬高”最小计数器，引入严重高估。

所以作者真正想替换的是两个部件：

> **Bloom Filters → Cover-Min Sketch**  
> **Space-Saving → GSU Sketch**

---

## 2.4 本文思路 (Overall Idea)

论文的关键观察非常漂亮：

### 第一步：把时间问题变成“相邻间隔估计”

对于每个新到达的 `(e,t)`，只需要回答：

> “这个 item 上一次大约什么时候出现？”

就可以得到：

$$
V=t-t_{\text{last}}
$$

### 第二步：把周期问题变成“高频元素问题”

一旦得到 \(V\)，构造：

$$
E=\langle e,V\rangle
$$

那么，如果 `<e,V>` 在流里反复出现，它就是一个高频元素。

于是：

> **周期检测问题 → 复合键上的 Heavy-Hitter / Frequent-Item 问题。**

这是整篇论文最核心的“问题重写”。

---

# 3. 方法论深度解析 (In-depth Methodological Analysis)

# 3.1 整体架构 (Overall Architecture)

论文 **Figure 1** 给出了完整流程：

```text
输入数据流 (e, t)
       │
       ▼
┌──────────────────┐
│ Cover-Min Sketch │
│ 估计上次出现时间 │
└──────────────────┘
       │
       │ 得到 interval V
       ▼
构造 E = <e, V>
       │
       ▼
┌──────────────────┐
│    GSU Sketch    │
│ 保留高频周期元素 │
└──────────────────┘
       │
       ▼
按频率输出 Top-K <e,V>
```

这套结构有很明确的职责分工：

| 阶段 | 输入 | 输出 | 主要解决的问题 |
|---|---|---|---|
| Cover-Min | `<e,t>` | 估计间隔 \(V\) | “上次 e 何时出现？” |
| 复合键构造 | \(e,V\) | \(E=\langle e,V\rangle\) | 把周期问题转为频率问题 |
| GSU | \(E\) | \(E,f\) | 在小内存中保留高频周期候选 |
| Top-K 查询 | 全部 GSU cells | Top-K `<e,V>` | 返回最终周期项 |

### 宏观设计思想

传统方案在“时间轴”上建立大量数据结构；PeriodicSketch 则把问题压缩成两个固定大小的数据结构：

> **一个负责时间，另一个负责频率。**

因此数据结构数量不再随“允许的 interval 种类”线性增长。

这正是它在空间和吞吐量上能够显著超过基线的根本原因。

---

# 3.2 核心组件/模块拆解 (Core Component Breakdown)

## 3.2.1 Cover-Min Sketch：用覆盖冲突近似恢复上次到达时间

论文 **Figure 2** 展示了 Cover-Min Sketch。

它受 Count-Min Sketch 启发，由：

- \(d\) 个数组；
- 每个数组 \(w\) 个 bucket；
- \(d\) 个两两独立哈希函数：

$$
h_1(\cdot),h_2(\cdot),\ldots,h_d(\cdot)
$$

组成。

论文描述每个 bucket 保存 item ID 和 timestamp。

---

### 输入与输出

**输入：**

$$
(e,t)
$$

**输出：**

$$
\hat V
$$

即当前到达与估计上次到达时间之间的间隔。

---

### 内部机理

对 item \(e\)，计算：

$$
h_1(e),\ldots,h_d(e)
$$

找到 \(d\) 个位置。

在写入当前时间戳 \(t\) 之前，先取这 \(d\) 个位置中**最小的历史时间戳**：

$$
\hat T_e
=
\min_{i=1}^{d}
A_i[h_i(e)]
$$

然后：

$$
\hat V=t-\hat T_e
$$

最后把所有这些位置的 timestamp 覆盖为当前时间 \(t\)。

---

### 为什么要取 minimum？

这是理解 Cover-Min 最关键的地方。

设 item \(e\) 上一次真实出现时刻为：

$$
T_e
$$

如果从 \(T_e\) 到当前时间之间，有其他 item 与 \(e\) 发生哈希冲突，那么原来的 timestamp 会被别人覆盖成一个更晚的时间。

因此某个 bucket 中记录的是：

$$
T'_e \ge T_e
$$

如果只用一个哈希表：

$$
\hat V=t-T'_e \le t-T_e=V
$$

即 interval 会被**低估**。

但用了 \(d\) 个独立哈希表后，只要至少有一个位置没有被后来的冲突污染，它就仍然保存着真实的 \(T_e\)。

取所有候选 timestamp 中最小者，相当于：

> **在多个“可能被覆盖”的副本中，选最接近真实旧时间的那个。**

这与 Count-Min 的“取最小计数器以减轻碰撞高估”在思想上非常类似，因此作者命名为 **Cover-Min**：

- **Cover**：新数据直接覆盖 timestamp；
- **Min**：查询时取最小 timestamp。

---

### Cover-Min 的误差方向非常重要

哈希冲突通常只会让记录的时间戳变得**更晚**：

$$
\hat T_e\ge T_e
$$

所以：

$$
\hat V\le V
$$

即它具有明显的**单向低估偏差**。

这既是优点，也是潜在风险：

- 优点：误差模式容易分析；
- 风险：真实周期 \(V\) 可能被错误映射到更短 interval，导致 `<e,V>` 的统计被拆散或与别的 interval 合并。

GSU 再强，也无法完全补救第一阶段已经估错的 interval。

---

### 关键概率直觉

论文在 Section V-A 给出一个很直观的正确性概率。

假设两次 \(e\) 到达之间共有 \(K\) 个其他 item。

单个长度为 \(w\) 的 hash array 被至少一次冲突覆盖的概率约为：

$$
1-\left(1-\frac1w\right)^K
$$

若 \(d\) 个独立数组都发生污染，才会导致 interval 出错，因此：

$$
\Pr(\hat V<V)
=
\left[
1-\left(1-\frac1w\right)^K
\right]^d
\le
\left(\frac Kw\right)^d
$$

### 直觉

- \(w\) 越大 → 碰撞越少；
- \(d\) 增大 → “所有副本同时出错”更难；
- 但在固定总内存下，\(d\) 增大又会让每个 array 的 \(w\) 变小。

这就自然解释了后面 **Figure 6 中 \(d=2\) 最好，而不是越大越好**。

---

## 3.2.2 `<item, interval>` 联合编码：论文最关键的问题转化

论文 Section IV-C 做了一件看似简单、实际上非常重要的事：

$$
E=\langle e,V\rangle
$$

此后，算法不再处理“周期”这个复杂概念，而只处理元素 \(E\)。

例如：

$$
E_1=\langle e, V_1\rangle
$$

与：

$$
E_2=\langle e,V_2\rangle
$$

被视为两个完全不同的元素。

---

### 为什么这个转化很重要？

传统 periodicity mining 通常要维护：

- 候选 period；
- phase；
- pattern；
- window；
- 支持度；
- 序列匹配。

而本文把最核心的周期定义压缩成：

> “相邻间隔为 \(V\) 这件事出现了多少次？”

于是只需统计：

$$
f(E)=f(\langle e,V\rangle)
$$

就够了。

所以 GSU 本质上不是一个“周期检测算法”，而是：

> **一个针对周期复合键的近似 Heavy-Hitter 数据结构。**

这也是为什么作者可以借鉴 Space-Saving / Unbiased Space-Saving 的思想。

---

## 3.2.3 GSU Sketch：真正决定准确率的核心模块

论文 **Figure 3** 展示了 GSU Sketch。

它可以看成一个 hash table：

- 一共有 \(u\) 个 bucket；
- 每个 bucket 有 \(\lambda\) 个 cell；
- 用一个 hash function \(h(E)\) 把 \(E\) 映射到一个 bucket；
- 每个 cell 保存：

$$
\langle E,f\rangle
=
\langle e,V,f\rangle
$$

其中 \(f\) 是该 interval 的估计频率。

---

### 输入和输出

**输入：**

$$
E=\langle e,V\rangle
$$

**输出 / 状态：**

在对应 bucket 中维护最值得保留的候选 \(E\) 及其频率估计。

---

### 插入逻辑

对 \(E\) 映射到 bucket \(S[h(E)]\) 后：

#### 情况 1：E 已经存在

直接：

$$
f(E)\leftarrow f(E)+1
$$

#### 情况 2：E 不存在，但 bucket 有空位

插入：

$$
(E,1)
$$

#### 情况 3：E 不存在，而且 bucket 已满

找到 bucket 内频率最小的元素：

$$
L
$$

其频率记为：

$$
f_{\min}
$$

这时不直接替换，而是启动本文最核心的：

> **Guaranteed Soft Uniform Replacement (GSU)**

---

# 3.3 关键公式与算法 (Key Equations and Algorithms)

## 3.3.1 核心公式一：GSU 的替换概率

论文给出的替换概率为：

$$
P
=
\frac{1}
{2f_{\min}-t_{\text{fail}}+1}
$$

其中：

- \(f_{\min}\)：当前 bucket 中最小频率；
- \(t_{\text{fail}}\)：自上次成功替换之后，当前最小元素已经抵抗了多少次失败的替换尝试；
- \(P\)：当前新元素成功替换 \(L\) 的概率。

---

### 公式目标

这个概率设计要同时解决两个互相冲突的需求：

1. **不能让每个陌生冷元素都轻易替换当前候选；**
2. **又不能让早期进入 Sketch 的元素永远占坑。**

如果用 Space-Saving 风格的激进更新：

- 大量只出现一次的冷元素不断到来；
- 最小计数器被不断抬升；
- 产生严重 over-estimation。

如果完全不允许替换：

- 后期出现的真正热点永远进不来。

GSU 的目标就是在二者之间做一个“软门控”。

---

### 为什么 \(P\) 这样变化？

当 \(t_{\text{fail}}=0\)：

$$
P=\frac{1}{2f_{\min}+1}
$$

如果 \(f_{\min}\) 很大，替换概率会很小。

这表示：

> **当前最小元素都已经积累了很大频率，新来的单次事件没有足够证据推翻它。**

随着替换不断失败：

$$
t_{\text{fail}}\uparrow
$$

分母逐渐变小：

$$
P\uparrow
$$

当：

$$
t_{\text{fail}}=2f_{\min}
$$

有：

$$
P=1
$$

即：

> **最多经历 \(2f_{\min}\) 次失败以后，替换一定发生。**

这就是 **Guaranteed**。

---

## 3.3.2 “Soft Uniform” 到底是什么意思？

论文 Theorem V.2 证明：

在 \(f_{\min}\) 固定的简化条件下，第 \(i\) 次尝试恰好成为成功替换点的概率为：

$$
P_i
=
\frac{1}{2f_{\min}+1}
$$

也就是说：

> 从第一次尝试到最迟的强制替换点，每一个可能的“成功位置”概率相同。

所以叫 **Uniform**。

同时，每一步是否替换又是概率性的，不是 hard replacement，因此叫 **Soft**。

最终又保证一定会替换，所以是：

> **Guaranteed + Soft + Uniform**

这个名字其实非常准确地概括了算法行为。

---

## 3.3.3 为什么平均需要 \(f_{\min}\) 次尝试？

论文 Theorem V.3 推出：

$$
\mathbb E[t_{\text{fail}}]
=
f_{\min}
$$

这非常关键。

它意味着一个候选想要把当前最小元素挤掉，平均需要贡献大约 \(f_{\min}\) 次“竞争机会”。

因此：

- 真正频繁出现的元素更容易多次触发 GSU，最终进入；
- 一次性冷元素通常只贡献一两次失败，不会轻易污染结构。

从 Heavy-Hitter 的视角看，这相当于一个**自适应准入门槛**。

门槛不是人为设定固定 threshold，而是由当前 Sketch 的：

$$
f_{\min}
$$

动态决定。

---

## 3.3.4 成功替换后为什么还要修正最小频率？

当替换成功时，论文并不简单把新元素计数设为 1。

它会依据累计失败次数，对最小频率做一个小幅修正，可理解为：

$$
f_{\min}
\leftarrow
f_{\min}
+
\left\lfloor
\frac{t_{\text{fail}}}{f_{\min}}
\right\rfloor
$$

随后：

$$
t_{\text{fail}}\leftarrow 0
$$

因为：

$$
0\le t_{\text{fail}}\le 2f_{\min}
$$

所以修正量通常只可能是：

$$
0,\;1,\;2
$$

其目的不是精确恢复新元素真实历史频率，而是：

> 用“它为了成功替换付出了多少次竞争尝试”作为其潜在频率的粗略证据。

---

## 3.3.5 Figure 4：GSU 两个运行示例应该怎么看？

论文 **Figure 4** 给了两个很有教育意义的例子。

### Example 1：允许轻微高估

新元素 E 前几次替换失败，使 \(t_{\text{fail}}\) 增长；当替换终于发生时，计数可能略高于 E 当前真实出现次数。

随后另一个更高频的 G 多次出现，最终再把 E 替换掉。

这里作者想表达：

> **局部的一次高估不会永久锁死状态。**

### Example 2：允许轻微低估

另一个流中 E 连续多次出现，在经历数次替换失败后才进入 Sketch，因此进入时记录的频率可能低于真实频率。

作者强调：

> GSU 允许短期高估或低估，但随着持续到达，误差有机会互相抵消，真正高频元素更容易稳定留下。

这比“每次 miss 都机械加 1”的 Space-Saving 更不容易被冷流量系统性推高。

---

# 3.4 理论分析：论文到底证明了什么？

论文 Section V 的理论部分很长，建议抓住四个结论。

## 3.4.1 Cover-Min 的碰撞误差是可控的

前面已经看到：

$$
\Pr(\hat V<V)
\le
\left(\frac Kw\right)^d
$$

说明只要两次相邻出现之间的其他 item 数 \(K\) 相比 table width \(w\) 不太大，Cover-Min 有较高概率得到正确 interval。

---

## 3.4.2 GSU 保证不会无限拒绝替换

Theorem V.1：

$$
0\le t_{\text{fail}}\le 2f_{\min}
$$

这是“Guaranteed”的严格数学来源。

---

## 3.4.3 频率估计具有非渐近上界

论文 Theorem V.4 给出：

$$
\hat f
\le
f+f_{\min}
$$

含义是：

> 即使存在 over-estimation，估计值不会无约束地膨胀，其高估量与当前最小频率同阶。

相较 Space-Saving 中大量冷元素持续把最小计数器抬高，这正是 GSU 想改善的问题。

---

## 3.4.4 “Quasiconsistency”：长期运行后，热点元素倾向稳定保留

论文在 i.i.d. 有限域假设下定义：

$$
p_1>p_2>\cdots>p_M
$$

并证明当流足够长时，较高到达概率的元素会以高概率进入并保持在 GSU 中。

作者称之为：

> **quasiconsistency（准一致性）**

直觉上就是：

- 热元素不断累积；
- 与最小元素的频率差拉大；
- 一旦头部元素形成足够优势，就越来越难被尾部元素挤出去。

### 但要注意

这里的理论前提是：

- i.i.d.；
- 有限元素域；
- 到达概率相对稳定；
- 某些证明还先从单 bucket 情况出发。

而真实网络流经常存在：

- concept drift；
- burst；
- diurnal pattern；
- attack-induced distribution shift。

因此理论更像是：

> **解释 GSU 为什么合理，证明它不会出现明显病态行为；**

而不是给现实数据流一个无条件的 Top-K 精确保证。

这一点在读论文时需要分清。

---

# 4. 实验设计与结果分析 (Experimental Design and Results Analysis)

## 4.1 实验设置 (Experimental Setup)

### 数据集

论文使用四组真实数据：

| 数据集 | 规模 | distinct items | 类型 |
|---|---:|---:|---|
| CAIDA2016 | 约 30M | 约 900K | 匿名 IP trace |
| CAIDA2018 | 约 30M | 约 900K | 匿名 IP trace |
| MAWI | 约 9M | 约 13K | 网络流量 trace |
| MACCDC | 约 13M | 约 400K | Cyber Defense Competition 流量 |

每个 item 在主实验中由：

- source IP：4 bytes；
- destination IP：4 bytes；

组成，共 8 bytes。

时间戳精度为微秒。

---

### 默认参数

论文设定：

$$
\Delta T=1\text{ ms}
$$

参数实验后推荐：

$$
r=15\%
$$

$$
d=2
$$

其中：

- \(r\)：Cover-Min 占 PeriodicSketch 总内存比例；
- \(d\)：Cover-Min 的 hash table 数。

所以：

$$
M_{HC}=\frac{Mr}{d}
$$

为单个 Cover-Min hash table 的内存，而：

$$
M_{HG}=M(1-r)
$$

给 GSU。

---

### 评价指标

论文使用五个指标：

#### Precision Rate

$$
PR
=
\frac{\#\text{正确报告的周期项}}
{\#\text{报告出的周期项}}
$$

#### Recall Rate

$$
RR
=
\frac{\#\text{正确报告的周期项}}
{\#\text{真实周期项}}
$$

#### Average Absolute Error

$$
AAE
=
\frac1{|\Psi|}
\sum_{e_i\in\Psi}
|f_i-\hat f_i|
$$

#### Average Relative Error

$$
ARE
=
\frac1{|\Psi|}
\sum_{e_i\in\Psi}
\frac{|f_i-\hat f_i|}{f_i}
$$

#### Throughput

以 Mips（million insertions per second）衡量。

吞吐实验重复 10 次并取均值。

---

### 实现环境

- C++
- 32-bit Bob Hash，不同随机 seed
- Intel Core i5-8259U @ 2.30GHz
- 4 cores / 8 threads
- 16GB DRAM
- 每核 64KB L1、256KB L2
- 共享 6MB L3

---

## 4.2 参数实验：Figure 5 与 Figure 6

### Figure 5：为什么 \(r\approx 15\%-20\%\) 最好？

当 \(r\) 太小：

- Cover-Min 太窄；
- hash collision 增多；
- interval 估计错误；
- `<e,V>` 复合键本身就构造错了。

当 \(r\) 太大：

- Cover-Min 变准；
- 但 GSU 可用空间减少；
- 候选周期元素容纳能力下降；
- Recall 反而下降。

这说明 PeriodicSketch 是一个典型的**级联误差系统**：

> 第一阶段需要足够准确，但超过某个点以后，继续给第一阶段加内存不如留给第二阶段有价值。

作者最终选：

$$
r=15\%
$$

这是一个很有工程味的权衡。

---

### Figure 6：为什么 \(d=2\)，不是越多越好？

如果总 Cover-Min 内存固定：

- \(d\uparrow\)：独立副本更多；
- 但每个 table 的宽度 \(w\downarrow\)。

理论上增加 \(d\) 可以降低“所有表同时碰撞”的概率；  
但 \(w\) 变小又会提高单表碰撞率。

实验表明这个 trade-off 在 \(d=2\) 附近最好。

这与 Section V-A 的碰撞概率分析是相互呼应的：

> 这不是一个纯经验超参数，而是能够从冲突概率与内存分配角度解释。

---

# 4.3 主实验结果 (Main Results)

论文主比较位于 **Figure 7–11**。

一个需要特别注意的设置：

- PeriodicSketch：**50–150 KB**
- Baseline：**500–1500 KB**

也就是说：

> **基线拿到约 10 倍内存。**

即便如此，PeriodicSketch 仍然明显领先。

---

## Figure 7：Precision Rate

论文报告：

> PeriodicSketch 的 PR 平均比 baseline 高约 **77.3%**。

从图中可见，PeriodicSketch 在四个数据集上大多接近 0.9–1.0，而 baseline 明显更低。

### 这验证了什么？

Precision 高意味着：

> 被 GSU 留下的 `<e,V>` 候选中，大部分确实是真正高频周期元素。

这直接支持作者关于 GSU 的主要假设：

- 冷元素不应轻易污染候选集合；
- 高频元素应该更容易留下。

---

## Figure 8：Recall Rate

论文报告：

> RR 平均提高约 **74.4%**。

这一点尤其重要。

因为一种“保守”的 Sketch 很容易做到高 Precision：

> 只留下极少数最明显的热点即可。

但如果 Recall 同时很高，说明 GSU 并没有因为概率拒绝替换而把大量真正热点挡在外面。

因此 Figure 7 + Figure 8 放在一起，验证的是：

> **GSU 的“软准入”既降低冷元素污染，又没有严重牺牲热点进入机会。**

---

## Figure 9：AAE

论文报告四组数据上，PeriodicSketch 的 AAE 分别比 baseline 低约：

- 173–206 倍；
- 273–360 倍；
- 1346–2019 倍；
- 656–830 倍。

平均：

$$
\approx 737\times
$$

这是全文最夸张、也最能体现 GSU 价值的结果。

### 为什么差距能达到几个数量级？

基线中的 Space-Saving 有一个结构性问题：

当新元素不在表中时，最小 counter 会频繁参与替换或被抬高。

在网络流中存在大量只出现一次或很少出现的“mice”：

$$
\text{大量冷元素}
\rightarrow
f_{\min}\text{不断被推高}
\rightarrow
\text{系统性 over-estimation}
$$

GSU 则把这一过程改成了低概率触发，因此从机制上正好打击 AAE 的主要来源。

所以 Figure 9 并不是一个孤立的 benchmark 数字，而是：

> **与方法论中“减少冷元素对最小频率污染”的核心假设高度一致。**

---

## Figure 10：ARE

论文报告 ARE 平均约降低：

$$
284\times
$$

它和 AAE 的趋势一致，说明改进不是仅由少数大频率元素驱动，也体现在相对误差层面。

---

## Figure 11：Throughput

PeriodicSketch 平均吞吐量约：

$$
14.5\text{ Mips}
$$

相对 baseline 提升：

$$
2.8\times\sim4.1\times
$$

平均约：

$$
3.1\times
$$

### 为什么更快？

基线需要：

> 在多个 Bloom Filter / 时间片中查询历史出现状态。

PeriodicSketch 则每条记录主要做：

1. Cover-Min 的固定 \(d\) 次 hash；
2. 一个 GSU hash；
3. 在固定容量 bucket 中查找/替换。

所以更新路径天然更短。

从系统角度看，这里的加速并不神秘：

> **用“固定少量随机访问”替代“随时间结构增长的多结构查询”。**

---

# 4.4 消融实验 (Ablation Studies)

这里需要非常明确地指出：

> ⚠️ **论文没有提供现代机器学习论文那种严格的模块级消融实验。**

它没有直接做：

- PeriodicSketch without GSU；
- GSU → Space-Saving，只保持 Cover-Min 不变；
- Cover-Min → exact last timestamp，只保持 GSU 不变；
- 不同 replacement rule 的逐项比较。

因此我们不能从实验中严格量化：

> “Cover-Min 提升了多少，GSU 又提升了多少”。

论文真正提供的、最接近消融的是：

1. **Figure 5：改变 Cover-Min / GSU 的内存比例 \(r\)**；
2. **Figure 6：改变 Cover-Min hash 数 \(d\)**；
3. 与完整 Bloom + Space-Saving baseline 对比。

---

## 哪个模块贡献最大？

如果只根据机制和现有证据进行**谨慎推断**：

### 对空间和吞吐量：

**Cover-Min 的贡献更直接。**

因为它用固定的 \(d\) 张 hash table 替代大量 Bloom Filter / 时间片结构。

### 对频率误差 AAE / ARE：

**GSU 很可能是主要贡献者。**

因为论文对 Space-Saving 的主要批评就是：

> 冷元素持续抬升最小频率，造成严重高估。

而 GSU 正是专门解决这个问题。

但是：

> **由于缺少真正模块消融，这个结论是机制层面的推断，而不是论文实验严格证明的结论。**

这是本文实验设计最明显的缺口之一。

---

# 4.5 具体实现细节

对于想复现这篇论文的人，下面这些细节很重要：

### 1. interval 容错

实验默认：

$$
\Delta T=1\text{ ms}
$$

而问题定义中允许：

- 固定 \(\Delta T\)；
- 或按 \(V\) 的比例设定，例如：

$$
\Delta T=0.05V
$$

但主实验主要使用固定 1ms。

---

### 2. Cover-Min 内存比例

作者推荐：

$$
r=15\%
$$

所以大部分内存实际上给了 GSU。

这透露出作者的实际经验判断：

> interval 估计只需“足够准”，而大量空间更应该用于保存候选周期元素。

---

### 3. Cover-Min hash 数

推荐：

$$
d=2
$$

意味着每条流记录只需做少量 hash，非常有利于高速更新。

---

### 4. GSU 的时间复杂度

论文把单次处理视为：

$$
O(1)
$$

但这里隐含了一个工程前提：

> 每个 bucket 的 cell 数 \(\lambda\) 被当作固定小常数。

如果 \(\lambda\) 随数据规模增长，那么“查找 E 是否存在”和“找最小频率 cell”就不能严格视为常数。

对于 Sketch 系统论文，这种固定 associativity 的设计很常见，但阅读时应该意识到该常数来自数据结构配置。

---

### 5. Top-K 查询不是完全免费的

插入可以做到常数复杂度，但最终报告 Top-K 时需要遍历 GSU cells，再选择频率最大的 K 个元素。

因此更准确地说：

> **PeriodicSketch 优化的是高频 update path；query/report path 仍与保存的候选数量相关。**

如果应用要求每个数据包后都实时查询 Top-K，而不是周期性查询，这部分代价值得进一步研究。

---

# 4.6 端到端 Cache Prefetch 实验

论文 **Figure 12–13** 不只是做 Sketch 指标，而是把结果接到真实应用里。

作者把 PeriodicSketch 与：

- LRU；
- LFU；

结合。

如果一个周期项的频率大于 5，则在预测周期到来前进行 prefetch。

---

## 真实数据结果：Figure 12

使用：

- CAIDA2018；
- Criteo；

论文报告在较大范围 cache size 上，加入 PeriodicSketch 后，LFU 或 LRU 的 Cache Hit Ratio 能提升 **10% 以上**。

两组数据中周期项比例分别约为：

$$
45.0\%
$$

和：

$$
96.0\%
$$

这说明一个重要事实：

> 当 workload 本身具有显著周期结构时，周期检测不是“统计指标更漂亮”，而是真能转化成系统收益。

---

## Synthetic 结果：Figure 13

合成数据中：

- 周期项按比例 \(P\%\) 注入；
- 每个周期项 interval 固定；
- 重复 2000 次；
- 其他大多是随机、一次性 item。

在 cache 很小时，传统 LRU/LFU 会发生严重 thrashing。

PeriodicSketch 能提前预取周期项，因此论文观察到最高超过 **100 倍**的 hit-ratio 改善。

---

# 5. 讨论与思考 (Discussion and Reflection)

## 5.1 优点与创新点 (Strengths & Innovations)

### 🌟 1. 最漂亮的创新不是数据结构，而是“问题重写”

我认为这篇论文最值得学习的地方是：

$$
\text{periodicity}
\rightarrow
\text{frequency of }\langle item,interval\rangle
$$

很多研究问题之所以难，是因为沿用了原始问题的表达方式。

作者把“周期检测”拆成：

1. interval estimation；
2. frequent-item detection；

一下子就把问题拉回了 Sketch 最擅长的范式。

这种**representation change** 比单纯设计一个复杂数据结构更值得借鉴。

---

### 🌟 2. Cover-Min 的设计极简，但误差方向可解释

它没有试图精确存每个 item 的 last timestamp，而是接受 hash collision：

> 被覆盖就被覆盖，但用多个副本 + minimum 尽量恢复。

这种设计有三个优点：

- 写入操作非常简单；
- 内存固定；
- 误差具有明确的单向性。

对高性能 streaming system 来说，这种“有偏但可分析”的近似往往比复杂无偏估计更实用。

---

### 🌟 3. GSU 的概率设计与目标高度匹配

GSU 不是随便设置一个：

$$
P=\frac1{f_{\min}}
$$

之类的经验概率。

它特意设计成：

$$
P
=
\frac1{2f_{\min}-t_{\text{fail}}+1}
$$

使得：

- 替换点均匀分布；
- 期望等待长度等于 \(f_{\min}\)；
- 最迟一定替换。

因此“算法行为”和“理论性质”之间连接得比较紧。

---

### 🌟 4. 实验不仅看 Sketch 指标，还给了 Cache 端到端收益

这让论文回答了一个经常被忽略的问题：

> “即使 PR/AAE 很好，对系统到底有什么用？”

Figure 12–13 至少给出了一个完整闭环：

$$
\text{发现周期}
\rightarrow
\text{预测下一次访问}
\rightarrow
\text{prefetch}
\rightarrow
\text{提高 hit ratio}
$$

这使工作更像一个完整系统研究，而不只是“设计了一个新 counter”。

---

## 5.2 局限性与可商榷之处 (Limitations & Debatable Points)

### ⚠️ 1. 本文定义的“周期”其实是“重复 inter-arrival interval”

这是最需要概念澄清的一点。

传统周期性往往还包含：

- phase；
- global regularity；
- harmonic relation；
- missing events；
- multi-period decomposition。

但本文只要某个 interval 频繁出现，就认为 `<e,V>` 是周期元素。

例如一个 item 的 interval 序列：

```text
10, 10, 2, 10, 7, 10, 13, 10, ...
```

只要 10 足够频繁，它就会被认为具有 10 的周期。

这是一种非常适合 streaming 的定义，但它和经典“周期信号”并不完全等价。

所以更准确地说：

> PeriodicSketch 发现的是 **frequent inter-arrival intervals**。

这一点决定了它适合哪些应用，也决定了它不能替代所有 periodicity mining 方法。

---

### ⚠️ 2. 两阶段架构存在误差级联

PeriodicSketch 的流程是：

$$
(e,t)
\rightarrow
\hat V
\rightarrow
\langle e,\hat V\rangle
\rightarrow
\hat f
$$

如果第一步 \(\hat V\) 错了，第二阶段统计的是错误 key。

因此最终误差来自两个来源：

$$
\text{interval error}
+
\text{frequency error}
$$

但论文实验没有非常细致地分解这两个误差源。

例如可以进一步统计：

- 有多少错误来自 Cover-Min interval misclassification？
- 有多少来自 GSU candidate eviction？
- 两者是否存在放大效应？

这是一个很值得补做的实验。

---

### ⚠️ 3. GSU 对 concept drift 的适应速度值得担心

一旦长期运行后：

$$
f_{\min}
$$

变得很大，初始替换概率：

$$
\frac1{2f_{\min}+1}
$$

会变得非常小。

虽然最多 \(2f_{\min}\) 次尝试后必然替换，但如果热点突然切换：

> 新热点可能需要相当长时间才能推翻历史热点。

对于非平稳数据流，这会产生“历史惯性”。

更自然的扩展方向包括：

- sliding window；
- exponential decay；
- aging counter；
- epoch reset；
- change-point aware GSU。

---

### ⚠️ 4. 理论假设与真实流之间存在距离

GSU 最漂亮的长期性质依赖：

- i.i.d.；
- 固定 arrival probability；
- 有限 domain；
- 部分分析基于单 bucket；
- memory bound 还额外考虑 Zipf \(\alpha=1\)。

这些假设对于推导非常合理，但网络流量显然不总满足。

所以理论应该理解为：

> **机制正确性的支撑，而不是对真实网络流量的严格误差承诺。**

---

### ⚠️ 5. 整体内存上界 \(o(N)\) 较松

作者自己也承认整个 PeriodicSketch 的严格内存分析困难，因此给出的：

$$
o(N)
$$

只是一个比较松的上界。

对于 Sketch 来说，我们通常更期待看到：

$$
O\left(
\frac1\epsilon
\log\frac1\delta
\right)
$$

或显式依赖 \(K\)、误差和置信度的界。

本文没有完全做到这一点。

---

### ⚠️ 6. 缺少真正的模块消融

这是实验设计上我最希望补强的一点。

至少应该增加：

- Exact timestamp + GSU；
- Cover-Min + Space-Saving；
- Cover-Min + Unbiased Space-Saving；
- GSU 不同概率函数；
- GSU 不做 frequency compensation；
- 不同 \(\Delta T\) 的鲁棒性。

这样才能真正回答：

> “提升到底来自问题重写、Cover-Min，还是 GSU？”

目前论文主要通过完整系统与一个 baseline 的差异来证明有效性。

---

### ⚠️ 7. Baseline 较单一

作者有合理理由：

> 这是第一个专门处理该问题的 streaming sketch，因此没有完全相同的 prior art。

但从审稿角度仍可以追问：

- 是否能把 Unbiased Space-Saving 接到相同 interval estimator 后做对比？
- 是否能把 exact / sampled last timestamp 与 GSU 组合？
- 是否可以选择一个离线 periodic mining 方法作为 accuracy upper bound？

这些比较会让结论更加有层次。

---

### ⚠️ 8. Cache 实验存在一定“代表性选择”问题

论文脚注明确说明：

- 实际测试了 10 个以上真实数据集；
- 一些数据周期项比例太小，无法明显改善 cache；
- 最终选择了能展示 LFU 或 LRU 改进的代表性数据集。

这并不意味着实验无效，但意味着：

> Cache 收益高度依赖 workload 中周期项的比例。

因此“PeriodicSketch 能提升 cache hit ratio”应该附带条件：

> **workload 必须确实含有足够强的周期结构。**

---

### ⚠️ 9. 论文结论部分存在一个疑似笔误

Section VI-C 的实验数据明确写的是：

- **AAE**：平均降低约 737 倍；
- **ARE**：平均降低约 284 倍。

但论文 Conclusion 中把：

> “up to 2019 times (737 times in average) lower ...”

写成了 **ARE**。

结合 Figure 9、Figure 10 和前文，这里大概率应该是：

> **AAE**

这是阅读时值得标记的内部不一致。

---

# 5.3 未来工作与启发 (Future Work & Inspirations)

## 方向一：让 PeriodicSketch 适应非平稳数据流

最直接的研究问题是：

> **如何让旧周期自然遗忘？**

可以考虑：

$$
f\leftarrow \gamma f,\quad 0<\gamma<1
$$

或 sliding-window counter。

难点在于：

- GSU 的 \(P\) 依赖 \(f_{\min}\)；
- decay 会改变 uniform / guaranteed 性质；
- 原有理论需要重新建立。

这是很有论文潜力的一条线。

---

## 方向二：从单周期 interval 扩展到 richer periodic pattern

目前只统计：

$$
\langle e,V\rangle
$$

可以继续扩展成：

$$
\langle e,V,\phi\rangle
$$

其中 \(\phi\) 表示 phase；

甚至：

$$
\langle e,V_1,V_2,\ldots\rangle
$$

描述复杂重复模式。

问题是复合 key 空间会快速膨胀，因此必须设计新的 compact representation。

---

## 方向三：支持周期变化与 jitter

真实系统可能不是严格：

$$
V,V,V,V
$$

而是：

$$
V+\epsilon_1,\,
V+\epsilon_2,\,
V+\epsilon_3
$$

论文用 \(\Delta T\) 做简单 tolerance，但更进一步可以做：

- interval clustering；
- adaptive binning；
- quantile-aware tolerance；
- learned discretization。

这样可以减少固定 \(\Delta T\) 对数据尺度的敏感性。

---

## 方向四：分布式 / 多交换机 PeriodicSketch

在网络测量中，很自然会遇到：

- 多交换机；
- 多机房；
- edge + core；
- 多分区流。

那么问题会变成：

> 不同节点的 Cover-Min / GSU 状态如何 merge？

如果能设计 mergeable PeriodicSketch，就能进入分布式 telemetry 场景。

---

## 方向五：硬件友好实现

Cover-Min 本身非常适合：

- FPGA；
- SmartNIC；
- programmable switch。

GSU 的挑战主要是：

- bucket 内查重；
- 找 \(f_{\min}\)；
- 随机数；
- 条件替换。

如果能够设计 pipeline-friendly GSU，就很适合线速流量测量。

当前 GitHub 仓库已经能看到 FPGA 和 Tofino 相关目录，这说明这一方向确实具有现实延展性；不过这些内容属于仓库后续状态，不是 ICDE 2022 论文的实验贡献。

---

# 5.4 对研究工作的几个具体启发

### 💡 启发 1：先重写问题，再设计数据结构

本文最值得迁移的方法论是：

> 不要直接问“如何在流中做复杂周期挖掘”，而要问“能否把周期转成另一个成熟 streaming primitive？”

这里的答案是：

$$
\text{periodicity}
\rightarrow
\text{frequency}
$$

你的研究中也可以寻找类似转换：

- anomaly → heavy change；
- persistence → cross-window frequency；
- burst → short-term frequency ratio；
- correlation → pair frequency。

---

### 💡 启发 2：允许有偏估计，但让偏差方向可控

Cover-Min 没有追求无偏，而是接受：

$$
\hat V\le V
$$

换来更简单的数据路径。

系统论文里经常存在这种选择：

> **可解释的一致偏差 > 难分析的复杂无偏估计。**

---

### 💡 启发 3：概率替换的关键不是“随机”，而是“随机规则的性质”

GSU 真正有价值的不是用了 random，而是概率函数经过设计后同时具有：

- uniform success position；
- expected waiting time；
- guaranteed replacement；
- bounded over-estimation。

研究概率型数据结构时，应该尽量问：

> 我的概率函数能否推出一个可解释的统计性质？

而不是只通过 grid search 找一个好用的概率。

---

# 5.5 值得继续追问的几个问题

如果你准备把这篇论文用于组会、related work 或继续做研究，我建议重点思考：

1. **如果数据流突然发生 concept drift，GSU 的历史 \(f_{\min}\) 会让新热点进入得多慢？**
2. **如果同一个 item 同时具有多个近似周期，\(\Delta T\) 会不会导致不同 interval cluster 合并？**
3. **Cover-Min 的 interval 低估是否会产生系统性“短周期偏好”？**
4. **能不能构造一个 adversarial stream，使 GSU 长时间保留错误元素？**
5. **如果把 GSU 替换成 Unbiased Space-Saving，差距究竟有多大？**
6. **如果 Cover-Min 用 exact last timestamp，AAE/ARE 能进一步下降多少？**
7. **能否把 PeriodicSketch 做成 sliding-window / time-decayed 版本，并保留类似 Theorem V.2/V.3 的理论性质？**
8. **周期预测用于 cache 时，prefetch 错误的代价是否应该显式纳入优化目标，而不仅看 hit ratio？**

---

# 总结

PeriodicSketch 是一篇很典型、也很值得学习的 Sketch 系统论文。

它的核心技术逻辑可以压缩成三句话：

> **第一，Cover-Min 用多个被覆盖的 timestamp 副本近似恢复相邻到达间隔。**  
> **第二，把 `<item, interval>` 视为一个新元素，将周期发现问题转化成 frequent-item 问题。**  
> **第三，GSU 用“概率逐步增大、最终保证替换”的机制抑制冷元素污染，同时让真正热点最终进入并稳定留下。**

如果只记住一个创新，我建议记住：

$$
\boxed{
\text{周期检测}
\Rightarrow
\text{interval estimation}
+
\text{heavy-hitter detection}
}
$$

这才是本文最具有迁移价值的研究思想。

---

## 参考信息

- Fan, Z. et al. *PeriodicSketch: Finding Periodic Items in Data Streams*. IEEE ICDE 2022, pp. 96–109.
- DOI: `10.1109/ICDE53745.2022.00012`
- Code: [https://github.com/pkufzc/PeriodicSketch](https://github.com/pkufzc/PeriodicSketch)
