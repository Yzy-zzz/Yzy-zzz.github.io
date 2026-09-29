---
layout: post
title: "ZRing 论文分析报告"
date: "2026-04-22 17:26:04"
updated: "2026-04-22 17:26:04"
permalink: papers/zring/
categories: ["论文阅读"]
tags: ["Sketch","基数估计","网络安全"]
excerpt: "加权基数估计 (Weighted Cardinality Estimation, WCE)：估计数据流中不同元素的总权重。"
disableNunjucks: true
comments: false
---

## 基本信息

| 项目 | 内容 |
|------|------|
| **标题** | ZRing: A Dynamic Sketch for Weighted Cardinality Estimation in Data Streams |
| **会议** | KDD 2026 (ACM SIGKDD) |
| **DOI** | 10.1145/3770854.3780289 |
| **作者** | Zhicheng Li, Pinghui Wang (通讯作者), Qiheng Song, Rundong Li (西安交通大学); Tong Yang, Qun Huang (北京大学) |
| **代码** | https://doi.org/10.5281/zenodo.18059621 |
| **页数** | 12 页 |

---

## 一、研究背景与动机

### 1.1 问题定义

**加权基数估计 (Weighted Cardinality Estimation, WCE)**：估计数据流中不同元素的总权重。

形式化定义：给定全动态数据流（支持插入和删除），每个元素 $e_i$ 关联固定正权重 $w_i > 0$，目标是估计：

$$C(t) = \sum_{e_i \in E(t)} w_i$$

其中 $E(t)$ 是时刻 $t$ 至少有一个活跃实例的元素集合。

### 1.2 应用场景

| 场景 | 描述 |
|------|------|
| **数据库查询优化** | 估算 `SELECT SUM(DISTINCT column)` 类查询的结果，优化执行计划 |
| **网络流量监控** | 跨多个监测点估计唯一流的总带宽，避免重复计算 |
| **区块链日志分析** | 估计智能合约事件（如转账）的净交易量，处理回滚和取消 |

### 1.3 现有方法的局限

| 方法 | 局限 |
|------|------|
| **FM Sketch / HyperLogLog** | 仅支持无权基数估计 |
| **Lemiesz (2021) / FastGM** | 仅支持插入流 (cash-register model) |
| **QSketch (2024)** | 当前最优 WCE 方法，但删除支持差，需要额外计数器 |

**核心挑战**：现有 WCE 方法无法有效处理**完全动态流**（同时包含插入和删除），而实际系统中删除操作普遍存在（事务回滚、连接终止、区块重组等）。

---

## 二、核心贡献

### 2.1 ZRing Sketch 结构

**设计思想**：使用基于环的模运算实现可逆更新，无需显式计数器。

**数据结构**：
- $m$ 行 × $b$ 列的矩阵，每个元素取值范围 $\{0, 1, \ldots, Z-1\}$
- 总内存：$m \times b \times \log Z$ 比特

**更新规则**（公式 5）：
$$R[g(e)][y(e,w)] \leftarrow (R[g(e)][y(e,w)] + \sigma \cdot f(e, r)) \mod Z$$

其中：
- $g: X \to \{0,\ldots,m-1\}$ 选择行
- $h: X \to (0,1)$ 生成指数分布随机数
- $y(e,w) = \lfloor -\log_2(-\ln h(e) / w) \rfloor$ 量化层级
- $f: X \times \mathbb{R} \to \{0,\ldots,Z-1\}$ 均匀随机扰动
- $\sigma \in \{+1, -1\}$ 表示插入/删除

**关键性质**：
1. **可逆性**：插入和删除互为逆操作
2. **幂等性**：同一元素的多次更新只影响一个位置
3. **均匀性保持**：模 $Z$ 环上均匀分布的和仍为均匀分布
4. **可合并性**（公式 6）：
   $$R^*[i][j] = \left(\sum_{k=1}^l R^{(k)}[i][j]\right) \mod Z$$

### 2.2 两种估计器

#### (1) MLP 估计器（学习式）

**动机**：传统 MLE 方法存在信息瓶颈和均匀性假设问题。

**特征工程**：
- 列占用率向量：$r_j = \frac{1}{m}\sum_{i=0}^{m-1} \mathbb{I}(R[i][j] \neq 0)$
- 辅助特征：$\log(m)$, $\log(Z)$

**网络结构**：
- 输入层：$N_x = 8N_i$（$N_i=b$ 为列数）
- 特征提取块：5 层全连接，每层宽度 $8N_i$
- 压缩块：3 层全连接，每层宽度减至 1/4
- 激活函数：LeakyReLU
- 输出：$\log(C)$（预测对数值）

**训练策略**：
- 损失函数：MSE on $\log(C)$
- 数据增强：合并多个 sketch 扩展标签范围
- 多分布训练：Uniform, Gaussian, Gamma, Zipf

#### (2) 动态 Martingale 估计器（DME）

**理论基础**：Sketch 状态演化满足马尔可夫性（定理 1）。

**估计更新**（公式 9）：
$$\hat{C}_{DME}^{(t+1)} = \hat{C}_{DME}^{(t)} + \frac{\sigma^{(t)} w^{(t)}}{q(S^{(t)}, e^{(t)}, \sigma^{(t)})} \cdot \mathbb{I}(S^{(t+1)} \neq S^{(t)})$$

**核心创新**：对称化处理删除操作
$$q(S^{(t)}, e^{(t)}, -1) := q(S^{(t)}, e^{(t)}, +1)$$

**理论保证**：
- **定理 2**：$\hat{C}_{DME}^{(t)}$ 是 $C(t)$ 的无偏估计
- **定理 3**：方差为 $\text{Var}(\hat{C}_{DME}^{(T)}) = \sum_{t=1}^T (w^{(t)})^2 \frac{1-q_V^{(t)}}{q_V^{(t)}}$

### 2.3 复杂度分析

| 操作 | ZRing-MLP | ZRing-DME |
|------|-----------|-----------|
| **更新时间** | $O(1)$ | $O(1)$ |
| **估计时间** | $O(mb)$ | $O(b)$ |
| **空间** | $mb\log Z$ bits | $mb\log Z + b\log m$ bits |

---

## 三、实验评估

### 3.1 实验设置

**数据集**：
- **合成数据**：Uniform, Gaussian, Gamma, Zipf 分布（10K~100M 元素）
- **真实数据**：TPC-H（数据库）, CAIDA（网络流量）, XBlock-ETH（区块链）

**基线方法**：
- QSketch（原始 MLE 估计器）
- QSketch-DME（扩展支持删除）
- Lemiesz / FastGM（仅插入流，参考上界）

**评估指标**：
- **AARE**：平均绝对相对误差 $\frac{1}{N}\sum|\hat{C}-C|/C$
- **RRMSE**：相对均方根误差
- **吞吐量**：Mops（百万操作/秒）

### 3.2 主要结果

#### 精度对比（固定 16KB 内存）

| 数据集 | ZRing-MLP vs QSketch | ZRing-DME vs QSketch |
|--------|---------------------|---------------------|
| **10M 数据** | RRMSE ↓5.86 倍 | RRMSE ↓10.71 倍 |
| **CAIDA-1B** | ARE 中位数降低约 1 个数量级 | 略低于 MLP |

**关键发现**：
- ZRing 方法在低内存下优势更明显
- 删除比例变化（0%~80%）对精度影响小
- $Z=8$ 为最优参数设置

#### 效率对比

| 指标 | ZRing-MLP | ZRing-DME | QSketch | QSketch-DME |
|------|-----------|-----------|---------|-------------|
| **更新吞吐量** | ~100 Mops | ~100 Mops | ~85 Mops | ~130 Mops |
| **估计延迟** | ~100 μs | ~10 μs | ~30 μs | ~3 μs |

**分析**：
- ZRing 更新更快（内存访问更少）
- MLP 估计有神经网络推理开销
- DME 估计比 QSketch-DME 慢（概率计数器触发更频繁）

### 3.3 分布式场景验证

**实验**：TPC-H 数据分给 2 个所有者，元素重叠率 0%~20%

| 重叠率 | ZRing-DME (AARE) | ZRing-MLP (AARE) |
|--------|-----------------|-----------------|
| 0% | 0.0372 | 0.0713 |
| 10% | 0.1361 | 0.0608 |
| 20% | 0.2504 | 0.0621 |

**结论**：
- DME 要求元素不重叠（否则重复计数）
- MLP 先合并 sketch 再估计，对任意重叠鲁棒

---

## 四、方法对比

| 特性 | QSketch | Lemiesz | FastGM | **ZRing** |
|------|---------|---------|--------|-----------|
| **支持删除** | ✗ (需扩展) | ✗ | ✗ | ✓ |
| **更新复杂度** | $O(1)$ | $O(m)$ | $O(m)$ | $O(1)$ |
| **可合并** | ✓ | ✓ | ✓ | ✓ |
| **理论保证** | MLE | 无偏 | 加速 | 无偏 (DME) |
| **学习增强** | ✗ | ✗ | ✗ | ✓ (MLP) |

---

## 五、优点与局限

### 5.1 优点

1. **首个支持完全动态流的 WCE Sketch**：原生支持删除，无需额外计数器
2. **双重估计器设计**：
   - MLP：高精度，适合分布式合并场景
   - DME：理论保证，无偏估计
3. **空间效率高**：$O(mb\log Z)$ 与数据量无关
4. **实验充分**：3 个真实数据集 + 4 种分布合成数据

### 5.2 局限

1. **MLP 训练成本**：需要离线训练，泛化性依赖训练数据覆盖
2. **DME 估计延迟**：概率计数器维护增加查询开销
3. **参数敏感性**：$Z$ 值选择影响 DME 精度（MLP 鲁棒）
4. **哈希假设**：理论分析要求强通用哈希，实际用 MurmurHash3 近似

---

## 六、总结与启示

### 6.1 核心创新点

1. **环状模运算更新**：用代数结构替代显式计数器，实现可逆更新
2. **马尔可夫建模**：将 Sketch 演化视为 Markov 过程，扩展 Martingale 估计器
3. **学习式估计**：用 MLP 捕捉 Sketch 结构特征，突破 MLE 信息瓶颈

### 6.2 应用价值

- **实时分析**：适合需要快速去重统计的场景（如网络监控、日志聚合）
- **联邦学习**：MLP 估计器支持隐私保护下的分布式合并
- **数据库内核**：可集成到查询优化器的基数估计模块

### 6.3 未来方向

1. **自适应参数**：动态调整 $Z$ 值应对数据偏斜
2. **在线学习**：增量更新 MLP 权重适应数据分布漂移
3. **多查询支持**：扩展到其他聚合查询（如分位数、矩估计）

---

## 参考文献

[1] Li Z, Wang P, Song Q, et al. ZRing: A Dynamic Sketch for Weighted Cardinality Estimation in Data Streams[C]//KDD 2026.

[2] Qi Y, Wang P, Li R, et al. QSketch: An Efficient Sketch for Weighted Cardinality Estimation in Streams[C]//KDD 2024.

[3] Lemiesz J. On the algebra of data sketches[J]. PVLDB 2021.

---

*报告生成时间：2026-04-22*
