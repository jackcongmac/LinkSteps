# LinkSteps Senior: Backend & Data Architecture PRD

## 1. 数据接入策略 (Data Ingestion Strategy: Asymmetric OAuth)
为了实现长辈端的"零操作"，后端必须支持异步云端授权机制，彻底剥离蓝牙物理配对的复杂性。

* **数据源接口 (Data Sources)**:
    * **Level A (基础通用)**: 微信运动 API (WeRun)、Apple HealthKit (基础活动数据)。
    * **Level B (厂商云端)**: 华为 Health Kit Cloud API、小米开放平台、Zepp OS API。
* **接入流程 (The "Magic Link" Flow)**:
    1.  晚辈端向后端请求生成一个带有 `session_id` 的一次性 OAuth 授权链接。
    2.  长辈在微信或短信中点击链接，跳转至厂商云（如华为健康）的 OAuth 2.0 授权页。
    3.  长辈点击"同意"后，厂商云回调 LinkSteps 后端 (`/api/auth/callback`)。
    4.  后端加密存储 `Access Token` 和 `Refresh Token`，并启动定期轮询（Cron Job）或 Webhook 监听，实现无感数据同步。

---

## 2. 三层数据信息架构 (The 3-Tier Data IA)
后端数据库设计与 AI 引擎 (`SeniorPredictor`) 必须对数据进行严格分层。每一层的数据决定了 AI 预判的深度和触达晚辈的话术策略。

### 🟢 基础层 (Tier 1: Context & Activity)
**定义**：最易获取、覆盖率最高的数据，用于构建长辈当天的"生活画布"与环境关怀。
* **核心字段**:
    * `steps` (步数：反映基础活力与是否离家)
    * `location_coarse` (粗略定位：市/区级别，用于获取天气)
    * `weather_context` (第三方 API：实时气温、气压 `pressure_hpa`、极端天气预警)
    * `first_active_time` (设备今日首次活跃时间：推断起床节律)
* **IA 目标**：防失联与日常环境关怀（如：下雨天步数少，判定为正常居家）。

### 🟡 感知层 (Tier 2: Vitals & Wellness)
**定义**：通过智能手环获取的生理状态数据，用于评估长辈的"真实体感"和隐性疲劳。
* **核心字段**:
    * `resting_heart_rate` (静息心率：评估基础身体负荷)
    * `sleep_duration` (总睡眠时间) & `deep_sleep_ratio` (深度睡眠比例：心血管风险参考)
    * `hrv_baseline_deviation` (HRV 基线偏离度：评估压力与恢复状态)
* **IA 目标**：后端需维护 `7-day-rolling-average` (7天滚动均值)。AI 通过对比当日数据与基线，预判长辈的疲劳度或免疫力波动窗口。

### 🔴 医疗参考层 (Tier 3: Clinical Reference & Emergency)
**定义**：通过高阶适老化手表获取的类医疗数据。**此层数据对日常状态仅作后端 AI 的隐性参考 (Refinance)，严禁直接对用户输出医疗诊断口吻。**
* **核心字段**:
    * `body_temperature_trend` (体表温度波动)
    * `blood_pressure_trend` (血压收缩/舒张趋势)
    * `fall_detection_event` (跌倒事件 - Boolean)
* **IA 目标**：红线干预与状态翻译。
    * **隐性参考**：若血压波动，AI 输出"长辈体征数据略有波动，建议提醒按时服药"，而非"高血压发作"。
    * **最高指令 (The SOS Override)**：若 `fall_detection_event === true`，立刻切断常规延迟分析，通过 WebSockets 强行向所有关联晚辈端推送最高级别告警（Rose Alert）。

---

## 3. AI 状态感知与决策逻辑 (AI Inference Logic)
后端的推理引擎 (`evaluateSeniorState()`) 将依据收集到的数据层级，输出对应的关怀状态与话术。

| 触发条件 (后端判定逻辑) | 依赖数据层级 | 输出状态 (Status) | 晚辈端 AI 关怀话术 (示例) |
| :--- | :--- | :--- | :--- |
| **节律平稳** (指标在基线内) | Tier 1 + Tier 2 | **Emerald (翡翠绿)** | *"爸今天睡得不错，上海阳光明媚，他已经出门散步了。"* |
| **轻度偏离** (步数骤降 OR 睡眠变浅) | Tier 1 + Tier 2 | **Amber (琥珀色)** | *"妈这两天活动量偏低，睡眠较浅。建议今晚视频聊聊家常。"* |
| **双重承压** (气压剧降 + 静息心率异常) | Tier 1 + Tier 2 (+ Tier 3) | **Rose (玫瑰红-关注)** | *"⚠️ 气压骤降，且监测到父亲体征异动，关节可能不适，请致电确认。"* |
| **紧急跌倒** (`fall_event: true`) | Tier 3 (Emergency) | **CRITICAL SOS** | *"🚨 紧急预警：设备检测到意外跌倒，请立刻启动应急联络！"* |

## 4. 合规与大模型边界护栏 (Compliance & Guardrails)
在调用 LLM 生成 Custom Insight 时，后端必须注入以下 System Prompt 约束：
1.  **禁止行医 (No Medical Diagnosis)**: 严禁使用临床疾病名称（如高血压、心律不齐等），所有异常均翻译为"体征波动"、"略显疲态"等中性词汇。
2.  **动作导向 (Action-Oriented)**: 所有的异常提醒，必须附带一个给晚辈的"轻量级动作建议"（如：发个表情包、打个视频、提醒喝水加衣）。
