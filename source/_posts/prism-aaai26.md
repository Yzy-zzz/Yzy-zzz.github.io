---
layout: post
title: "PRISM：面向自适应云-边 LLM 推理的隐私感知路由与语义草图协作——论文阅读笔记"
date: "2026-09-28 15:46:38"
updated: "2026-09-28 23:59:37"
permalink: papers/prism-aaai26/
categories: ["论文阅读"]
tags: ["Sketch","网络安全"]
excerpt: "PRISM 的核心思想是：先在边缘端判断“这条 prompt 到底有多敏感”，再根据风险把请求动态分流到云端、边缘端或云-边协作路径，并仅在协作路径中对敏感实体实施自适应的两层本地差分隐私扰动，最后利用“云端生成语义草图 + 边缘端结合原始上下文精修”的方式恢复回答质量。"
disableNunjucks: true
comments: false
---

> 论文：**PRISM: Privacy-Aware Routing for Adaptive Cloud–Edge LLM Inference via Semantic Sketch Collaboration**  
> 作者：Junfei Zhan, Haoxun Shen, Zheng Lin, Tengjiao He

## 开头：发表信息、CCF 级别与开源情况

这篇论文发表于 **AAAI 2026（The Fortieth AAAI Conference on Artificial Intelligence, AAAI-26）**，收录于 *Proceedings of the AAAI Conference on Artificial Intelligence*, **Vol. 40, No. 33, pp. 28150–28158**，官方论文页面给出的在线发表日期为 **2026-03-14**。AAAI-26 会议于 **2026 年 1 月 20–27 日在新加坡**举行，论文属于 **AAAI Technical Track on Machine Learning X**。

- **CCF 级别**：AAAI 在中国计算机学会 CCF“人工智能”类别的推荐国际学术会议中为 **A 类**。
- **论文 DOI**：[10.1609/aaai.v40i33.40041](https://doi.org/10.1609/aaai.v40i33.40041)
- **AAAI 官方论文页**：[AAAI Proceedings](https://ojs.aaai.org/index.php/AAAI/article/view/40041)
- **会议官网**：[AAAI-26](https://aaai.org/conference/aaai/aaai-26/)
- **CCF 人工智能目录**：[CCF 推荐国际学术会议（人工智能）](https://www.ccf.org.cn/Academic_Evaluation/AI/)
- **开源情况**：**已开源**，官方仓库采用 MIT License，并提供代码、数据、预训练 soft-gating checkpoint、few-shot 示例与补充材料。
- **代码仓库**：[Junfei-Z/PRISM](https://github.com/Junfei-Z/PRISM)
- **项目主页**：[PRISM Project Page](https://junfei-z.github.io/prism/)

---

## 1. 摘要 (Abstract) 与核心贡献 (Core Contribution)

### 一句话总结

**PRISM 的核心思想是：先在边缘端判断“这条 prompt 到底有多敏感”，再根据风险把请求动态分流到云端、边缘端或云-边协作路径，并仅在协作路径中对敏感实体实施自适应的两层本地差分隐私扰动，最后利用“云端生成语义草图 + 边缘端结合原始上下文精修”的方式恢复回答质量。**

### 贡献列表 (Contribution List)

- **提出隐私感知的三路自适应推理框架 PRISM。** 与“所有请求都采用相同隐私机制”不同，PRISM 在边缘端执行 sensitivity profiling 与 soft gating，将请求分为 **Cloud-only、Cloud-Edge Collaborative、Edge-only** 三种模式，让隐私强度与输入语义风险匹配。
- **提出 Adaptive Two-Layer LDP。** 不再简单对整个 prompt 或所有实体施加同样的噪声，而是将实体拆为“类别 category”和“具体值 value”两层，依据实体类别的敏感权重动态分配总隐私预算，并使用 randomized response 分别扰动。
- **提出 Semantic Sketch Collaboration。** 云端不直接负责最终回答，而是基于扰动后的 prompt 生成结构化、简洁的“语义草图”；边缘端 SLM 再利用**未离开本地的原始 prompt**与草图共同恢复最终答案，从而减少云端因隐私噪声导致的语义漂移。

论文还构造了覆盖 **旅游、医疗、银行、通识知识**四个场景的半合成数据集，并在真实 RTX 3070 Laptop GPU 边缘设备上测量延迟与能耗。论文摘要报告，相比 Uniform LDP 和 Selective LDP，PRISM 的延迟和边缘能耗大致降低至基线的 40% 左右，同时保持更高的回答质量。

---

## 2. 引言 (Introduction)：问题背景与研究动机

### 问题定义 (Problem Definition)

这篇论文研究的是一个典型的 **“隐私—质量—效率三难问题”**：

1. **全云端 LLM**：模型能力强、响应快，但用户必须把原始 prompt 发给云端；医疗、金融、个人行程等 prompt 很可能包含身份、疾病、账户、行为偏好等敏感信息。
2. **全边缘 SLM**：原始数据无需离开设备，隐私最好，但小模型在复杂任务上的推理质量通常低于云端大模型，而且本地推理会显著增加设备延迟和能耗。
3. **云-边协作**：看似兼顾两者，但如果所有输入都套用相同的脱敏/噪声方案，就会出现“无隐私风险的问题也被过度扰动、高隐私风险的问题又可能保护不够”的问题。

因此，论文真正要解决的不是“如何给 LLM 加一个 DP 机制”这么简单，而是：

> **能否根据每个 prompt 的具体语义风险，动态决定在哪里推理、扰动什么、扰动到什么程度，并尽量让强隐私保护不破坏最终回答质量？**

这在工业界尤其重要。真实 LLM 服务流量是高度异质的：同一用户可能上一秒问“法国首都是什么”，下一秒就问“我上周确诊 HIV，现在发烧怎么办”。如果两者都走相同安全链路，要么浪费资源，要么泄露隐私。

### 现有方法的局限 (Limitations of Prior Work)

论文重点指出两类前序方案的瓶颈。

#### 2.1 二元路由：Cloud vs. Edge

已有云-边推理系统常用简单阈值把 prompt 分为敏感/不敏感：敏感的放本地，不敏感的发云端。

问题是，这种二值策略过于粗糙：

- 阈值稍保守，大量中等敏感任务被推到边缘，导致本地设备算力、功耗和响应时间急剧上升；
- 阈值稍激进，又可能把实际敏感的请求错误发给云端；
- 它无法表达“这个问题可以用云端能力，但必须先部分脱敏”的中间状态。

PRISM 的关键改动，就是加入第三种 **collaborative mode**，把“是否上传”从二选一扩展成三态决策。

#### 2.2 Uniform / Prompt-level LDP

另一类工作会对整个 prompt、所有 token、所有 embedding 维度，或所有检测到的实体施加同一强度的扰动。

这种方法的核心痛点是：**隐私敏感性并不均匀。**

例如：

- `Alice`、银行卡号、医疗诊断可能高度敏感；
- `New York`、`Monday`、一般机构名可能只是完成任务所需的普通语义槽位。

如果统一强扰动，云模型会接收到“语法上还能读，但语义已经变形”的指令，最终生成泛化、含糊甚至回避式答案。论文在引言中特别强调：简单 masking 也不能彻底防止 linkage attack，因为跨记录中的非身份语义仍可能帮助攻击者重识别用户。

### 本文思路 (Overall Idea)

作者的切入点可以概括为两层自适应：

1. **系统层自适应：决定“去哪算”**  
   低风险 -> Cloud-only；高风险 -> Edge-only；中风险 -> Cloud-Edge Collaboration。

2. **隐私层自适应：决定“扰动什么、怎么扰动”**  
   进入 collaborative 路径后，不做整句均匀加噪，而是对敏感实体的类别和值分别执行 LDP，并根据类别敏感度分配预算。

进一步，作者意识到“加噪之后直接让云端写最终答案”仍然容易丢失任务语义，因此引入 **semantic sketch**：让云端只提供高层结构和知识骨架，把最后一次“将知识绑定回用户原始上下文”的过程留在本地完成。

---

## 3. 方法论深度解析 (In-depth Methodological Analysis)

### 3.1 整体架构 (Overall Architecture)

论文 Figure 1（第 3 页）给出了 PRISM 的第一阶段：**Routing Phase**。

![Figure 1：PRISM 的隐私感知路由阶段](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/figure1_routing.png)

从输入到输出，可以把整个 PRISM pipeline 写成下面这条链：

```text
User Prompt P
   |
   v
[Edge] Sensitivity Profiling
   |---- 总体风险分数 R(P)
   |---- 敏感实体掩码 d
   v
[Edge] Soft Gating
   |
   +--> Cloud-only ------> Cloud LLM ------> Final Response
   |
   +--> Edge-only -------> Edge SLM -------> Final Response
   |
   +--> Collaborative
          |
          v
      [Edge] Adaptive Two-Layer LDP
          |  P -> P*
          v
      [Cloud] Semantic Sketch Generation
          |  P* -> S
          v
      [Edge] Local Refinement
             (P, S) -> Final Response R_hat
```

这里最值得注意的是：**原始 prompt $P$ 只在边缘端完整存在。** Collaborative 模式下，云端看到的是扰动后的 $P^*$；云端返回的也不是最终回答，而是语义草图 $S$。边缘端利用本地保留的原始 $P$ 对 $S$ 进行“补全和重新绑定”，生成最终回复。

从系统设计角度看，PRISM 与传统 cloud-edge inference 最大的不同不是某一个 DP 公式，而是它把隐私保护设计成了一个 **conditional computation / conditional privacy** 问题：

> 不同输入走不同计算路径，不同实体接受不同扰动，甚至同一实体的 category 与 value 也使用不同的隐私预算。

这种设计本质上是在做“按风险付费”：只有真正需要保护的流量，才承担额外隐私和本地计算成本。

---

### 3.2 核心组件/模块拆解 (Core Component Breakdown)

#### 3.2.1 Sensitivity Profiling：把自然语言隐私转成可路由特征

**输入：** 用户 prompt

$$
P = \{x_1,x_2,\ldots,x_n\}
$$

**输出：**

1. prompt 级风险分数 $R(P)$；
2. 实体级二进制 mask $\mathbf d$。

作者首先使用轻量 NER 工具抽取实体集合：

$$
E=\{e_1,e_2,\ldots,e_m\}
$$

每个实体 $e_i$ 有类别 $c_i$，并为类别预定义敏感权重 $w_{c_i}\in[0,1]$。例如 PERSON、ID、DIAGNOSIS 可以被赋予更高权重，而 LOCATION、NATIONALITY 等可相对低一些。

整体风险定义为：

$$
R(P)=\sum_{i=1}^{m} w_{c_i}\cdot I(e_i)
$$

其中 $I(e_i)$ 表示实体是否存在。

这个公式非常简单，但它有一个重要系统含义：**风险随着敏感实体数量和实体类别权重累积**。因此一个含多个高敏实体的 prompt 会自然获得更高 $R(P)$。

作者还加入上下文信号 $\Delta$：如果 prompt 中出现第一人称代词，或出现 PERSON 类型实体，则激活隐私上下文：

$$
\Delta=\max_{x_j\in P} I(x_j\in F)
$$

随后为实体构造 mask：

$$
d_i=\begin{cases}
1, & \Delta>0\\
0, & \text{otherwise}
\end{cases}
$$

论文给了一个很好的例子：

- “**I** plan to travel solo to **Tokyo** for three days”
- “Which country is **Tokyo** located in?”

两个句子都有 `Tokyo`，但第一个包含第一人称语境，明显更像个人行程信息，因此更应被视作隐私相关。

**设计动机：** 单纯按实体类型判断隐私不够。例如 LOCATION 本身不一定敏感，“东京属于哪个国家”几乎没有个人隐私；但“我下周一个人去东京住 6 天”则会泄露个人行动计划。作者用第一人称线索把“实体”升级为“实体 + 使用语境”。

**需要注意的地方：** 这里的 $d_i$ 实际上比较粗。只要 $\Delta>0$，公式就会把当前 prompt 中**所有实体**都标为 1，而不是针对每个实体独立判断。这与论文反复强调的“fine-grained entity-level privacy”存在一定张力：风险分数是实体级加权，但 mask 的上下文化仍接近一个全局开关。

---

#### 3.2.2 Soft Gating：从硬阈值路由变成概率式三路路由

Sensitivity Profiling 输出后，作者构造特征：

$$
\mathbf z=[R(P),\mathbf d]\in\mathbb R^{1+m}
$$

然后送入一个轻量线性变换 $f_\theta(\cdot)$，再做 softmax：

$$
\boldsymbol\pi=\operatorname{softmax}(f_\theta(\mathbf z))
= (\pi_{cloud},\pi_{collab},\pi_{local})
$$

这三个概率分别对应：

- $\pi_{cloud}$：直接云端推理；
- $\pi_{collab}$：云-边协作；
- $\pi_{local}$：完全边缘推理。

训练时加入熵正则：

$$
\mathcal L_{gating}=\mathcal L_{task}+\lambda H(\boldsymbol\pi)
$$

其中：

$$
H(\boldsymbol\pi)=-\sum_j\pi_j\log\pi_j
$$

如果优化目标是最小化上述损失，那么正的 $\lambda H(\pi)$ 会惩罚高熵分布，使路由器更倾向于做出明确决策，而不是长期停留在 0.33/0.33/0.33 一类模糊状态。

推理阶段最终仍采用：

$$
\operatorname*{argmax}_j\pi_j
$$

也就是说，**训练时是 soft routing，执行时是 deterministic top-1 routing**。

这样设计有两个实际好处：

1. 训练时保留连续、可学习的决策边界；
2. 推理时避免随机采样把高敏感请求偶然送到低保护路径。

但论文这里也留下一个实现层面的疑问：$m$ 是 prompt 中实体数量，天然可变，而线性层通常要求固定输入维度。正文没有说明实际实现如何 padding、截断或聚合 $\mathbf d$。此外，论文把 $\mathcal L_{task}$ 描述为下游生成的 cross-entropy，但云端 API 与离散路由通常不可直接端到端反传；开源仓库实际上提供了独立的 labelled routing dataset 和 `train_soft_gating.py`，说明实际训练更像一个有监督路由分类器。这个细节在正文中解释得不够充分。

---

#### 3.2.3 Adaptive Two-Layer LDP：对“实体类型”和“实体值”分别加噪

这是论文最核心的隐私机制。Figure 2（第 5 页）给出了完整流程。

![Figure 2：实体 category/value 两层随机响应扰动](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/figure2_ldp.png)

作者认为，一个实体至少包含两个隐私层次：

- **Category**：它是什么类型，例如 PERSON、LOCATION、DATE；
- **Value**：它的具体值，例如 `Alice`、`New York`、`August`。

于是总隐私预算拆成两部分：

$$
\epsilon_{total}=\epsilon_1+\epsilon_2
$$

其中：

- $\epsilon_1$ 用于 category 层；
- $\epsilon_2$ 用于 value 层。

分配公式为：

$$
\epsilon_1=\epsilon_{total}\cdot
\frac{w_{c_i}}
{w_{c_i}+(1-w_{c_i})\alpha}
$$

$$
\epsilon_2=\epsilon_{total}-\epsilon_1
$$

$\alpha\in(0,1]$ 用于控制 category/value 两层之间的相对分配。

随后两层都使用经典 Randomized Response。对于大小为 $K_1$ 的类别空间：

$$
p_1=\frac{e^{\epsilon_1}}{e^{\epsilon_1}+K_1-1}
$$

以概率 $p_1$ 输出真实类别，否则均匀采样其他类别。value 层同理：

$$
p_2=\frac{e^{\epsilon_2}}{e^{\epsilon_2}+K_2-1}
$$

以概率 $p_2$ 保留真实值，否则采样其他值。

**输入与输出：**

- 输入：原始实体 $(c_i,e_i)$、敏感度权重 $w_{c_i}$、总预算 $\epsilon_{total}$；
- 输出：扰动实体 $(c_i^*,e_i^*)$，进而构成扰动 prompt $P^*$。

**设计动机：** 传统 masking 只隐藏名字，不一定能防关联攻击；统一 LDP 又会把对任务很重要的普通语义槽位一起破坏。把 category 与 value 分开后，系统可以更细粒度地决定“是隐藏它是什么，还是主要隐藏它具体是谁/在哪里/多少钱”。

##### 一个值得高度关注的公式—文字不一致

这里存在论文中最值得质疑的技术细节之一。

在标准 $\epsilon$-DP / randomized response 中：

> **$\epsilon$ 越小，隐私越强、噪声越大；$\epsilon$ 越大，真实值被保留的概率越高、隐私越弱。**

因为：

$$
\frac{e^\epsilon}{e^\epsilon+K-1}
$$

随 $\epsilon$ 增大而增大。

然而论文文字却说：高敏感权重 $w_{c_i}$ 会分配更多 $\epsilon_1$，从而给 category “更多保护 / 更强类别扰动”；Theorem 2 的解释也沿用了这个说法。按照其公式，$w_{c_i}\to1$ 时：

$$
\epsilon_1\to\epsilon_{total},\qquad \epsilon_2\to0
$$

这实际上意味着：

- category 层 $\epsilon_1$ 较大 -> **更容易保留真实 category，类别噪声更小**；
- value 层 $\epsilon_2\approx0$ -> $p_2\approx1/K_2$ -> **value 接近完全随机化，值层保护更强**。

因此，**公式真正实现的行为更像“高敏感实体主要强扰动 value，而相对保留 category 语义”，而不是文字描述的“高敏感实体更强地扰动 category”。**

这不一定意味着整个机制失效，但说明论文对“隐私预算越大意味着什么”的文字解释至少存在方向性混淆。对于后续复现或改进，这一点必须首先核对代码实现与作者本意。

---

#### 3.2.4 Cloud–Edge Semantic Sketch Collaboration：让云端提供“知识骨架”，让边缘负责“隐私回填”

当请求进入 collaborative 模式后，边缘端先得到扰动 prompt $P^*$，然后将其以普通文本发送到云端。作者特意强调：**不传 embedding**，因此不要求云端和边缘共享 tokenizer 或 embedding space，部署兼容性更好。

云端 LLM 使用 few-shot demo set $D_{cloud}$ 生成语义草图：

$$
S=G_{cloud}(C_{cloud})
$$

其中 $C_{cloud}$ 包含若干 `(扰动 prompt, sketch)` 示例和当前 $P^*$。

这个 $S$ 不是最终回答，而是一个简洁、结构化、尽量不依赖敏感实体的抽象结果。随后边缘端构造：

$$
C_{edge}=[D_{edge},(P,S,\_)]
$$

并输出：

$$
\hat R=G_{edge}(C_{edge})
$$

注意边缘端此时同时拥有：

- 原始未扰动 prompt $P$；
- 云端给出的高层语义草图 $S$。

这相当于把任务拆成两步：

1. **云端做“我大概应该如何回答”**——利用大模型知识和推理能力；
2. **边缘做“把这个答案重新贴合到真实用户上下文”**——利用本地私有信息完成细节绑定。

这是整篇论文最有启发性的地方之一。它不试图让噪声后的 prompt 仍然完整承载所有语义，而是主动改变云端输出目标：**从 final answer 降维成 semantic sketch**。这样云模型只需要恢复任务结构，不需要准确重建被扰动的敏感槽位。

---

### 3.3 关键公式与算法 (Key Equations and Algorithms)

#### 公式一：Entropy-Regularized Soft Gating

$$
\boldsymbol\pi=\operatorname{softmax}(f_\theta(\mathbf z)),
\qquad
\mathcal L_{gating}=\mathcal L_{task}+\lambda H(\boldsymbol\pi)
$$

**公式目标：** 学习一个从隐私特征到三种执行模式的映射，同时让路由输出足够“果断”。

**各部分含义：**

- $\mathbf z$：来自 sensitivity profiling 的风险与 mask 特征；
- $f_\theta$：轻量 gating 模型；
- $\boldsymbol\pi$：三种模式的概率；
- $\mathcal L_{task}$：路由/下游任务相关损失；
- $H(\pi)$：路由分布熵；
- $\lambda$：确定性与灵活性之间的权衡系数。

**直觉：** 路由器不是先人为设定两个硬阈值，而是学习一条软决策边界；但最终执行仍取 top-1，所以系统行为可预测、便于实现隐私策略。

#### 公式二：两层 LDP 的预算分配 + Randomized Response

$$
\epsilon_1=\epsilon_{total}\cdot
\frac{w_{c_i}}
{w_{c_i}+(1-w_{c_i})\alpha},
\qquad
\epsilon_2=\epsilon_{total}-\epsilon_1
$$

以及：

$$
p_k=\frac{e^{\epsilon_k}}{e^{\epsilon_k}+K_k-1},\quad k\in\{1,2\}
$$

**公式目标：** 将一个实体的总隐私预算在“类别信息”和“具体值信息”之间动态分配，并分别通过 RR 实现局部差分隐私。

**直觉：** 不把“Alice 是 PERSON”和“PERSON 的具体值是 Alice”看作同一层信息，而是分开控制可见度；这样理论上能在隐私与语义可用性之间获得更细致的折中。

**隐私保证：** Theorem 1 证明两个连续机制分别满足 $\epsilon_1$-LDP 和 $\epsilon_2$-LDP 后，通过顺序组合得到：

$$
(\epsilon_1+\epsilon_2)\text{-LDP}
$$

即单个被保护实体的总预算为 $\epsilon_{total}$。

这里要准确理解论文的保证范围：**它证明的是被选中实体上的局部机制保证，不等于整个 PRISM 系统对任意 prompt 都满足同一个全局 $\epsilon$-LDP。** Cloud-only 模式本身就是明文上传；而若一个 prompt 中有多个实体，联合发布时的 prompt-level 隐私还需要考虑多实体组合带来的总泄漏上界。

#### Algorithm 1：端到端逻辑

论文 Algorithm 1 可以压缩成下面 6 步：

1. 在边缘端计算 $(R(P),\mathbf d)$；
2. 用 gating 得到 $\pi$，取 top-1 mode；
3. 若 `edge-only`：直接 $G_{edge}(P)$；
4. 若 `cloud-only`：直接 $G_{cloud}(P)$；
5. 若 `collaborative`：先得到扰动 $P^*$，让云端生成 sketch $S$；
6. 边缘端使用原始 $P$ 与 $S$ 生成最终 $\hat R$。

因此 PRISM 的核心不是一个单独神经网络，而是一套 **routing + privacy transform + hierarchical generation** 的系统级协议。

---

## 4. 实验设计与结果分析 (Experimental Design and Results Analysis)

### 实验设置 (Experimental Setup)

#### 数据集

论文构造了一个半合成 instruction dataset，共四个领域，每个领域 **40 条 prompt**，总计约 **160 条**：

- **Tourism**：身份、目的地、预算、同行人、日期等；
- **Medical**：人口学属性、症状、诊断等，部分改编自 PrivacyRestore；
- **Banking**：交易历史、账户标识、银行机构等；
- **General Knowledge**：来自 MT-Bench，用于代表低敏感的一般知识问题。

这是一个规模不大的受控评测集，优势是可以明确操纵隐私实体与上下文，劣势是很难覆盖真实生产流量中复杂的隐私表达。

#### 硬件与部署

论文正文给出的边缘设备：

- NVIDIA **RTX 3070 Laptop GPU**；
- Windows 10；
- `llama-cpp-python` 运行量化 SLM；
- `gpu_layers=32`。

云端模型通过 API 访问。

#### 基线

1. **Uniform LDP**：对所有输入 token/信息统一加噪，再云端推理 + 边缘精修；
2. **Selective LDP**：只对 NER 检出的实体应用 LDP；
3. **Cloud-only**：完整 prompt 明文发送云端；
4. **Edge-only**：全部由本地 SLM 处理。

#### 评价指标

- **Inference Quality (IQ)**：GPT-4o 作为 LLM judge，1–10 分；
- **Energy Consumption**：边缘设备侧 Joule；
- **Completion Time**：从输入到最终回答的端到端延迟。

需要强调：论文测到的是**边缘侧能耗**。对于 Cloud-only，云端 GPU 真正执行大模型的电力没有计入。因此这个指标适合回答“用户设备要耗多少电”，不适合直接解释为“整个系统的总能耗/碳排”。

---

### 主实验结果 (Main Results)

Figure 3 与 Table 1 位于论文第 7 页。

![Figure 3：不同隐私预算下能耗、延迟与回答质量](https://win-typora-figure.oss-cn-beijing.aliyuncs.com/%20img-win-1/figure3_results.png)

Table 1 的核心数字为：

| 方法 | 完成时间 Ct.(s) | 边缘能耗 Ec.(J) | 推理质量 IQ |
|---|---:|---:|---:|
| PRISM | **7.92** | **687.16** | **6.88** |
| Uniform LDP | 20.56 | 1707.6 | 5.72 |
| Selective LDP | 21.22 | 1770.8 | 5.94 |
| Edge-only | 17.84 | 1573.9 | 5.09 |
| Cloud-only | 5.13 | 296.27 | 8.14 |

先看与两个真正的隐私保护基线相比：

- 相比 Uniform LDP，PRISM **延迟下降约 61.5%**，边缘能耗下降约 **59.8%**，IQ 提升 **1.16 分**；
- 相比 Selective LDP，PRISM **延迟下降约 62.7%**，边缘能耗下降约 **61.2%**，IQ 提升 **0.94 分**。

这验证了论文最关键的系统假设：

> **如果不是所有请求都被迫经过昂贵的“加噪 -> 云端 -> 边缘恢复”链路，而是根据敏感度动态绕开不必要步骤，系统效率会出现数量级明显的改善。**

值得注意的是，Selective LDP 虽然只扰动实体，但其延迟和能耗甚至略高于 Uniform LDP。这说明**“少扰动几个 token”本身并不会自动减少端到端算力开销**，真正影响效率的是是否执行整套协作/边缘生成链。也正因为如此，PRISM 的 routing 设计比单纯 selective perturbation 更关键。

另一方面，Cloud-only 仍然最快、最低边缘能耗且质量最高：5.13 s / 296.27 J / 8.14。这不是 PRISM 的失败，而恰好说明论文讨论的是 trade-off，而不是宣称隐私保护可以“免费”。PRISM 相对 Cloud-only 付出的代价是约 **1.54× 延迟、2.32× 边缘能耗**，换取对敏感请求的本地处理或 LDP 保护。

Figure 3 在 $\epsilon=10^{-2}$ 到 $10^2$ 的范围内比较了三种隐私方法。随着 $\epsilon$ 变大，Uniform/Selective LDP 的 IQ 明显上升——这是符合 DP 常识的，因为更大的 $\epsilon$ 意味着更弱隐私、更少噪声。PRISM 的 IQ 也会上升，但能耗和延迟始终显著低于两种基线，且波动较小。这个结果支持了作者的观点：**PRISM 的收益不只来自“选了一个好 $\epsilon$”，而来自系统级路由。**

---

### 异构模型结果：Table 2

作者还测试两种云端 LLM 与四种边缘 SLM 的 8 个组合：

- Cloud：GPT-4o（L1）、Qwen3-235B（L2）；
- Edge：Phi-3.5-mini-3.5B（S1）、Qwen1.5-1.8B（S2）、StableLM-2-Zephyr-1.6B（S3）、TinyLLaMA-1.1B（S4）。

大多数配置落在约 7–9 秒、632–740 J 区间，说明 PRISM 并不依赖唯一的 cloud/edge 配对。

其中：

- L1 + S2：7.08 s，632.24 J，是最快且边缘能耗最低组合；
- L2 + S1：IQ = 7.22，是表中最高质量。

但这里有一个正文与表格的明显不一致：论文文字写“所有 pairings 都有 IQ ≥ 6.9”，然而 **L1 + S4 的 IQ 明确为 5.28**。因此更准确的结论应是“多数模型组合保持约 7 分质量，但弱边缘模型与特定云模型组合可能出现显著退化”。

这反而揭示一个很有价值的系统问题：**semantic sketch 并不是完全模型无关的接口。** 草图格式、few-shot prompt、边缘模型的 instruction-following 能力以及云/边模型的语义兼容性，都会影响最终恢复质量。

---

### 消融实验 (Ablation Studies)

严格来说，**这篇 9 页 AAAI 正文没有提供标准意义上的模块消融表**，例如：

- PRISM w/o Soft Gating；
- PRISM w/o Semantic Sketch；
- PRISM w/o Adaptive Budget Allocation；
- PRISM with Hard Threshold Routing；
- PRISM with one-layer LDP。

因此，不能根据正文严谨地回答“哪个组件对最终性能贡献最大”。如果直接把 Table 1 当作消融，会把多个变量混在一起，因果上是不成立的。

不过可以做**间接诊断**：

- Uniform -> Selective LDP：IQ 从 5.72 上升到 5.94，但延迟/能耗没有下降，说明**仅做实体级选择性扰动主要改善语义质量，对系统开销帮助有限**；
- Selective LDP -> PRISM：IQ 再提升 0.94，同时延迟/能耗下降约 60%，但这一步同时加入了 routing、两层预算分配和 semantic sketch，无法区分三者各自贡献；
- Figure 3 中 PRISM 的时间/能耗对 $\epsilon$ 不太敏感，而两种 LDP 基线始终很高，说明**从系统效率角度，adaptive routing 很可能是主要贡献源**；
- 从质量角度，semantic sketch 与 adaptive perturbation 谁贡献更大，正文证据不足。

如果我要复现实验，最优先补的消融是：

1. **固定 collaborative 路径 + adaptive LDP + sketch**：隔离 routing 的作用；
2. **PRISM routing + uniform LDP + sketch**：隔离两层预算分配；
3. **PRISM routing + adaptive LDP + direct cloud answer**：隔离 semantic sketch；
4. **soft gating vs. hard threshold**：验证 soft routing 本身是否必要；
5. **去掉 entropy penalty**：验证 $\lambda H(\pi)$ 对路由稳定性的实际贡献。

只有做完这些实验，才能真正回答“哪个模块贡献最大”。

---

### 具体实现的细节

#### 论文正文明确给出的实现细节

- Edge：RTX 3070 Laptop GPU，Windows 10；
- SLM serving：`llama-cpp-python`；
- GPU offloading：`gpu_layers=32`；
- Cloud LLM：API 服务；
- 测试的 Cloud 模型：GPT-4o、Qwen3-235B；
- 测试的 Edge 模型：Phi-3.5-mini-3.5B、Qwen1.5-1.8B、StableLM-2-Zephyr-1.6B、TinyLLaMA-1.1B；
- Cloud 与 Edge 都采用 few-shot demonstration，分别构造 $D_{cloud}$ 与 $D_{edge}$。

#### 开源仓库补充的信息（不完全来自论文正文）

官方 GitHub README 给出的默认 pipeline 参数包括：

| 参数 | 默认值 |
|---|---:|
| `slm_n_gpu_layers` | 32 |
| `slm_n_ctx` | 2048 |
| `slm_n_batch` | 512 |
| `slm_temperature` | 0.7 |
| `slm_top_p` | 0.9 |
| `slm_max_tokens` | 512 |
| `epsilon_total` | 2.0 |
| `alpha` | 0.5 |
| `lambda_entropy` | 0.4 |

仓库还提供：

- `edge_detection.py`：Sensitivity Profiling；
- `soft_gating.py` / `train_soft_gating.py`：路由器；
- `two_layer_ldp.py`：两层 LDP；
- `cloud_sketch_generator.py`：云端 sketch；
- `edge_denoising.py`：边缘精修；
- `prism_pipeline.py`：Algorithm 1 的端到端实现；
- `windows_energy_monitor.py`：Windows/NVML 能耗测量；
- 训练好的 `soft_gating_pretrained.pth`。

一个值得关注的复现细节是：仓库 README 说明原始半合成数据的某些 split 无法完全重新分发，因此旅游/银行/通识部分提供的是“representative regenerated examples”，而医疗 40 条保留为原实验版本。这意味着**当前公开仓库与论文原始实验数据并非 100% 字节级一致**，复现实验时应对结果偏差有所预期。

---

## 5. 讨论与思考 (Discussion and Reflection)

### 优点与创新点 (Strengths & Innovations)

#### 5.1 系统视角比“再造一个隐私算法”更有价值

这篇工作的最大优点是，它没有把问题狭义地理解成“给 LLM prompt 加 DP”，而是把隐私当作一个**系统调度变量**。

现实流量本身具有不同隐私等级，因此先路由再保护，比“所有输入一刀切”更符合工程直觉。Table 1 中约 60% 的延迟/边缘能耗下降非常直观地说明：**很多性能收益其实来自避免不必要的隐私计算，而不是让某个隐私算子本身快 10%。**

#### 5.2 Semantic Sketch 是很好的云-边接口设计

我认为 semantic sketch 是论文中最有研究启发性的部分。

传统协作推理喜欢切 hidden states、embedding 或网络层，这会带来 tokenizer 对齐、模型架构兼容、通信张量大等问题。PRISM 传递的是自然语言/结构化文本 sketch，因此：

- 云/边模型可以来自不同家族；
- 不需要共享参数空间；
- 可以直接使用闭源 API LLM；
- sketch 本身天然是一种“信息压缩层”。

它把“隐私保护后的语义恢复”从纯 denoising 问题，变成了 **knowledge planning + local grounding** 问题，这个抽象非常值得继续发展。

#### 5.3 论文不仅报告质量，还测真实设备能耗

很多 LLM privacy 论文只给 accuracy/privacy，而忽略端侧成本。PRISM 用真实 RTX 3070 Laptop 环境测 Joule 和 completion time，使论文更接近系统工作，而不是只在离线指标上论证。

#### 5.4 有理论保证，也有真实异构模型实验

作者至少对 two-layer LDP 给出了组合定理，并且测试 8 种 cloud-edge 组合，而不是只展示单一模型 pair。虽然实验规模仍有限，但比只在一个 API + 一个 SLM 上展示 demo 更扎实。

---

### 局限性与可商榷之处 (Limitations & Debatable Points)

#### 5.5 最核心的疑问：$\epsilon$ 分配的文字解释与标准 DP 直觉相反

如前文所述，Eq. (6)–(7) 中更大的 $\epsilon$ 会提高 randomized response 保留真实值的概率，因此是**更弱隐私**，而不是更强保护。

论文却多次把“高 $w$ -> 更大 $\epsilon_1$”解释为“更强 category-level protection / heavier category obfuscation”。这在数学语义上并不一致。

这件事非常重要，因为 Adaptive Two-Layer LDP 是全文的核心技术点之一。复现时应直接检查 `two_layer_ldp.py`，确认作者究竟想实现：

- 高敏实体隐藏 **category**；还是
- 高敏实体保留 category 以维持语义结构，但强烈隐藏 **value**。

按照论文公式，后者更接近真实行为。

#### 5.6 “实体级细粒度”仍依赖较粗的 NER + 人工权重

Sensitivity Profiling 的核心仍是：

- NER 是否识别到实体；
- 类别权重 $w_c$ 是否合理；
- 是否出现第一人称/person cue。

现实隐私并不总是标准 NER 实体。例如：

- “我最近总是凌晨三点醒来”；
- “我准备离婚但还没告诉家人”；
- “我欠了很多赌债”；
- “我正在服用某种药”。

这些句子可能极其敏感，但不一定稳定映射到 PERSON/LOCATION/ID 等传统实体类型。也就是说，PRISM 的 routing front-end 仍可能成为整个系统的单点失效源。

#### 5.7 LDP 保证是局部、条件性的，不应扩大解释成系统级“绝对隐私”

Two-Layer LDP 的 theorem 针对 collaborative 模式中**被选中的单个实体**。整个系统还有几个额外泄漏面：

- Cloud-only 本身没有隐私保护；
- 路由模式可能让云端/网络观察者获得“该请求属于何种风险等级”的侧信道；
- 多实体联合发布的总体 privacy budget 需要额外 composition 分析；
- prompt 的非实体语义仍可能泄露敏感意图；
- 论文没有用真实 linkage / re-identification attack 来量化攻击成功率。

因此，论文的“privacy guarantee”更准确地理解为：**collaborative 路径中的实体扰动机制具有形式化 LDP 上界**，而不是“整个 PRISM 服务对所有敏感信息都有统一 DP 保证”。

#### 5.8 实验数据集规模偏小，而且主要是半合成数据

160 条 prompt 对一个系统论文可以做 proof-of-concept，但难以覆盖：

- 长上下文；
- 多轮对话；
- 隐式身份泄漏；
- 多语言；
- 非标准文本；
- prompt injection；
- 多个敏感实体相互关联的复杂场景。

尤其是论文讨论 linkage attack，却没有真正构造一个攻击者做 re-identification 实验。理论 LDP 与真实 attack resistance 之间还缺一层实证闭环。

#### 5.9 GPT-4o 同时参与系统和评价，可能存在 judge 偏差

Inference Quality 由 GPT-4o 打分，而 GPT-4o 本身又是实验中的 cloud LLM 之一。LLM-as-a-Judge 已经是常用方法，但若没有：

- 人类评估；
- 第二个独立 judge；
- pairwise blind evaluation；

就难以排除模型风格偏好、自我偏好或长度偏好。对于只有 160 条样本的实验，这种偏差尤其值得关注。

#### 5.10 正文缺少真正的模块消融

PRISM 同时包含至少四个关键因素：

1. Sensitivity Profiling；
2. Soft Gating；
3. Adaptive Two-Layer LDP；
4. Semantic Sketch Collaboration。

但正文没有逐个移除它们。于是 Table 1 虽然证明“完整系统有效”，却不能回答“为什么有效到这个程度”。对于强调机制创新的论文，这部分证据链还不够完整。

#### 5.11 Table 2 自身暴露了模型兼容性问题

L1 + S4 的 IQ = 5.28 远低于其他组合。这说明当 edge SLM 太弱、或 cloud sketch 与 edge prompt 模板不匹配时，语义草图可能无法被正确还原。

因此未来如果 PRISM 真要用于异构设备，router 不应只看隐私，还应该纳入：

- 当前 edge model 的能力；
- 可用显存/电量；
- 网络 RTT；
- cloud model 类型；
- sketch-edge compatibility。

也就是说，下一代路由器应该从 **privacy-aware** 进一步升级到 **privacy + resource + model capability aware**。

---

### 未来工作与启发 (Future Work & Inspirations)

作者在结论中提出的下一步是扩展到**多边缘设备协同**，涉及 decentralized scheduling、load balancing 和 federated optimization。这是一个自然方向，但我认为还有几条更值得深入的研究路线。

#### 方向一：把隐私 profiling 从规则/N​​ER 升级为语义风险模型

可以训练一个轻量 privacy encoder，直接预测：

- identity leakage risk；
- health/finance risk；
- contextual sensitivity；
- attribute inference risk；
- linkage risk。

同时保留可解释的实体级 span，以便后续 DP 机制知道“具体要保护哪一段”。这会比“NER + 第一人称”覆盖更多隐式隐私。

#### 方向二：学习隐私预算，而不是手工公式分配

目前 $\epsilon_1/\epsilon_2$ 由 $w_c$ 和 $\alpha$ 决定。更进一步，可以把预算分配做成 constrained optimization：

$$
\max \; \text{Utility}(P^*)
$$

subject to

$$
\text{PrivacyRisk}(P^*)\le\tau,\qquad
\text{Energy}\le E_{max}
$$

这样预算不再只取决于实体类型，也能考虑当前任务、模型、设备和网络状态。

#### 方向三：把 semantic sketch 变成可验证的中间表示

现在 sketch 是自由文本/结构化文本，仍可能：

- 泄露隐私；
- 丢失关键约束；
- 被 edge SLM 误解。

可以设计一个 schema-constrained IR，例如 JSON / DSL：

```json
{
  "task": "travel_plan",
  "constraints": ["6_days", "budget_limited"],
  "knowledge_slots": ["transport", "lodging", "attractions"],
  "private_slots": ["LOCAL_ONLY_PERSON", "LOCAL_ONLY_BUDGET"]
}
```

让云端只能生成非私有字段，边缘端再绑定 private slots。这样会更可控，也更容易做形式化泄漏分析。

#### 方向四：真正评测“攻击成功率”

除了 IQ/latency/energy，建议加入：

- entity reconstruction accuracy；
- re-identification success rate；
- attribute inference attack；
- membership inference；
- linkage attack across multiple prompts；
- malicious cloud model / honest-but-curious cloud 两种 threat model。

这会把“理论 ε-LDP”与“现实攻击者到底能不能把用户认出来”连接起来。

#### 方向五：多轮对话中的累计隐私预算

真实聊天不是一条 prompt，而是连续几十轮。即使每轮都满足某个 $\epsilon$，多轮交互会不断 composition。更麻烦的是，攻击者可以把多轮中不同的弱线索拼起来。

因此值得研究：

- user/session-level privacy accountant；
- 跨轮动态 budget；
- 历史敏感实体缓存；
- 当累计泄漏达到阈值时自动切到 edge-only。

---

### 可以继续追问的几个问题

- 🤔 **Eq. (6) 的 $\epsilon$ 分配是不是写反了？如果交换 $\epsilon_1$ 和 $\epsilon_2$，实验会发生什么？**
- 🔐 **PRISM 对“不是 NER 实体的隐私”是否有效，例如政治倾向、心理状态、行为习惯或间接身份线索？**
- 🧪 **如果删除 semantic sketch，只让云端对 $P^*$ 直接回答，再由边缘修复，IQ 会下降多少？**
- ⚡ **如果把云端真实 GPU 能耗也计入，PRISM 与 Edge-only / Cloud-only 的系统级能源结论会不会变化？**
- 🧩 **L1 + S4 为什么会从约 7 分掉到 5.28？是 TinyLLaMA 能力不足，还是 sketch/prompt compatibility 出问题？**
- 📚 **在多轮聊天里，如何做 session-level 的 DP composition，而不是只保护单个实体、单个请求？**
- 🧠 **能否把 routing 变成一个多目标策略：同时最小化 privacy leakage、latency、energy、API cost，并满足回答质量下限？**

---

**总体阅读结论：** PRISM 是一篇很典型也很有价值的“系统 + 隐私机制”工作。它最强的地方不是提出了一个复杂的新模型，而是重新组织了云端大模型、边缘小模型和隐私机制之间的职责边界：**低风险任务不要白白付隐私成本，中风险任务让云端只做抽象推理，高风险任务留在本地。** 这种设计在实际 LLM 服务中非常有工程意义。与此同时，论文在 DP 预算解释、严格模块消融、攻击评测和大规模真实数据验证上仍有明显空间，尤其是 Eq. (6)–(7) 与文字描述之间的方向性矛盾，值得复现者重点核查。
