---
layout: post
title: "PatternSketch 阅读笔记"
date: "2026-05-06 15:13:13"
updated: "2026-05-12 16:53:06"
permalink: papers/patternsketch/
categories: ["论文阅读"]
tags: ["Sketch","可编程网络"]
excerpt: "网络流量测量是网络管理任务（QoS、异常检测、负载均衡等）的基础。时序流量模式检测（Time-series Traffic Pattern Detection）通过揭示跨多个时间周期的动态流行为，比传统的单周期流测量提供了更深入的洞察。然而，现有方案存在以下关键限制："
disableNunjucks: true
comments: false
---

> **论文标题**: PatternSketch: General and Runtime Reconfigurable Time-series Network Traffic Pattern Detection
> **作者**: Yang Du, Dan Wang, He Huang, Hanwen Zhang, Jianzhi Tang, Fu Xiao, Yu-E Sun
> **单位**: 苏州大学 (Soochow University)、南京邮电大学
> **发表**: EuroSys '26 (European Conference on Computer Systems), 2026年4月, Edinburgh, Scotland
> **DOI**: https://doi.org/10.1016/j.cag.2024.10.011 (实际为 10.1145/3767295.3769337)
> **源码**: https://github.com/duyang92/patternsketch/

---

## 一、论文概述

### 1.1 研究背景与动机

网络流量测量是网络管理任务（QoS、异常检测、负载均衡等）的基础。时序流量模式检测（Time-series Traffic Pattern Detection）通过揭示跨多个时间周期的动态流行为，比传统的单周期流测量提供了更深入的洞察。然而，现有方案存在以下关键限制：

1. **单一模式**: BurstSketch、Pontus、ScoutSketch 等系统各自只针对一种特定模式（burst、wave、promising），无法同时检测多种模式。
2. **资源瓶颈**: 在可编程交换机上为每种模式部署独立的 sketch 不可行，因为交换机通常只允许一个资源密集型的 sketch。
3. **不可运行时重配置**: 添加新模式需要交换机停机重新编译硬件（4-8秒停机），在生产环境中不可接受。

**核心观察**: 尽管时序模式的定义各异，但它们都可以统一抽象为**微模式序列**（sequences of micro-patterns），即相邻时间周期之间的变化。

### 1.2 核心贡献

1. **Pattern Automaton**: 受有限状态自动机启发，将多种模式统一为微模式序列，实现单个 sketch 内同时检测多种时序模式。
2. **两阶段数据平面设计**: 将序列匹配过程分解为微模式收集（Micro-pattern Collection）和状态转换（State Transition）两个阶段。
3. **Late-binding 机制**: 将检测规则编码为表项（微模式表、转换表、优先级表），通过 P4 Runtime API 动态更新，无需重编译交换机流水线。
4. **硬件友好优化**: 解决循环依赖、近似除法等硬件约束问题，在 Intel Tofino 交换机上实现线速运行。
5. **支持同时检测6种模式**（3种已有 + 3种新定义），仅需 200KB 内存即可达到 90%+ 的 F1 分数。

---

## 二、背景知识

### 2.1 单周期流测量

| 方向 | 代表工作 | 说明 |
|------|----------|------|
| 资源高效 | Count-Min, RCS, PR-Sketch, HeavyGuardian, Virtual Bitmap | 优化内存使用，提高精度 |
| 通用频率测量 | UnivMon, Elastic Sketch, OneSketch, CocoSketch | 单个 sketch 支持多种频率相关任务 |
| 可重配置测量 | FlyMon | 唯一实现运行时灵活任务切换的方案，通过 CMU 实现 |

**局限**: 这些方案不适用于时序模式检测——需要维护跨周期的统计数据并关联变化。

### 2.2 时序流量模式检测

#### 代表性模式定义

**1. Burst（突发）**
- 定义: 给定流 $e$ 和持续时间阈值 $T$
- 条件: $f_{i+1} \geq k \cdot f_i$, $f_{j+1} \leq \frac{1}{k} \cdot f_j$, $k > 1$, $j - i \leq T$
- 含义: 频率在短时间内的急剧上升后紧随急剧下降
- 代表工作: BurstSketch

**2. Wave（波动）**
- 正波动: $f_j \geq k \cdot f_i$, $f_m \leq \frac{1}{k} \cdot f_n$, $k > 1$
- 负波动: $f_j \leq \frac{1}{k} \cdot f_i$, $f_m \geq k \cdot f_n$, $k > 1$
- 含义: 频率上升后下降（或下降后上升），比 burst 更宽泛
- 代表工作: Pontus

**3. Promising（有希望/上升趋势）**
- 定义: $f_{i+1} \geq k \cdot f_i$, 存在 $T$ 个周期满足 $f_{i+j} \geq k \cdot f_{i+j-1}$，其余周期满足 $f_{i+j} > \frac{1}{r} \cdot f_{i+j-1}$
- 含义: 持续多周期的近乎连续增长趋势
- 代表工作: ScoutSketch

#### 新定义的三种模式（本文提出）

**4. Eruption（爆发）**: 多个时间周期内频率的突然极端上升
- 条件: $f_{i+1} \geq k \cdot f_i$, $f_{j+1} \geq k \cdot f_j$, $k > 1$, $j - i \leq T$

**5. Plunge（骤降）**: 多个时间周期内频率的急剧下降
- 条件: $f_{i+1} \leq \frac{1}{k} \cdot f_i$, $f_{j+1} \leq \frac{1}{k} \cdot f_j$, $k > 1$, $j - i \leq T$

**6. Disturbance（扰动）**: 短时间内先急剧下降后急剧上升
- 条件: $f_{i+1} \leq \frac{1}{k} \cdot f_i$, $f_{j+1} \geq k \cdot f_j$, $k > 1$, $j - i \leq T$

---

## 三、PatternSketch 设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────┐
│                  Control Plane                    │
│  ┌──────────────┐    ┌────────────────────────┐  │
│  │   Pattern     │    │   Runtime Interface    │  │
│  │   Automaton   │◄──►│   (P4 Runtime API)     │  │
│  │   (§3.2)      │    └────────────────────────┘  │
│  └──────┬───────┘                                 │
│         │ Add/Remove Patterns                     │
└─────────┼─────────────────────────────────────────┘
          │ Configure
          ▼
┌─────────────────────────────────────────────────┐
│                   Data Plane                      │
│  ┌────────────────────┐  ┌────────────────────┐  │
│  │ Micro-pattern       │  │ State Transition   │  │
│  │ Collection (§3.3)   │──►│ (§3.4)            │  │
│  │                     │  │                    │  │
│  │ ┌────────┐ ┌─────┐ │  │ ┌──────────────┐  │  │
│  │ │Stage-1 │→│S-2  │ │  │ │Transition    │  │  │
│  │ │(过滤)  │ │(生成)│ │  │ │Table (TCAM)  │  │  │
│  │ └────────┘ └─────┘ │  │ ├──────────────┤  │  │
│  │                     │  │ │Priority      │  │  │
│  │ Micro-pattern Table │  │ │Table (TCAM)  │  │  │
│  │ (TCAM)              │  │ └──────────────┘  │  │
│  └────────────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**设计目标**:
- **通用性**: 同时检测多种时序模式，包括未预见的新模式
- **运行时可重配置**: 不停机更新监控模式集合
- **可编程交换机兼容**: 适应严格的流水线和内存约束
- **高效性**: 最小化计算和片上存储资源使用

### 3.2 Pattern Automaton（模式自动机）

#### 核心思想

将时序模式检测转化为**序列匹配问题**，利用有限状态自动机原理同时匹配多种微模式序列。

#### 3.2.1 输入：五种基本微模式

| 微模式 | 缩写 | 条件 | 含义 |
|--------|------|------|------|
| Sudden Increase | SI | $f_i \geq \alpha_{SI} \cdot f_{i-1}$, $\alpha_{SI} > 1$ | 频率急剧上升 |
| Sudden Decrease | SD | $f_i \leq \beta_{SD} \cdot f_{i-1}$, $\beta_{SD} < 1$ | 频率急剧下降 |
| Gradual Increase | GI | $f_i \geq \alpha_{GI} \cdot f_{i-1}$, $1 < \alpha_{GI} \leq \alpha_{SI}$ | 频率缓慢上升 |
| Gradual Decrease | GD | $f_i \leq \beta_{GD} \cdot f_{i-1}$, $\beta_{SD} \leq \beta_{GD} < 1$ | 频率缓慢下降 |
| Stable | ST | 不满足以上任何条件 | 频率基本不变 |

> 注: 所有微模式都要求 $f_{i-1} \geq T$ 且 $f_i \geq T$，以过滤小流。

#### 3.2.2 状态

- **初始状态 (start)**: 流首次被观察时的状态
- **接受状态 (accepting)**: 匹配到目标模式时的状态（6种模式对应6个接受状态）
- **中间状态 (intermediate)**: 初始状态到接受状态之间的过渡状态

中间状态示例:
- `pre-burst`: SI 后但未满足 burst 条件
- `x-promising`: 持续 GI 的第 x 个周期
- `pre-wave`, `pre-disturbance` 等

#### 3.2.3 状态转换

以 Burst 检测为例的自动机路径:

```
start → [SI] → sudden increase → [SD] → burst (accept)
                                → [非SD] → pre-burst
         [GI] → gradual increase → ...
         [ST] → stable → ...
         [GD] → gradual decrease → ...
         [SD] → sudden decrease → ...
```

**关键特性**:
- 支持**重叠模式**: 流从一种模式转换到另一种模式时，自动机无缝跟随新状态
- 支持**运行时重配置**: 通过控制平面 API 更新阈值和持续时间

#### 状态转换表示例

| 状态\输入 | SI | SD | GI | GD | ST |
|-----------|----|----|----|----|----|
| start | sudden increase | sudden decrease | gradual increase | gradual decrease | stable |
| sudden increase | - | **burst** | - | - | - |
| gradual increase | - | - | 1-promising | - | - |
| 1-promising | - | - | 2-promising | - | - |
| 2-promising | - | - | **promising** | - | - |
| stable | sudden increase | sudden decrease | gradual increase | gradual decrease | stable |
| ... | ... | ... | ... | ... | ... |

### 3.3 Micro-pattern Collection（微模式收集）

分为两个阶段:

#### Stage-1: 过滤小流

**数据结构**: L 个桶的数组 $F[1], ..., F[L]$，$d$ 个独立哈希函数 $H_1(), ..., H_d()$。每个桶包含流 ID 和计数器 cnt。

**插入逻辑**:
1. 流 $e$ 被哈希到 Stage-2 的桶 $PB[G(e)]$
2. **Case 1**: $PB[G(e)]$ 已见过 $e$ → 直接增加 $C_{cur}$
3. **Case 2**: $PB[G(e)]$ 未见过 $e$ → 插入 Stage-1
   - 桶为空 → 直接插入
   - 桶非空且不是 $e$ → 减少已有流的频率（类似 Count-Min 的保守更新）
   - 桶中有 $e$ → 增加频率，若超过阈值 $T_f$ 则准备插入 Stage-2

**更新逻辑**: 每个周期结束时，Stage-1 所有桶重置为零。

#### Stage-2: 生成微模式

**数据结构**: $M_1$ 个桶的数组 $PB[1], ..., PB[M_1]$，每个桶有 $c_1$ 个单元格。每个单元格包含:
- 流 ID
- $C_{pre}$: 上一周期频率
- $C_{cur}$: 当前周期频率

**微模式表 (TCAM)**: 以 $C_{pre}$ 和 $C_{cur}$ 的组合为键，表值为微模式编号。

**更新逻辑**（每个周期结束时）:
1. 若 $C_{cur} < T_f$ 且 $C_{pre} < T_f$ → 驱逐（小流过滤）
2. 若 $C_{cur} = 0$ → 驱逐（流消失）
3. 若满足某微模式条件 → 将流 ID 和微模式插入 State Transition
4. 重置 $C_{pre} = C_{cur} = 0$

### 3.4 State Transition（状态转换）

**数据结构**: $M_2$ 个桶的数组 $PA[1], ..., PA[M_2]$，每个桶有 $c_2$ 个单元格。每个单元格包含:
- 流 ID
- 状态 $S$
- 标志 $N$: 是否在当前周期更新了微模式
- 计数器 $S_{num}$: 当前状态持续的周期数

**状态转换表 $P$**: 二维数组，实现为 TCAM，记录从当前状态 + 输入微模式 → 下一状态的映射。

**状态优先级表**: 用于在桶满时决定驱逐策略。

**插入逻辑**:
- **Case 1**: 流已在桶中
  - 查询 $P[S, micro_{new}]$ 获取新状态
  - 若新状态 = 当前状态 → $S_{num}$++
  - 若新状态 ≠ 当前状态且非接受状态 → 更新状态
  - 若新状态为接受状态 → **报告检测到的模式**
- **Case 2**: 流不在桶中
  - 有空单元格 → 插入
  - 满 → 按优先级概率驱逐

**更新逻辑**:
- 状态持续时间超过阈值 → 驱逐
- 当前周期未出现（$N = false$）→ 驱逐
- 重置所有标志 $N = false$

---

## 四、端到端应用示例：SYN Flood 检测

1. PatternSketch 持续监控 (源地址, 目的地址) 标识的流
2. 攻击流表现为 "Burst" 模式: SYN 包突然激增、短暂持续、无正常 TCP 三次握手
3. Pattern Automaton 检测到微模式序列后，在**数据平面**立即生成轻量级告警（五元组 + 时间元数据）
4. 告警发送到控制平面，输入 Prophet 等时序分析工具
5. 分析工具获取历史数据，预测激增是瞬态（如促销流量）还是真正的攻击
6. 运营商根据分析结果实施速率限制、过滤或重定向

**与离线分析方案的区别**: UnivMon/Hydra 等依赖定期导出计数器到控制平面检测异常，存在固有延迟。PatternSketch 直接在数据平面检测并立即告警。

---

## 五、硬件实现

### 5.1 硬件约束

在 Intel Tofino 交换机上部署面临的三个关键问题:

| 约束 | 编号 | 描述 |
|------|------|------|
| 循环依赖 | HC1-1 | Stage-1 内部: ID 匹配依赖计数器更新，计数器清零依赖 ID 判断 |
| 循环依赖 | HC1-2 | Stage-1 与 Stage-2 之间: Stage-2 阈值判断依赖 Stage-1，Stage-1 驱逐依赖 Stage-2 ID |
| 循环依赖 | HC1-3 | State Transition 内部: ID 更新依赖 flag，flag 更新依赖 ID |
| 复杂运算 | HC2 | Tofino 仅支持加减法，不支持除法，但微模式需要计算频率比值 |
| 遍历操作 | HC3 | 需要遍历所有桶进行更新，在交换机上不可行 |

### 5.2 数据平面优化

**O1: 解决循环依赖 — Resubmit 机制**
- 将数据包从 ingress deparser 发送回 parser
- 在包头嵌入哈希桶索引
- 通过 `ig_intr_md.resubmit_flag` 区分普通包和重提交包
- 实际影响: 大多数流是 "mouse flow"，不会触发频繁重提交；大象流一旦超过阈值立即提升到 Stage-2

**O2: 近似除法 — 对数表**
- 将 $C_{cur}/C_{pre} > T$ 转换为 $\log_b(C_{cur}) - \log_b(C_{pre}) > \log_b T$
- 使用对数匹配动作表 (LMAT) 在 TCAM 中预加载对数值
- 底数 $b$ 可选较大值（如4）以减少表项数量
- 实验表明对检测精度影响可忽略

**O3: 触发式更新策略**
- 在每个单元格中增加时间字段存储当前周期号
- 包到达时检查时间字段是否过期
- 过期 → 执行更新逻辑（生成微模式）
- 未过期 → 执行插入逻辑
- 通过 resubmit 实现跨阶段更新

### 5.3 控制平面优化

- **DP→CP**: 数据平面仅发送轻量级 digest（流标签 + 检测到的模式），而非整个数据包
- **CP→DP**: 通过 P4 Runtime API 更新 match-action 表项，仅在参数修改或添加新模式时操作，不频繁

---

## 六、理论分析

### 6.1 Stage-1 误差界

**定理 1**: 假设每个周期内流频率总和不超过 $W$，$m$ 为 Stage-1 桶数，$f_j$ 为流 $e_j$ 的真实频率，则:

$$\Pr\{f_j - F[h_i(e_j)].cnt \geq \delta\} \leq \frac{(W - f_j)}{m\delta}$$

含义: Stage-1 的估计频率是真实频率的**下界估计**（不会高估）。

### 6.2 Stage-2 无高估误差

**定理 2**: 对于 Stage-2 中的任意流 $e_j$，其估计频率 $\hat{f}_j$ 满足:

$$\hat{f}_j \leq f_j$$

含义: Stage-2 保证**无高估**，这对模式检测的准确性至关重要。

### 6.3 State Transition 插入流数上界

**定理 3**: 假设每个周期频率总和不超过 $W$，$T_f$ 为过滤阈值，$T$ 为微模式检测阈值，则插入 State Transition 的流数 $N$ 满足:

$$N \leq \frac{W}{T}$$

含义: State Transition 的工作负载有明确上界，保证系统可扩展性。

---

## 七、实验评估

### 7.1 实验设置

**数据集**:

| 数据集 | 说明 | 规模 | 周期划分 |
|--------|------|------|----------|
| WebData (Web Page) | 下载的网页交易数据 | 项数级 | 70K 项/周期 |
| DataCenter | 生产数据中心包级追踪 | 30M 包 | 10K 包/周期 |
| StackOverflow | 问答交互日志 | 60M 项 | 30K 项/周期 |
| CAIDA-IP (IP Trace) | 2019年匿名化 IP 流 | 分钟级 | 0.1s/周期 |

**各数据集模式分布** (Table 2):

| 数据集 | burst | wave | promising | eruption | plunge | disturbance | 总计 |
|--------|-------|------|-----------|----------|--------|-------------|------|
| IP Trace | 1170 | 2412 | 270 | 230 | 183 | 1241 | 3095 |
| Web Page | 4709 | 7341 | 1008 | 720 | 715 | 2583 | 9784 |
| Data Center | 3302 | 5749 | 2 | 959 | 1064 | 2433 | 7774 |
| Stack Overflow | 619 | 995 | 33 | 89 | 112 | 374 | 1229 |

**硬件平台**:
- Intel Tofino 交换机 (3.2 Tbps, 32×100 Gbps 端口)
- 流量生成: Intel Xeon W-2295 服务器 + Intel XL710 40G 网卡，使用 Tcpreplay 线速注入

**软件平台**:
- C++ 实现，g++ ≥ 13.1.0 编译
- Intel Core i7-13700 (16核/24线程, 2.10GHz), 32GB RAM

**评估指标**: Recall Rate (RR), Precision Rate (PR), F1 Score, Throughput (MIPS)

**参数配置** (软件版):
- $d = 1$（哈希函数数量）
- $l = 0.5$（非潜在模式阈值比）
- $r_1 = 0.3$（Stage-1 占比）
- $r_2 = 0.9$（Stage-2 占剩余空间比）
- $c_1 = 4$（Stage-2 每桶单元格数）
- $c_2 = 4$（State Transition 每桶单元格数）

### 7.2 新模式的可扩展性

引入 eruption、plunge、disturbance 三种新模式来验证可扩展性。这些模式仅需在控制器 API 中指定新的微模式转换序列，**无需修改数据平面流水线或 sketch 结构**。

### 7.4 不同数据集上的表现

- 内存超过 100KB 时，四个数据集的 RR 均超过 92%，F1 均超过 93%
- Data Center 和 IP Trace 数据集在 50KB 内存下 F1 即超过 98%
- 四个数据集间性能差异很小，趋势一致

### 7.5 多模式同时检测（核心实验）

**Precision Rate (Table 5)**:

| 内存(KB) | Burst | Wave | Promising | Eruption | Plunge | Disturbance |
|----------|-------|------|-----------|----------|--------|-------------|
| 100 | 0.977 | 0.841 | 0.975 | 0.961 | 1.000 | 1.000 |
| 200 | 0.989 | 0.842 | 0.943 | 1.000 | 1.000 | 1.000 |
| 600 | 0.997 | 0.842 | 0.958 | 1.000 | 1.000 | 1.000 |

> PatternSketch(P4) 的 PR 与基线对比:
> - Burst 检测: 轻微优于 BurstSketch
> - Wave 检测: PR 是 Pontus 的 1.76 倍
> - Promising: PR 是 ScoutSketch 的 1.32 倍
> - Eruption/Plunge/Disturbance: Strawman 方案 PR 极低 (< 0.23)，PatternSketch 达 95%+

**F1 Score (Table 6)**:
- 200KB 内存下所有子任务 F1 均达到 0.90+
- Wave 检测 F1 是 Pontus 的 2.21 倍，是 ScoutSketch 的 1.55 倍
- Plunge 和 Disturbance 检测 F1 接近 1.0

**吞吐量**:
- 硬件版本处理速度显著
- 软件版本随内存增加吞吐量下降（更多操作）
- 总体显著优于 Strawman 方案

### 7.6 单模式检测

| 模式 | 对比方案 | PatternSketch 优势 |
|------|----------|-------------------|
| Burst | BurstSketch | 性能相当，< 30KB 时软件版更优，> 30KB 时 BurstSketch 略优，F1 均 > 95% |
| Wave | Pontus | RR 接近 1.0，Pontus 在 < 100KB 时 RR < 60%；F1 是 Pontus 的 1.73 倍 |
| Promising | ScoutSketch | > 30KB 时 RR > 98%，F1 比 ScoutSketch 高近 10% |
| Eruption | Strawman | RR 高约 50%，F1 显著优于 Strawman |
| Plunge | Strawman | RR 近 100%，Strawman 最高仅 39% |
| Disturbance | Strawman | RR 高约 20-30% |

### 7.7 硬件资源消耗

基于 Intel Tofino 10 个阶段的资源利用:

| 资源 | 平均利用率 |
|------|-----------|
| Hash bits | 15.72% |
| Meter ALUs | 32.50% |
| SRAM | 5.00% |
| TCAM | 2.50% |

- 占用 200KB 片上内存
- 前5个阶段的 SALU 消耗显著高于后续阶段（因为三个阶段寄存器的读写操作）

---

## 七、关键参数调优实验

| 参数 | 含义 | 最优值 | 说明 |
|------|------|--------|------|
| $d$ | 哈希函数数量 | 1 | 多哈希减少冲突但让更多小流进入下一级，降低精度 |
| $l$ | 非潜在模式阈值比 | 0.3 | 对 Promising 最优在 0.2-0.3 |
| $r_1$ | Stage-1 占比 | 0.2-0.5 | 过大则 Stage-2 和 State Transition 空间不足 |
| $r_2$ | Stage-2 占剩余空间比 | 0.8 | 所有模式 RR 随 $r_2$ 增大而提升 |
| $c_1$ | Stage-2 每桶单元格数 | 4 | 推荐 4-8 |
| $c_2$ | State Transition 每桶单元格数 | 4 | 4 时达到最佳精度 |

**对数底数 $b$ 的影响**: 不同底数（1.05, 2.0, 3.0, 4.0）对 F1 的影响可忽略，方案对对数底数变化具有鲁棒性。

---

## 八、与现有工作的对比

| 特性 | BurstSketch | Pontus | ScoutSketch | X-Sketch | FlyMon | **PatternSketch** |
|------|-------------|--------|-------------|----------|--------|-------------------|
| 支持模式数 | 1 (burst) | 1 (wave) | 1 (promising) | 1 | 多种单周期任务 | **6+ 种时序模式** |
| 硬件实现 | 仅软件 | 8/12 流水线阶段 | 仅软件 | 测量前配置 | 有 | **线速运行** |
| 运行时重配置 | 否 | 否 | 否 | 否 | 是 | **是** |
| 新模式支持 | 需重新设计 | 需重新设计 | 需重新设计 | 需重新设计 | 不适用 | **API 更新即可** |
| 多模式同时检测 | 需多实例 | 需多实例 | 需多实例 | 不支持 | 不适用 | **单 sketch 支持** |

---

## 九、理论保证

1. **Stage-1 误差界**: 估计频率不超过真实频率（下界估计），高估概率有上界
2. **Stage-2 无高估**: 保证 $\hat{f}_j \leq f_j$
3. **State Flow 上界**: 每周期插入 State Transition 的流数不超过 $W/T$

---

## 十、局限性与未来工作

### 当前局限
1. 仅支持**单变量流量频率**的时序模式，不支持多变量模式（如金融 K 线模式）
2. 不支持跨周期 burst（spanning > 2 个连续窗口），需参考 BurstDetector
3. 硬件版本每个阶段每桶仅 1 个单元格（vs 软件版 4-8 个），影响精度

### 未来方向
- **子群体模式检测**: 将 PatternSketch 扩展到多维流数据的任意子集上进行实时模式检测（结合 Hydra/OmniSketch 的思路）
- 更多模式类型的抽象和统一

---

## 十一、个人评价与思考

### 优点
1. **统一抽象精妙**: 将多种看似不同的时序模式统一为微模式序列，是一个非常优雅的抽象。自动机的设计使得新模式的添加仅需更新表项，而非重新设计算法。
2. **工程价值高**: 在真实 Tofino 交换机上实现并验证，资源消耗可控（200KB SRAM，各资源利用率 < 33%），具有实际部署可行性。
3. **理论分析完备**: 提供了误差界、无高估保证和流数上界三个定理，增强了可信度。
4. **实验全面**: 四个真实数据集、六种模式、单模式和多模式检测、软硬件版本对比、吞吐量测试、参数调优实验。

### 可能的改进方向
1. **微模式定义的灵活性**: 当前5种基本微模式可能无法覆盖所有变化类型（如振荡模式）。考虑支持用户自定义微模式。
2. **多变量模式**: 扩展到多维特征（如同时考虑包大小和频率）的模式检测。
3. **自适应参数**: 当前阈值 ($\alpha_{SI}$, $\beta_{SD}$ 等) 需要手动设置，能否根据流量特征自适应调整？
4. **长模式检测**: 对于持续很多周期的模式（如 promosing 需要 10+ 周期），状态空间管理可能成为瓶颈。

### 与其他工作的关系
- 与 **FlyMon** 的思路相近（运行时可重配置），但 FlyMon 关注单周期任务，PatternSketch 关注时序模式
- 与 **X-Sketch** 的统一化思路类似，但 X-Sketch 仅支持多项式频率轨迹，且测量前配置不可改
- Pattern Automaton 的设计受 **Aho-Corasick** 等多模式串匹配算法的启发

---

## 十二、关键术语表

| 术语 | 含义 |
|------|------|
| Micro-pattern | 相邻两个时间周期之间的频率变化类型（SI/SD/GI/GD/ST） |
| Pattern Automaton | 受 FSA 启发的统一模式检测自动机 |
| Stage-1 | Micro-pattern Collection 的第一阶段，过滤小流 |
| Stage-2 | Micro-pattern Collection 的第二阶段，生成微模式 |
| State Transition | 基于微模式序列进行状态转换和模式匹配 |
| Late-binding | 将检测规则作为表项动态安装到数据平面的机制 |
| Resubmit | Tofino 交换机中将数据包从 deparser 发送回 parser 以解决循环依赖的技术 |
| LMAT | Logarithmic Match-Action Table，用于近似除法运算的对数查找表 |
| TCAM | Ternary Content-Addressable Memory，用于实现微模式表和状态转换表 |
| RMT | Reconfiguration Match-action Tables，Tofino 交换机的流水线架构 |
