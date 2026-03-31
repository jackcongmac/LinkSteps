# LinkSteps Senior — Product Information Architecture

> **战略基调**："关怀，不是监管"
> 本文档是 Senior 模块的产品蓝图，供 Architect / Frontend / QA 三端对齐使用。
> 依据：`SENIOR_VISION.md` + `SENIOR_BACKEND_PRD.md`

---

## 0. 角色体系 (Role System)

| Role | 中文 | 核心任务 | UI 风格 |
|---|---|---|---|
| `senior` | 长辈 | 发送平安信号 / 接收语音关怀 | 极简、无数字、无焦虑 |
| `carer` | 晚辈 | 读取 AI 解读 / 触发关怀动作 | 全知看板、行动导向 |
| `admin_carer` | 主要晚辈 | 以上 + 管理设备授权 / 成员 | 同上 + 设置权限 |

> 角色存储在 `profiles.role`，已有 `teacher/therapist/parent` 体系。
> Senior 模块新增 `senior` 和 `carer` 两个 role value。

---

## 1. 双端屏幕地图 (Screen Map)

### 1-A 长辈端 (Senior UI) — 极简、单任务

```
/senior-home
│
├── [主屏] 平安扣 (Peace Button)
│     ├── 巨型圆形按钮，整屏点击区
│     ├── 默认状态：绿色"我很好"
│     └── 点击后：动画 + 发送 check-in 信号
│
├── [语音信箱] Voice Inbox
│     ├── 列表：晚辈发来的语音/TTS 消息
│     └── 一键播放（无需打字）
│
└── [极简设置] Settings (隐藏入口)
      └── 仅显示"退出登录"
```

**长辈端 UI 铁律：**
- 不显示任何健康数字（步数、心率等）
- 不显示任何"警告"或"异常"状态
- 字体 ≥ 20px，点击区 ≥ 60×60px
- 背景纯白，单色，无渐变

---

### 1-B 晚辈端 (Carer UI) — 全知看板

```
/carer
│
├── [首页] Dashboard  ← 核心页
│     ├── 顶部：用户问候 + 今日日期
│     ├── SeniorStatusCard × N（每位长辈一张）
│     │     ├── 状态徽章：🟢 Emerald / 🟡 Amber / 🔴 Rose / 🚨 SOS
│     │     ├── AI 解读句：「爸今天睡得不错，已出门散步」
│     │     ├── 最后活跃时间
│     │     └── 快捷动作：[发消息] [拨打电话]
│     └── 右上角：通知铃（SOS 红点）
│
├── [长辈详情] /carer/senior/[seniorId]
│     ├── Header：姓名 + 当前状态 + 城市天气
│     ├── AI Insight Card（完整版，含建议动作）
│     ├── 数据面板（按 Tier 分组，文字化呈现）
│     │     ├── Tier 1 — 生活画布
│     │     │     ├── 今日步数（配文字描述，不单纯显示数字）
│     │     │     ├── 天气上下文（气压 + 体感）
│     │     │     └── 首次活跃时间（起床节律）
│     │     ├── Tier 2 — 体感状态（需手环，Phase 2）
│     │     │     ├── 睡眠质量（「睡得较浅」而非「5.2h deep sleep」）
│     │     │     └── HRV 趋势（「恢复状态良好」）
│     │     └── Tier 3 — 仅后端使用，不对晚辈直接显示原始值
│     └── 历史轴：过去 7 天 AI 状态变化
│
├── [关怀动作] /carer/connect/[seniorId]
│     ├── 发送语音消息（TTS 合成，老人端可播放）
│     ├── 发起视频通话（外链微信/FaceTime）
│     └── 发送关怀便签（文字 → TTS → 推送至老人端）
│
├── [历史洞察] /carer/insights
│     ├── 时间线：每日 AI 评估记录
│     └── 状态趋势图（Emerald→Amber→Rose 颜色条）
│
└── [设置] /carer/settings
      ├── 我的长辈（添加 / 管理）
      │     └── 生成 Magic Link → 发送至长辈微信
      ├── 设备管理（已授权设备列表）
      └── 通知偏好（SOS 必开，其余可配）
```

---

## 2. 核心用户旅程 (Key User Journeys)

### Journey A — 晚辈首次添加长辈

```
晚辈进入 Settings → 点击「添加长辈」
→ 填写姓名 + 选择城市
→ 系统生成一次性 Magic Link（含 session_id）
→ 晚辈将链接发送至长辈微信 / 短信
→ 长辈点击链接 → 跳转至设备厂商 OAuth 授权页（华为/小米等）
→ 长辈点击「同意」→ 后端 /api/auth/callback 接收 token
→ 后端静默存储 Access Token + Refresh Token
→ 晚辈端 Dashboard 出现新的 SeniorStatusCard ✅
```

### Journey B — 晚辈早晨查看状态（最高频场景）

```
晚辈打开 App → Dashboard 自动加载
→ SeniorStatusCard 显示 AI 状态（🟢 平稳 / 🟡 关注）
→ 点击卡片 → 进入详情页
→ 阅读 AI 解读句（「妈今天活动量偏低，睡眠较浅…」）
→ 点击「发消息」→ 录制语音 → 发送至长辈语音信箱
```

### Journey C — 长辈发送平安信号

```
长辈打开 App → 看到绿色平安扣
→ 点击 → 动画反馈（波纹扩散）
→ 所有晚辈收到推送：「妈妈 09:32 发来了平安信号 💚」
```

### Journey D — 紧急 SOS（跌倒检测）

```
设备检测到 fall_detection_event = true
→ 后端立即触发 SOS Override（跳过 AI 分析队列）
→ WebSocket / Push 推送至所有关联晚辈
→ 晚辈 App 弹出全屏 Rose Alert：
   「🚨 紧急预警：设备检测到意外跌倒，请立刻启动应急联络！」
→ 提供快捷操作：[拨打长辈电话] [联系紧急联系人]
```

---

## 3. 数据架构对齐 (Data Architecture)

### 3-A 数据库表 (Supabase)

```sql
-- 长辈档案
senior_profiles (
  id uuid PK,
  carer_id uuid FK → profiles.id,   -- 主要晚辈
  name text,
  city text,                          -- 用于天气 API
  created_at timestamptz
)

-- 晚辈与长辈的关系（支持一个长辈多个晚辈）
carer_relationships (
  id uuid PK,
  senior_id uuid FK → senior_profiles.id,
  carer_id  uuid FK → profiles.id,
  role text,                          -- 'primary' | 'secondary'
  created_at timestamptz
)

-- 每日健康快照（Tier 1 + Tier 2）
health_snapshots (
  id uuid PK,
  senior_id uuid FK,
  snapshot_date date,
  -- Tier 1
  steps int,
  first_active_time timestamptz,      -- 首次亮屏/活动时间
  weather_pressure_hpa float,
  weather_temp_c float,
  weather_text text,
  -- Tier 2（可为 null，视设备而定）
  resting_heart_rate int,
  sleep_duration_hours float,
  deep_sleep_hours float,
  hrv_ms float,
  -- Tier 3（可为 null，仅后端 AI 参考）
  body_temp_celsius float,
  systolic_bp int,
  diastolic_bp int,
  fall_detected boolean DEFAULT false,
  created_at timestamptz
)

-- 7天滚动基线（后端 cron 维护）
senior_baselines (
  senior_id uuid PK,
  avg_steps float,
  avg_hrv float,
  avg_sleep_hours float,
  avg_resting_hr float,
  computed_at timestamptz
)

-- AI 评估结果（持久化，用于历史趋势）
ai_assessments (
  id uuid PK,
  senior_id uuid FK,
  assessed_at timestamptz,
  status text,                        -- 'emerald' | 'amber' | 'rose' | 'sos'
  insight_text text,                  -- AI 生成的关怀句
  action_suggestion text,             -- 给晚辈的行动建议
  data_tier int,                      -- 1 | 2 | 3，本次依赖的最高层级
  created_at timestamptz
)

-- 设备 OAuth 凭据（加密存储）
device_connections (
  id uuid PK,
  senior_id uuid FK,
  vendor text,                        -- 'huawei' | 'xiaomi' | 'apple' | 'werun'
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz
)

-- 平安扣 Check-in 事件
checkins (
  id uuid PK,
  senior_id uuid FK,
  checked_in_at timestamptz,
  source text                         -- 'button' | 'auto_active'
)

-- 语音消息（晚辈 → 长辈）
voice_messages (
  id uuid PK,
  from_carer_id uuid FK,
  to_senior_id  uuid FK,
  text_content text,                  -- 原始文字（TTS 源）
  audio_url text,                     -- Supabase Storage 链接
  is_read boolean DEFAULT false,
  created_at timestamptz
)
```

### 3-B AI 状态判定逻辑（引用 PRD）

| 状态 | 颜色 | 触发条件 | 晚辈端展示 |
|---|---|---|---|
| **Emerald** | 🟢 翡翠绿 | 所有指标在基线内 | 「爸今天睡得不错，已出门散步」 |
| **Amber** | 🟡 琥珀色 | 步数骤降 OR 睡眠变浅 | 「妈这两天活动量偏低，建议视频聊聊」 |
| **Rose** | 🔴 玫瑰红 | 气压剧降 + 静息心率异常 | 「⚠️ 气压骤降，体征异动，请致电确认」 |
| **SOS** | 🚨 紧急 | `fall_detected = true` | 全屏弹窗，WebSocket 立即推送 |

---

## 4. API 路由合约 (API Contract)

```
POST /api/senior/create              → 创建 senior_profile + 返回 Magic Link
GET  /api/senior/[id]/status         → 最新 AI assessment（晚辈端实时拉取）
POST /api/senior/[id]/checkin        → 处理平安扣点击
GET  /api/senior/[id]/history        → 历史 ai_assessments 列表

GET  /api/weather?city=beijing       → QWeather 代理（已实现 ✅）

POST /api/auth/device/initiate       → 生成 OAuth Magic Link（带 session_id）
GET  /api/auth/device/callback       → 厂商 OAuth 回调，存储 token

POST /api/health/sync/[seniorId]     → 手动触发单个长辈数据同步（dev 用）
     /api/health/sync (Cron Job)     → 定时批量拉取所有活跃 senior 的数据

POST /api/messages/send              → 晚辈发送语音/TTS 消息至长辈
GET  /api/messages/[seniorId]        → 长辈拉取未读消息列表
```

---

## 5. 前端组件树 (Component Inventory)

```
src/components/senior/
│
├── carer/
│   ├── SeniorStatusCard.tsx        ← Dashboard 核心卡片
│   ├── SeniorDetailPanel.tsx       ← 详情页数据面板
│   ├── AiInsightCard.tsx           ← AI 解读 + 行动建议
│   ├── HealthTierSection.tsx       ← Tier 1/2 数据行（文字化）
│   ├── StatusBadge.tsx             ← Emerald/Amber/Rose/SOS 徽章
│   ├── SeniorTimeline.tsx          ← 7 天历史状态轴
│   └── SosAlert.tsx                ← 全屏紧急弹窗
│
├── senior/
│   ├── PeaceButton.tsx             ← 巨型平安扣（长辈主屏核心）
│   ├── VoiceInbox.tsx              ← 语音消息列表
│   └── VoiceMessageItem.tsx        ← 单条消息 + 播放控件
│
└── shared/
    ├── WeatherBadge.tsx            ← 城市 + 天气 + 气压状态（已有原型）
    └── MagicLinkSheet.tsx          ← 生成/分享设备授权链接的 bottom sheet
```

---

## 6. Phase 1 MVP 交付范围

**原则：数据可 mock，但完整用户旅程必须跑通。**

| 模块 | Phase 1 MVP 内容 | 数据来源 |
|---|---|---|
| 长辈端主屏 | 平安扣按钮 + 发送 check-in | Supabase 写入 |
| 晚辈端 Dashboard | SeniorStatusCard，显示 AI 状态 | mock metrics → SeniorPredictor |
| 天气集成 | 城市天气 + 气压状态 | QWeather API ✅ |
| AI 评估引擎 | Tier 1 规则引擎 (senior-predictor.ts) | mock + weather ✅ |
| 设备授权流程 | Magic Link 生成 + 展示（不对接真实 OAuth，Phase 1 用 mock token） | — |
| 历史趋势 | 7 天状态时间线（数据可 seed） | Supabase |
| SOS 告警 | 基础 push 通知（Phase 1 可用 polling，Phase 2 换 WebSocket） | Supabase Realtime |
| 语音消息 | Phase 1 暂缓，先做文字消息 → Phase 2 升级 TTS | — |

---

## 7. 技术约束与安全护栏

1. **RLS 强制隔离**：晚辈只能查询与自己有 `carer_relationships` 关联的 senior 数据。
2. **Tier 3 数据仅后端可见**：`health_snapshots` 中的血压、体温字段，前端 API 不返回原始值，只返回 AI 翻译后的文字。
3. **AI 输出护栏**（见 PRD §4）：禁止输出临床疾病名称，所有异常翻译为中性词汇，必须附带轻量级行动建议。
4. **Token 加密**：`device_connections.access_token_encrypted` 使用 Supabase Vault 或 AES-256 加密存储，禁止明文入库。
5. **SOS 不可被防抖**：跌倒事件推送不经过任何延迟队列，直接走 Supabase Realtime broadcast。

---

## 8. 与现有 Child 模块的共存策略

| 维度 | Child 模块 | Senior 模块 | 共存方案 |
|---|---|---|---|
| 路由 | `/log`, `/insights`, `/settings` | `/senior-home`, `/carer`, `/carer/settings` | 路由隔离，Role-based redirect |
| 组件 | `MoodCard`, `RecentLogs` 等 | `PeaceButton`, `SeniorStatusCard` 等 | 独立目录，无交叉 |
| 数据库 | `logs`, `profiles` | 新增 `senior_profiles` 等 7 张表 | Supabase 同一项目，RLS 隔离 |
| AI 引擎 | `predictor.ts` (Child) | `senior-predictor.ts` (Senior) | 独立文件，共享 `THREAT_STYLE` 常量 |
| 认证 | Supabase Magic Link | 同左 | 统一 Auth，role 字段区分流向 |
