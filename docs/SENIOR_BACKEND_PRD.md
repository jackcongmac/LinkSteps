# LinkSteps Senior: Backend & Data Architecture PRD

> **最后更新**：2026-03-31（反映 v0.4 实现状态）

---

## 1. 数据接入策略 (Data Ingestion Strategy: Asymmetric OAuth)

为了实现长辈端的"零操作"，后端必须支持异步云端授权机制，彻底剥离蓝牙物理配对的复杂性。

### 数据源接口 (Data Sources)
- **Level A（基础通用）**：微信运动 API (WeRun)、Apple HealthKit（基础活动数据）
- **Level B（厂商云端）**：华为 Health Kit Cloud API、小米开放平台、Zepp OS API

### 接入流程 ("Magic Link" Flow)
1. 晚辈端向后端请求生成一个带有 `session_id` 的一次性 OAuth 授权链接
2. 长辈在微信或短信中点击链接，跳转至厂商云 OAuth 2.0 授权页
3. 长辈点击「同意」后，厂商云回调 LinkSteps 后端 (`/api/auth/callback`)
4. 后端加密存储 Access Token + Refresh Token，启动定期轮询（pg_cron）或 Webhook 监听

> **当前状态**：Phase 1 使用 `health-simulator.ts` 模拟数据。OAuth 接入预留 `device_connections` 表，Phase 2 实现。

---

## 2. 三层数据信息架构 (The 3-Tier Data IA)

后端数据库设计与 AI 引擎 (`SeniorPredictor`) 必须对数据进行严格分层。

### 🟢 基础层 (Tier 1: Context & Activity)
**定义**：最易获取、覆盖率最高的数据，用于构建长辈的"生活画布"与环境关怀。

**核心字段**：
- `steps`：步数，反映基础活力与是否离家
- `location_coarse`：粗略定位（市/区），用于获取天气
- `weather_context`：第三方 API — 实时气温、气压 `pressure_hpa`、极端天气预警
- `first_active_time`：设备今日首次活跃时间，推断起床节律

**IA 目标**：防失联与日常环境关怀（如：下雨天步数少，判定为正常居家）

### 🟡 感知层 (Tier 2: Vitals & Wellness)
**定义**：通过智能手环获取的生理状态数据，用于评估长辈的"真实体感"和隐性疲劳。

**核心字段**：
- `resting_heart_rate`：静息心率，评估基础身体负荷
- `sleep_duration` + `deep_sleep_ratio`：睡眠质量，心血管风险参考
- `hrv_baseline_deviation`：HRV 基线偏离度，评估压力与恢复状态

**IA 目标**：后端维护 `7-day-rolling-average`，AI 通过对比当日数据与基线预判疲劳度

### 🔴 医疗参考层 (Tier 3: Clinical Reference & Emergency)
**定义**：通过高阶适老化手表获取的类医疗数据。**严禁直接对用户输出医疗诊断口吻。**

**核心字段**：
- `body_temperature_trend`：体表温度波动
- `blood_pressure_trend`：血压收缩/舒张趋势
- `fall_detection_event`：跌倒事件 Boolean

**IA 目标**：
- **隐性参考**：血压波动 → 输出「长辈体征数据略有波动，建议提醒按时服药」，非「高血压发作」
- **最高指令 (SOS Override)**：`fall_detected === true` → 立即切断常规分析，Realtime 推送全屏告警

---

## 3. AI 状态感知与决策逻辑

### 3-A 状态判定表

| 触发条件 | 依赖数据层级 | 输出状态 | 晚辈端展示示例 |
|---|---|---|---|
| **节律平稳**（指标在基线内） | Tier 1 + 2 | **Emerald 🟢** | 「爸今天睡得不错，上海阳光明媚，他已经出门散步了。」 |
| **轻度偏离**（步数骤降 OR 睡眠变浅） | Tier 1 + 2 | **Amber 🟡** | 「妈这两天活动量偏低，睡眠较浅。建议今晚视频聊聊家常。」 |
| **双重承压**（气压剧降 + 静息心率异常） | Tier 1 + 2 (+3) | **Rose 🔴** | 「⚠️ 气压骤降，且监测到父亲体征异动，关节可能不适，请致电确认。」 |
| **紧急跌倒**（`fall_event: true`） | Tier 3 Emergency | **SOS 🚨** | 「🚨 紧急预警：设备检测到意外跌倒，请立刻启动应急联络！」 |
| **实时心率异常**（`heart_rate > 120`） | health_metrics | **实时红色** | StatusHeader 变红 + 「立即拨打妈妈」+ 自动写 alert 记录 |

### 3-B WellnessScore 规则引擎（wellness-score.ts）

评分 0–100，按优先级逐项扣分：

| 指标 | 权重 | 临界值 | 扣分触发 |
|---|---|---|---|
| HRV | 50% | 降幅 ≥35% 基线 → critical；≥20% → care | 最大权重 |
| 深度睡眠 | 15% | < 1 小时 → critical | 高阶设备才有 |
| 气压 | 15% | < 1010 hPa → care（关节风险） | Tier 1，始终可用 |
| 步数 | 20% | < 50% 基线 → care | Tier 1，始终可用 |

Level 输出：`great`(80–100) / `good`(60–79) / `alert`(40–59) / `critical`(0–39)

### 3-C AI 气象洞察（generateInsight，规则引擎）

输入 `WeatherPayload`，输出一句关怀提醒：

| 气压 | 触发 | 示例输出 |
|---|---|---|
| < 1005 hPa | 骤降 | 「气压突降（XXX hPa），可能引起关节不适，建议注意保暖休息。」 |
| < 1010 hPa | 偏低 | 「气压偏低，适合轻度室内活动。天气X，出门记得加外套。」 |
| temp_max ≥ 28°C | 高温 | 「今日气温偏高，多补水、避免午后高温外出。」 |
| temp_min ≤ 10°C | 偏凉 | 「今日气温偏凉，出门前多加衣物。」 |
| 默认 | — | 「今日天气条件良好，适合外出散步。」 |

---

## 4. 合规与大模型边界护栏

在使用规则引擎或调用 LLM 生成 Custom Insight 时，必须遵守：

1. **禁止行医**：严禁使用临床疾病名称（高血压、心律不齐等），所有异常翻译为「体征波动」、「略显疲态」等中性词汇
2. **动作导向**：所有异常提醒，必须附带一个给晚辈的轻量级动作建议（发表情包/打视频/提醒喝水加衣）
3. **不透传原始数据**：Tier 3 原始数值（血压、体温）禁止出现在任何 API 响应或前端界面
4. **SOS 不可防抖**：跌倒事件推送不经过任何延迟队列

---

## 5. 实时数据流架构

```
长辈设备（health-simulator / 真实 OAuth）
    ↓ INSERT
health_metrics（heart_rate / steps）
    ↓ Supabase Realtime broadcast
晚辈端 CarerDashboard
    ↓ useEffect 订阅
StatusHeader：计算 isDormant / isOffline / isAnomaly
    ↓ isAnomaly 边界 false→true
handleAnomaly()：INSERT messages（type='alert'）
    ↓ Realtime broadcast
FamilyTimeline：新增红色 ⚠️ 警报条目
```

```
长辈点击平安扣
    ↓ POST /api/senior/checkin
checkins 表 INSERT
    ↓ Supabase Realtime broadcast
晚辈端 FamilyTimeline：实时新增「发送了平安信号」
```

---

## 6. 数据库 Schema（完整，截至 2026-03-31）

### 迁移历史

| 文件 | 日期 | 内容 |
|---|---|---|
| `20260326_senior_module.sql` | 2026-03-26 | 7 张核心表：senior_profiles, carer_relationships, health_snapshots, senior_baselines, ai_assessments, device_connections, checkins |
| `20260330_messages.sql` | 2026-03-30 | messages 表（text/voice 类型）；RLS；Realtime |
| `20260331_health_metrics_realtime.sql` | 2026-03-31 | health_metrics 表 Realtime 启用 |
| `20260401000000_senior_profile_fields.sql` | 2026-04-01 | senior_profiles 新增：age, gender, relationship, custom_relation |
| `20260401000001_retention_7days.sql` | 2026-04-01 | pg_cron 7天数据保留（messages + checkins） |
| `20260401000002_senior_profile_update_policy.sql` | 2026-04-01 | senior_profiles UPDATE RLS 政策（created_by = auth.uid()） |
| `20260401000003_messages_sender_name.sql` | 2026-04-01 | messages 新增 sender_name 字段（冗余，避免跨用户 RLS） |
| `20260401000004_messages_alert_type.sql` | 2026-04-01 | messages type CHECK 扩展：新增 'alert' 类型 |

### 关键 RLS 政策汇总

| 表 | 政策 | 规则 |
|---|---|---|
| `senior_profiles` | SELECT | creator OR carer in carer_relationships |
| `senior_profiles` | UPDATE | `created_by = auth.uid()` |
| `checkins` | SELECT | senior created_by = auth.uid() |
| `checkins` | INSERT | senior created_by = auth.uid() |
| `messages` | SELECT | senior created_by = auth.uid() OR in carer_relationships |
| `messages` | INSERT | sender_id = auth.uid() AND linked to senior |
| `messages` | UPDATE | senior created_by = auth.uid()（仅 is_read/read_at） |
| `health_metrics` | SELECT | senior created_by = auth.uid() |

---

## 7. 存储架构 (Supabase Storage)

```
voice-memos/
└── {seniorId}/
    └── {messageId}.webm   (or .mp4)
```

- **上传路径**：长辈端 VoiceRecorder 直接 client-side 上传
- **下载**：通过 `createSignedUrl(path, 60)` 生成 60s 有效期签名 URL
- **清理**：7天数据保留政策目前仅覆盖 DB records；Storage 文件清理待实现

---

## 8. 开发工具

### health-simulator.ts
- 每 30 秒向 `health_metrics` 插入模拟心率（70–130 bpm，含随机 spike）+ 步数
- 模拟睡眠状态：23:00–06:00 深睡/浅睡，12:00–15:00 午睡
- 仅 seniorId 解析后启动，组件卸载自动停止

### pg_cron 数据保留任务
```sql
-- 每日 03:00 UTC (11:00 北京时间)
DELETE FROM messages  WHERE created_at  < NOW() - INTERVAL '7 days';
DELETE FROM checkins  WHERE checked_in_at < NOW() - INTERVAL '7 days';
```
