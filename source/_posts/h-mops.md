---
layout: post
title: "《Identifying Hierarchical Super Spreaders in a Data Stream by Hot-Separated and Mergeable Sketch》阅读笔记"
date: "2026-07-06 10:14:32"
updated: "2026-07-15 00:24:12"
permalink: papers/h-mops/
categories: ["论文阅读"]
tags: ["Sketch","基数估计","过滤器","网络安全"]
excerpt: "本文面向地毯式 DDoS、协同扫描等将攻击流量分散到多个 IP 或子网的隐蔽攻击，提出了可同时检测一维和二维层次化超级传播者的 H-MOPS：它通过“热点流与普通流分离”提高基数估计精度，并利用可合并的基数估计器准确计算层次流的条件传播度。"
disableNunjucks: true
comments: false
---

## 📌 论文基本信息

- **论文题目**：*Identifying Hierarchical Super Spreaders in a Data Stream by Hot-Separated and Mergeable Sketch*
- **作者**：Hang Chen、Qingjun Xiao、Liukun He、Yongchao Zhang、Jun Ma，主要来自东南大学网络空间安全学院与紫金山实验室。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)
- **发表时间与会议**：发表于 **IEEE INFOCOM 2026**，论文 DOI 为 `10.1109/INFOCOM59046.2026.11571383`。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)
- **CCF 等级**：**CCF A 类会议**，属于计算机网络领域的重要国际会议。
- **论文链接**：[IEEE DOI 页面](https://doi.org/10.1109/INFOCOM59046.2026.11571383)
- **开源情况**：
  - 论文公开了一个用于补充理论证明的 **Technical Report 仓库**：[H-MOPSReport](https://github.com/hchen404/H-MOPSReport)。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)
  - 但论文正文没有明确给出完整实验代码、参数配置脚本或可复现的数据处理流水线。因此，更准确地说是：**技术报告已公开，但不能确认完整实现代码已经开源**。

---

## 1. 摘要（Abstract）与核心贡献（Core Contribution）

### 一句话总结

本文面向地毯式 DDoS、协同扫描等将攻击流量分散到多个 IP 或子网的隐蔽攻击，提出了可同时检测一维和二维层次化超级传播者的 **H-MOPS**：它通过“热点流与普通流分离”提高基数估计精度，并利用可合并的基数估计器准确计算层次流的条件传播度。

### 贡献列表（Contribution List）

- **首次系统定义二维层次化超级传播者问题**：不仅研究单个源地址或目的地址前缀，还研究“源子网—目的子网”构成的二维层次流，以及基于条件传播度的 HSS 判定标准。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)
- **提出 MOPS 基础 Sketch**：将 top-\(k\) 高传播度流放入独占式预过滤器，将大量普通流放入共享 Sketch；同时使用成对估计器保存“有效信号”和“残留碰撞噪声”，兼顾在线查询、热点分离和跨设备合并。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)
- **提出 H-MOPS 层次结构**：在源、目的 IP 前缀长度构成的二维网格中，每个节点部署一个 MOPS，并通过合并后代 HSS 的虚拟估计器计算集合并集，从而避免二维层次结构中的重复扣除问题。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)
- **在 CAIDA 流量上进行较完整验证**：覆盖普通流传播度估计、超级传播者检测、一维 HSS、二维 HSS、吞吐率和消融实验。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

---

## 2. 引言（Introduction）：问题背景与研究动机

### 2.1 问题定义（Problem Definition）

传统超级传播者检测通常处理如下数据流：

$$
\mathcal{S}
=
\langle f,e\rangle_1,
\langle f,e\rangle_2,
\ldots
$$

其中：

- \(f\) 是流标识，例如目的 IP；
- \(e\) 是元素标识，例如访问该目的 IP 的源 IP；
- 流 \(f\) 的传播度 \(n_f\) 是与其关联的不同元素数量。

例如，一个目的 IP 在较短时间内被大量不同源 IP 访问，可能意味着 DDoS 攻击；一个源 IP 访问大量不同目的地址，则可能意味着扫描行为。论文对这一模型的正式描述见公式（1）。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

问题在于，现代攻击者不会总把流量集中到某个单独 IP。地毯式 DDoS 会把流量分散到同一个子网中的大量主机，使每个主机的传播度都低于检测阈值，但整个子网的聚合传播度非常高。论文图 1 展示了单点 DDoS 与子网级地毯式攻击、协同端口扫描之间的区别。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

因此，本文研究的不再只是某个完全指定 IP 的传播度，而是：

> 对不同前缀长度下的源子网、目的子网以及源—目的子网对，估计其不同元素数量，并判断哪些层次流具有足够大的“新增传播度”。

这里的“新增”非常重要。一个上层子网传播度很高，可能只是因为它包含了一个已经被发现的下层超级传播者。因此，论文使用的是 **条件传播度（conditional spread）**，而不是简单的聚合传播度。

### 2.2 一维与二维层次流

在一维情况下，对某个 IP 逐渐缩短前缀：

$$
1.2.3.4
\rightarrow
1.2.3.*
\rightarrow
1.2.*.*
\rightarrow
1.*.*.*
\rightarrow
*.*.*.*
$$

就可以形成从具体主机到大子网的层次结构。

二维情况下，流键由源、目的地址共同构成：

$$
f=(src,dst)
$$

然后分别对两个字段做掩码：

$$
f_{i,j}
=
(src\ \&\ mask_i,\ dst\ \&\ mask_j)
$$

其中 \(i\) 和 \(j\) 分别表示源地址、目的地址的泛化级别。这样得到的结构不再是一棵树，而是论文图 2 所示的二维格（lattice）。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

它可以表达很多一维模型无法描述的事件，例如：

- 某个大源子网集中访问某个具体服务器；
- 某个攻击源访问整个目标子网；
- 一个源子网与一个目的子网之间存在大规模异常连接；
- 多个攻击者协同扫描一组目标网段。

### 2.3 现有方法的局限（Limitations of Prior Work）

#### 局限一：传统 per-flow Sketch 不感知层次结构

VB、vHLL、On-vHLL 等方法可以估计每个完全指定流的传播度，但无法直接回答“某个目的子网被多少不同实体访问”。即使把每个前缀都作为独立流更新，也仍然需要解决条件传播度和后代重复计数问题。

#### 局限二：已有 HSS 方法主要局限于一维

HVE 和 LocalSketch 支持一维前缀范围的传播度估计，但不支持源、目的地址同时泛化的二维 HSS。Hon-vHLL 可以扩展到二维，但没有热点流与普通流的隔离机制，在流量高度倾斜时，大流与大量小流共享寄存器，碰撞误差较明显。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

#### 局限三：二维条件传播度存在重复扣除

考虑论文图 3：

- 父节点传播度为 180；
- 两个后代 HSS 的传播度分别为 160 和 110；
- 两个后代之间有传播度为 90 的重叠区域。

若直接计算：

$$
180-160-110=-90
$$

显然不正确。使用容斥原理则为：

$$
180-160-110+90=0
$$

但容斥法需要额外查询重叠区域的传播度。随着后代数量增加，查询数量和误差都会快速累积。更麻烦的是，同一个元素可能出现在两个几何上不重叠的流区域中，此时仅根据 IP 区域计算交集仍无法完全消除重复。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

### 2.4 本文思路（Overall Idea）

作者的总体方案可以概括为两层：

1. **先设计一个准确且可合并的普通流传播度 Sketch：MOPS。**
2. **再在每个层次网格节点放置一个 MOPS，得到 H-MOPS。**

MOPS 负责回答：

> 某个确定层次级别下，流 \(f\) 的传播度是多少？它的估计器状态是什么？

H-MOPS 则负责回答：

> 这个层次流在扣除已经发现的后代 HSS 后，还剩下多少独立传播度？

其关键不是分别估计各种交集，而是把所有后代 HSS 的基数估计器直接合并。由于 HLL 类估计器的合并对应集合并集，重复元素会在合并过程中自动去重。

---

## 3. 方法论深度解析（In-depth Methodological Analysis）

## 3.1 整体架构（Overall Architecture）

H-MOPS 的整体流程如论文图 5 所示，可以分为在线更新和离线识别两个阶段。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

### 阶段一：在线更新

对每个到达的数据项：

$$
\langle f,e\rangle
=
\langle (s,d),e\rangle
$$

执行以下步骤：

1. 从数据包中解析源地址 \(s\)、目的地址 \(d\) 和元素 \(e\)；
2. 对源、目的地址分别应用不同长度的前缀掩码；
3. 构造全部层次流：

$$
f_{i,j}=(s_i,d_j)
$$

4. 将 \(\langle f_{i,j},e\rangle\) 更新到二维格节点 \(L_{i,j}\) 中的 MOPS；
5. 若在线估计值满足：

$$
\hat n_{f_{i,j}}\geq \phi
$$

则把该层次流加入候选集合 \(C_{i,j}\)。

Algorithm 4 明确显示，每个输入元素需要遍历所有 \((i,j)\) 网格节点。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

### 阶段二：自底向上识别 HSS

仅凭：

$$
\hat n_{f_{i,j}}\geq \phi
$$

不能直接判断其为 HSS，因为该传播度可能全部来自已经被识别的后代。

因此，H-MOPS 从最具体的节点 \((0,0)\) 开始，沿二维格逐层向上处理。对于每个候选流：

1. 找到被它覆盖的后代 HSS；
2. 查询这些后代 HSS 的 MOPS 估计器矩阵；
3. 将所有估计器按 HLL 合并规则合并；
4. 估计后代元素集合的并集传播度；
5. 从当前流的无条件传播度中减去该并集；
6. 只有剩余的条件传播度仍超过阈值，才将其标记为 HSS。

### 架构的核心思想

宏观上，H-MOPS 将两个原本耦合的问题分开：

- **基数估计误差问题**：由 MOPS 的热点分离和差分估计解决；
- **层次关系中的重复计算问题**：由估计器合并解决。

相比直接在层次结构上设计复杂容斥规则，这种设计更模块化：底层 MOPS 只需要提供“查询估计器”和“合并估计器”两个能力，上层 H-MOPS 即可完成条件传播度计算。

---

## 3.2 核心组件/模块拆解（Core Component Breakdown）

### 3.2.1 成对估计器的 Per-flow Sketch

论文图 4 右侧是共享的 per-flow Sketch：

$$
M\in \mathbb{E}^{d\times w\times 2}
$$

其中：

- \(d\)：行数；
- \(w\)：每行桶数；
- 每个桶包含两个 HLL-TC 估计器，分别记为偶估计器和奇估计器。

#### 输入和输出

**输入：**

$$
\langle \tilde f,e\rangle
$$

其中 \(\tilde f\) 是流的短指纹，\(e\) 是元素。

**输出：**

- 流的传播度估计 \(\hat n_f\)；
- 与该流对应的 \(d\times 2\) 估计器矩阵 \(E_f\)。

#### 内部机理

对于第 \(r\) 行，首先计算：

$$
c=h_r(\tilde f)\bmod w
$$

确定桶的位置，再计算：

$$
z=z_r(\tilde f)\bmod 2
$$

确定该流应更新桶中的哪一个估计器。

因此，对于目标流 \(f\)：

- 自己的元素始终进入 \(M[r][c][z]\)；
- 其他碰撞流根据自己的 \(z_r\) 值，随机进入两个估计器之一。

查询时，取两者估计值之差：

$$
\hat n_f^{(r)}
=
Q\left(M[r][c][z]\right)
-
Q\left(M[r][c][1-z]\right)
$$

其他流造成的噪声在两个估计器之间近似对称，因此期望上相互抵消；而目标流自身只进入第一个估计器，因此得以保留。最后对 \(d\) 行结果取中位数，降低异常哈希碰撞的影响。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

#### 直观理解

可以把一个桶中的两个估计器看作实验组和对照组：

- 实验组：目标流元素 + 一部分背景噪声；
- 对照组：另一部分背景噪声。

若背景噪声被近似均匀地分到两边，那么：

$$
(\text{目标信号}+\text{噪声}_1)-\text{噪声}_2
\approx
\text{目标信号}
$$

这与 CountSketch 使用正负符号抵消噪声的思想类似，只不过这里被估计的是不同元素基数，而不是线性频率。

#### 设计动机

普通 vHLL 或 On-vHLL 让所有流共享寄存器。由于网络流传播度通常呈幂律分布，大流会严重污染小流，小流数量又会共同污染大流的虚拟估计器。

MOPS 的成对估计器不是完全消除碰撞，而是给出了一个可估计、可抵消、并且可以随 Sketch 一起合并的噪声表示。

---

### 3.2.2 Top-\(k\) 预过滤器：热点分离但不破坏可合并性

MOPS 的第二部分是图 4 左侧的预过滤器，由两部分组成：

- 保存 top-\(k\) 流及其传播度的最小堆；
- 大小为 \(d\times k\) 的独占估计器矩阵 \(P\)。

每个 top-\(k\) 流拥有一列独占空间，但每个桶仍然包含一对估计器。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

#### 输入和输出

**输入：**

- 当前流指纹；
- 当前元素；
- 共享 Sketch 中该流已有的估计器状态。

**输出：**

- 该热点流的专用估计器；
- 更新后的 top-\(k\) 排名；
- 可用于跨 Sketch 合并的完整估计器对。

#### 内部机理

当一个普通流的估计值超过预过滤器中的最小值时，它被换入预过滤器。

此时不能简单地创建一个全新的空 HLL，因为：

- 该流之前的元素已经写入共享 Sketch；
- 若丢弃旧状态，会低估其传播度。

也不能只复制“主估计器”，因为主估计器中包含流自身和历史碰撞噪声。

MOPS 的做法是把一对估计器都复制进去：

$$
(E_f^{primary},E_f^{alternative})
$$

之后：

- 该流的新元素只更新 primary；
- alternative 保留流被换入时的残留噪声；
- 查询仍通过两者之差进行校正。

这比记录一个“噪声基数标量”更重要。标量可以做单点减法，却不能在多个监测点合并时对重复噪声去重；HLL 估计器则可以执行集合级合并。论文正是基于这一点，实现了热点分离与 Sketch 可合并性的兼容。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

#### 换出操作

当热点流跌出 top-\(k\) 时，其 primary 估计器被重新合并回共享 Sketch，使后续查询仍能看到该流的历史元素。

这个 swap-in / swap-out 机制让预过滤器不是一个独立、不可逆的缓存，而是共享 Sketch 的高精度前端。

#### 设计动机

此前的热点分离基数 Sketch 通常面临两难：

- 彻底把热点流移出共享 Sketch：难以保留和合并历史噪声；
- 始终让热点流留在共享 Sketch：无法真正隔离后续碰撞。

MOPS 的关键创新不是单纯使用 top-\(k\) 表，而是：

> 将“残留噪声”也保存成一个可合并的概率估计器，而不是保存成不可合并的数值。

---

### 3.2.3 二维层次格与条件传播度模块

H-MOPS 建立一个二维格：

$$
\mathcal{L}
=
\{L_{i,j}\mid 0\leq i,j\leq H\}
$$

每个节点对应一个特定的源、目的前缀长度组合，并维护：

- 一个 MOPS；
- 一个候选 HSS 集合 \(C_{i,j}\)；
- 最终识别出的 HSS 集合 \(H_{i,j}\)。

#### 输入和输出

**输入：**

- 当前候选流 \(f_{i,j}\)；
- 当前流的无条件传播度估计；
- 已识别的后代 HSS 集合。

**输出：**

- 后代 HSS 元素并集的估计器；
- 当前流的条件传播度；
- 是否将当前流加入 \(H_{i,j}\)。

#### 内部机理

设当前流覆盖的后代 HSS 集合为：

$$
desP
=
\{p\mid p\in H_{i-1,j}\cup H_{i,j-1},\ p\preceq f_{i,j}\}
$$

H-MOPS 查询每个后代 \(p\) 对应的估计器矩阵 \(E_p\)，然后逐寄存器执行：

$$
E_{desP}
=
\bigvee_{p\in desP}E_p
$$

这里的 \(\bigvee\) 表示 HLL 合并，通常是对应寄存器取最大值。

由于相同元素在不同估计器中产生相同的哈希轨迹，合并后只保留一次，因此：

$$
Q(E_{desP})
\approx
\left|
\bigcup_{p\in desP}\mathcal{E}_p
\right|
$$

最后从父流传播度中减去后代并集：

$$
\hat n^{cond}_{f_{i,j}}
=
\hat n_{f_{i,j}}
-
Q(E_{desP})
$$

Algorithm 5 的第 13—18 行完整描述了这一过程。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

#### 为什么不使用容斥原理？

两个集合时，容斥只有三项：

$$
|A\cup B|=|A|+|B|-|A\cap B|
$$

但有 \(q\) 个后代时，完整容斥最多涉及：

$$
2^q-1
$$

个集合项。即使只计算部分交集，每一项都是一个带误差的 Sketch 查询，误差可能在正负相加中被放大。

合并方法只需要不断执行寄存器级 merge：

$$
E\leftarrow E\vee E_p
$$

它的计算量随后代数量线性增长，而且直接对应集合并集的语义。

---

## 3.3 关键公式与算法（Key Equations and Algorithms）

### 公式一：MOPS 的差分传播度估计

$$
\hat n_f^{(r)}
=
Q(E_f[r][0])-Q(E_f[r][1])
$$

$$
\hat n_f
=
\operatorname{median}_{0\leq r<d}
\left\{
\hat n_f^{(r)}
\right\}
$$

#### 符号含义

- \(E_f[r][0]\)：第 \(r\) 行中包含流 \(f\) 信号的主估计器；
- \(E_f[r][1]\)：用于刻画碰撞噪声的替代估计器；
- \(Q(\cdot)\)：HLL-TC 基数查询函数；
- \(d\)：哈希行数；
- \(\hat n_f^{(r)}\)：单行估计值；
- \(\hat n_f\)：多行中位数估计。

#### 公式目标

去除共享存储带来的背景流碰撞噪声，同时保留目标流的独立元素数量。

#### 公式直觉

假设单行主、替代估计器分别包含：

$$
E_0=f\cup N_0,\qquad E_1=N_1
$$

并且其他流随机分配到两个估计器，因此：

$$
\mathbb{E}[|N_0|]\approx\mathbb{E}[|N_1|]
$$

那么：

$$
\mathbb{E}[Q(E_0)-Q(E_1)]
\approx n_f
$$

论文给出了渐近无偏性：

$$
\mathbb{E}[\hat n_f]
=
n_f+o(n_f)
\approx n_f
$$

并给出标准差上界：

$$
\operatorname{StdDev}(\hat n_f)
\leq
\left(
n_f+\frac{n}{2w}
\right)
\sqrt{\frac{\pi}{2d}}
\frac{\gamma_m}{\sqrt m}
$$

其中：

- \(n\) 是全局不同元素量；
- \(w\) 控制桶碰撞概率 \(1/(2w)\)；
- \(d\) 是独立行数；
- \(m\) 是单个 HLL 的寄存器数；
- \(\gamma_m\) 是 HLL 误差常数。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf) (Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

该上界清楚地说明：

- 增大 \(w\) 可以降低跨流碰撞；
- 增大 \(d\) 可以提高中位数估计的稳定性；
- 增大 \(m\) 可以降低单个 HLL 的基数估计误差。

---

### 公式二：层次流的条件传播度

论文对条件传播度的集合定义可以理解为：

$$
n_{f_{i,j}\mid H}
=
\left|
\left\{
e:
e\in\mathcal E(f_{i,j}),
\ e\notin
\bigcup_{p\in H,\ p\preceq f_{i,j}}
\mathcal E(p)
\right\}
\right|
$$

其中 \(H=H_{i-1,j}\cup H_{i,j-1}\)。

实际估计时使用：

$$
\hat n_{f_{i,j}\mid H}
=
\hat n_{f_{i,j}}
-
\hat n_{\bigcup_{p\in H,\ p\preceq f_{i,j}}p}
$$

#### 公式目标

衡量当前层次流中，不能被已发现后代 HSS 解释的“额外异常传播度”。

#### 各部分含义

- \(\hat n_{f_{i,j}}\)：当前层次流的总传播度；
- \(p\preceq f_{i,j}\)：后代流 \(p\) 被当前流覆盖；
- \(\bigcup \mathcal E(p)\)：所有相关后代 HSS 的元素并集；
- 第二项通过合并后代 MOPS 估计器得到，而不是把各传播度直接相加。

#### 公式直觉

条件传播度回答的不是：

> 这个子网总体上大不大？

而是：

> 在扣除已经发现的具体攻击流之后，这个更粗粒度子网是否仍然呈现独立的异常？

论文图 3 中，父节点原始传播度为 180，但它的全部元素都可以被两个后代 HSS 的并集解释，因此条件传播度为 0，不应再次报警。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

---

## 4. 实验设计与结果分析（Experimental Design and Results Analysis）

### 4.1 实验设置（Experimental Setup）

#### 数据集

论文使用 **CAIDA 2017 匿名互联网流量轨迹**。

- 一维流：对一个 IP 字段使用不同前缀掩码；
- 二维流：同时对源、目的 IP 使用不同掩码；
- 元素定义为五元组；
- 根据精确统计结果构造传播度和 HSS ground truth。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

#### 对比方法

**普通流传播度估计：**

- On-vHLL
- Ton-vHLL
- AROMA+
- MOPS

**普通超级传播者检测：**

- AROMA
- SpreadSketch
- GMF
- EASSI
- MOPS

**一维 HSS：**

- HVE
- H-On-vHLL
- H-Ton-vHLL
- H-MOPS

**二维 HSS：**

- H-On-vHLL
- H-Ton-vHLL
- H-MOPS-IE
- H-MOPS

HVE 不支持二维结构，因此没有进入二维实验。所有方法在相同内存预算下比较。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

#### 评价指标

传播度估计采用相对 Bias 和 RMSE：

$$
Bias=
\frac{1}{T}
\sum_{t=1}^{T}
\frac{\hat X_t-X_t}{X_t}
$$

$$
RMSE=
\sqrt{
\frac{1}{T}
\sum_{t=1}^{T}
\left(
\frac{\hat X_t-X_t}{X_t}
\right)^2
}
$$

检测任务采用：

$$
F_1=
\frac{2TP}{2TP+FP+FN}
$$

(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

---

### 4.2 主实验结果（Main Results）

#### 普通流传播度：图 6

图 6a 显示，MOPS 在不同真实传播度范围内的 Bias 基本围绕 0 波动，与论文的渐近无偏性分析一致。

图 6b 中，MOPS 的 RMSE 整体最低。这里更重要的不是“MOPS 比基线好”，而是：

> 在其他算法同样近似无偏的情况下，MOPS 主要降低的是估计方差，而非简单修正系统偏差。

这与方法论高度吻合：成对估计器负责抵消期望噪声，预过滤器则隔离高传播度流，减少大流与背景流之间的碰撞方差。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

#### 吞吐率：表 I

| 方法     | 更新吞吐率 |  查询吞吐率 |
| -------- | ---------: | ----------: |
| MOPS     |   7.4 MPPS |    5.6 MPPS |
| Ton-vHLL |   9.0 MPPS |    5.9 MPPS |
| On-vHLL  |   9.1 MPPS |    6.1 MPPS |
| AROMA    |  10.0 MPPS | 0.0002 MPPS |
| AROMA+   |   9.1 MPPS |    2.8 MPPS |

(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

MOPS 的更新速度比 On-vHLL 低约 19%，原因是其需要更多内存访问和哈希操作。但其查询吞吐率与 On-vHLL 很接近，并明显高于 AROMA+。

因此，MOPS 的性能定位不是“最快”，而是：

> 用适度的更新开销换取明显更高的传播度估计和超级传播者检测精度，同时保持百万包每秒级别的在线能力。

不过，表中的吞吐率只对应单个 MOPS。H-MOPS 会对一个包更新多个层次节点，实际端到端吞吐率不能直接等同于 7.4 MPPS。

#### 超级传播者检测：图 7

图 7a 显示：

- \(k=0\)，即关闭预过滤器时，F1 明显下降；
- 适当增加 \(k\) 可以提升精度；
- 但 \(k=1024\) 时性能又有所下降，因为固定内存下预过滤器占用过多空间，导致后端 Sketch 宽度 \(w\) 变小。

这说明热点分离不是越强越好，而是存在资源分配平衡：

$$
\text{热点独占内存}
\quad\leftrightarrow\quad
\text{普通流共享容量}
$$

图 7b、7c 中，MOPS 在不同阈值和内存条件下总体保持最高 F1；当内存为 1 MiB、阈值为 400 时，F1 仍高于 0.96。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

---

### 4.3 层次流结果与消融实验（Ablation Studies）

#### 层次传播度估计：图 8

在相同 1 MiB 内存下，H-MOPS 在一维和二维层次流上均取得最低 RMSE，尤其是在低、中等传播度流上优势明显。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

这一结果很关键，因为 HSS 判定发生在阈值附近。对于远高于阈值的大流，估计误差通常不会改变分类结果；真正影响 FP 和 FN 的，往往是处于阈值附近的中等流。

#### 一维 HSS：图 9

H-MOPS 在不同阈值和不同内存预算下总体优于 HVE、H-On-vHLL 和 H-Ton-vHLL。关闭预过滤器后，F1 明显下降，说明热点分离在层次场景中仍然是主要精度来源。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

#### 二维 HSS：图 10

H-MOPS 在二维实验中继续取得最优结果。更有意义的是，论文增加了一个变体：

- **H-MOPS-IE**：用容斥原理计算条件传播度；
- **H-MOPS**：合并后代估计器计算并集。

H-MOPS 略优于 H-MOPS-IE，说明估计器合并确实减少了重叠区域查询所引入的误差。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

但需要客观看待这个结果：

> 从图 10 的视觉差距看，合并相对容斥的提升是稳定但较小的；相比之下，关闭预过滤器造成的性能下降更明显。

因此，从实验贡献大小看：

1. **热点分离是主要精度增益来源；**
2. **可合并条件传播度是方法成立的结构性关键，但其相对容斥法的增量 F1 提升没有宣传得那么巨大。**

---

### 4.4 具体实现细节

MOPS 的底层基数估计器采用 HLL-TC，支持在线 Update、Query 和寄存器级 Merge。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

主要参数包括：

- \(d\)：独立哈希行数；
- \(w\)：共享 Sketch 每行桶数；
- \(k\)：预过滤器容量；
- \(m\)：每个 HLL-TC 的寄存器规模；
- \(H\)：层次最大泛化级别；
- \(B\)：每次掩码增加的比特数；
- \(\phi\)：HSS 检测阈值。

### 时间复杂度

对于一个 MOPS：

$$
T_{\text{update}}=O(d),\qquad
T_{\text{query}}=O(d)
$$

对于二维 H-MOPS，每个输入需要更新全部节点：

$$
T_{\text{H-MOPS update}}
=
O\left((H+1)^2d\right)
$$

一维版本则为：

$$
O((H+1)d)
$$

离线 HSS 查询还取决于候选流数和每个候选覆盖的后代 HSS 数量。设候选数为 \(|C|\)，平均后代数量为 \(q\)，则其主要开销近似为：

$$
O(|C|qd)
$$

### 空间复杂度

一个 MOPS 需要：

$$
O(dw+dk)
$$

个成对基数估计器。

二维 H-MOPS 总空间近似为：

$$
O\left((H+1)^2d(w+k)\right)
$$

这意味着层次粒度是一个非常重要的工程参数。论文图 2 主要使用字节级前缀层次；若直接对 IPv4 做逐比特层次化，\((32+1)^2=1089\) 个网格节点会带来很大的更新和内存放大。

---

## 5. 讨论与思考（Discussion and Reflection）

### 5.1 优点与创新点（Strengths & Innovations）

#### 1. 问题定义具有现实针对性

本文并非简单地把已有超级传播者检测换成另一个 Sketch，而是抓住了现代攻击的一个真实规避策略：**攻击目标从单 IP 变为子网或子网对**。

条件传播度定义也很合理。它避免了同一异常在多个前缀层次重复报警，使输出更接近一个非冗余的层次化异常摘要。

#### 2. “热点分离 + 可合并性”的结合很巧妙

预过滤器本身并不新，HLL 合并也不新。真正巧妙的是作者意识到：

> 破坏可合并性的并不是热点表，而是热点流进入表之前已经积累的残留碰撞噪声。

用第二个 HLL 估计器保存噪声状态，使噪声也拥有集合语义和合并能力。这是 MOPS 最具辨识度的设计。

#### 3. 用集合并集代替容斥，语义更干净

容斥法把问题转化为大量数值相加减；H-MOPS 则直接恢复后代元素集合的概率表示，再估计并集。后者更贴近问题本身，也能够处理同一元素跨越不同后代流出现的情况。

#### 4. 实验链条较完整

论文没有只报告最终 HSS F1，而是依次验证：

1. 普通流估计是否无偏；
2. 估计方差是否降低；
3. 吞吐率是否可接受；
4. 普通 SS 检测是否改善；
5. 一维、二维 HSS 是否改善；
6. 热点分离是否必要；
7. 合并是否优于容斥。

整体遵循“底层估计器—基础检测—层次检测”的验证逻辑。

---

### 5.2 局限性与可商榷之处（Limitations & Debatable Points）

#### 1. 二维更新放大可能是实际部署的主要瓶颈

论文强调面向 DPDK、DPU 等线速平台，但实验只报告了单个 MOPS 的吞吐率，没有直接报告完整 H-MOPS 的端到端包处理速度。

每个包需要更新全部层次组合：

$$
(H+1)^2
$$

即使是 5 个字节级层次，也需要更新 25 个 MOPS。若单 MOPS 为 7.4 MPPS，不能据此推断完整 H-MOPS 仍有同等级吞吐率。

因此，论文的“在线”更多意味着算法支持流式更新，而不等价于已证明可在高速链路上完成完整二维更新。

#### 2. HSS 识别仍是离线过程

论文采用“在线更新、离线 HSS identification”：

- 在线阶段只生成候选；
- 条件传播度需要自底向上遍历候选和后代集合。

这意味着系统不能在每个包到达时立即输出严格意义上的条件 HSS。对秒级告警场景，可以按时间窗离线查询；但对亚秒级响应，候选规模和查询成本可能成为问题。

#### 3. 实验验证的是测量精度，而不是完整攻击检测能力

论文从 CAIDA 流量中构造高传播度层次流作为 ground truth，并将其解释为可能的地毯式 DDoS 目标。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

但“高传播度”不必然等于恶意攻击，例如：

- CDN 或 DNS 服务；
- 大型公共服务器；
- NAT 后的大规模合法访问；
- Flash crowd；
- 扫描测量平台。

因此，实验能够证明 H-MOPS 更准确地找到了高条件传播度流，却不能独立证明它具有更高的真实 DDoS 检测率。工程系统仍需要结合包速率、字节数、协议特征和历史基线。

#### 4. 元素语义存在值得澄清的细节

公式（2）把层次流传播度定义为不同元素 \(e\) 的数量，但公式（3）又把它写成所有完全指定子流传播度之和。(Identifying_Hierarchical_Super_Spreaders_in_a_Data_Stream_by_Hot-Separated_and_Mergeable_Sketch.pdf)

只有在不同完全指定流之间的元素集合互
