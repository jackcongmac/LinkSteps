# LinkSteps Senior — Product Information Architecture

> **战略基调**："关怀，不是监管"
> 本文档是 Senior 模块的产品蓝图，供 Architect / Frontend / QA 三端对齐使用。
> 依据：`SENIOR_VISION.md` + `SENIOR_BACKEND_PRD.md`
> **最后更新**：2026-03-31（反映 v0.4 实现状态）

---

## 0. 角色体系 (Role System)

| Role | 中文 | 核心任务 | UI 风格 |
|---|---|---|---|
| `senior` | 长辈 | 发送平安信号 / 接收晚辈消息 / 语音留言 | 极简、大字体、无数字、无焦虑 |
| `carer` | 晚辈 | 读取健康状态 / 查看动态 / 发送关怀消息 | 全知看板、行动导向 |
| `admin_carer` | 主要晚辈 | 以上 + 管理长辈档案 / 成员 | 同上 + 设置权限 |

> 角色存储在 `profiles.role`。Senior 模块新增 `senior` 和 `carer` 两个 role value。

---

## 1. 双端屏幕地图 (Screen Map)

### 1-A 长辈端 (Senior UI) — 极简、单任务

```
/senior-home
│
├── [主屏] 顶部信息卡
│     ├── 北京时间时钟（大字，实时刷新）
│     ├── 天气（图标 + 温度 + 气压条 + 今日范围）
│     ├── AI 气象洞察（一句话，关怀口吻）
│     └── [有未读消息时] 晚辈最新消息 + 发件人名 + 时间 + 已读按钮
│
├── [主屏] 平安扣 (Peace Button)
│     ├── 巨型绿色圆形按钮（256px），全屏呼吸动画
│     ├── 点击：发送 check-in 信号 → 显示"已通知 [晚辈名]"
│     └── Fire-and-forget：UI 始终成功，失败静默 log
│
└── [操作区]
      ├── 语音留言 (VoiceRecorder)：录音 ≤60s → 上传 → 发给晚辈
      └── 快捷请求 (QuickRequest)：
            ├── 「给我回个微信」→ 插入 __WECHAT_REQUEST__ 标记
            └── 「给我回个电话」→ 插入 __CALL_REQUEST__ 标记
```

**长辈端 UI 铁律：**
- 不显示任何健康数字（步数、心率、气压值等原始数字不在主界面出现）
- 不显示任何"警告"或"异常"状态
- 字体 ≥ 18px，点击区 ≥ 60×60px
- 背景 `bg-stone-50`，白色卡片，无渐变

---

### 1-B 晚辈端 (Carer UI) — 全知看板

```
/carer
│
├── [顶部信息卡] EnvTile（晚辈侧）
│     ├── 上海本地时钟 + 时段（早晨/上午/下午…）
│     ├── 上海天气（图标 + 温度 + 气压条）
│     └── AI 天气洞察（一句话，提醒晚辈关怀长辈）
│
├── [发消息] ComposeMessage
│     └── 最多 100 字；发送时携带 sender_name（关系称谓 > 名字 > 邮箱前缀）
│
├── [状态卡] StatusHeader（实时心率环 + 在线状态）
│     ├── 正常：翠绿呼吸环 + 「一切安好」
│     ├── 休眠：灰色 + 「平安扣休眠中」
│     ├── 信号断开：琥珀色 + 时间戳
│     └── 心率异常（>120 bpm）：红色环 + 「立即拨打」按钮 + 自动写入 alert 记录
│
├── [睡眠洞察] SleepInsightsCard
│     └── 今日睡眠时长 + 状态（deep/light/nap/resting/awake）
│
├── [AI 健康洞察] WellnessCard
│     └── 综合步数 + 心率 + 睡眠 + 气象的规则引擎输出
│
├── [长辈身份卡片] SeniorIdentityTile → 跳转 /carer/profile
│     └── 名字 + 年龄 + 性别 + 设备连接状态
│
└── [平安扣信号] FamilyTimeline
      ├── 默认展示「今天」；点击向下箭头逐日展开（最多 7 天）
      ├── 「收起」按钮 + 3 分钟自动收起
      ├── 事件类型：平安信号 / 文字消息 / 语音留言 / 微信请求 / 电话请求 / 系统警报
      └── 时间格式：刚刚 / X分钟前·HH:mm / X小时前·HH:mm / 昨天·HH:mm / 周X·HH:mm

/carer/profile
│
└── [长辈信息编辑页]
      ├── 姓名 / 年龄 / 与您的关系（父亲/母亲/公公/婆婆/其他）/ 性别
      ├── 脏状态追踪：未保存徽章 + 保存按钮激活/灰色
      ├── 返回时若有未保存更改 → 弹窗确认（放弃/继续编辑）
      └── [预留] 平安扣邀请二维码（功能即将上线）
```

---

## 2. 核心用户旅程 (Key User Journeys)

### Journey A — 晚辈添加长辈档案

```
晚辈进入 /carer/profile → 填写姓名 + 年龄 + 关系 + 性别
→ 点击「保存」→ UPDATE senior_profiles（RLS：created_by = auth.uid()）
→ Dashboard 自动读取最新 senior_profiles.name 显示
→ [预留] 生成平安扣邀请二维码 → 发送至长辈微信
```

### Journey B — 晚辈早晨查看长辈状态（最高频场景）

```
晚辈打开 /carer → 自动加载 StatusHeader
→ 正常状态（绿色）→ 查看 FamilyTimeline 昨日/今日动态
→ 查看 SleepInsightsCard（昨夜睡眠）
→ 查看 WellnessCard（今日 AI 洞察）
→ 点击 ComposeMessage → 发一条文字消息
→ 消息出现在 FamilyTimeline（实时 Realtime 更新）
```

### Journey C — 长辈发送平安信号

```
长辈打开 /senior-home → 看到绿色平安扣
→ 点击 → 呼吸动画 + 「已通知晚辈名」4秒提示
→ checkins 表插入新行
→ 晚辈端 FamilyTimeline 实时新增「发送了平安信号」条目
```

### Journey D — 心率异常自动告警

```
health-simulator（或真实设备）写入 health_metrics：heart_rate > 120
→ StatusHeader 检测到 isAnomaly（边界：false → true）
→ 自动 INSERT messages：type='alert', content='心率异常：XXX 次/分，系统已触发提醒'
→ FamilyTimeline 实时出现红色 ⚠️ 告警卡片
→ StatusHeader 显示「立即拨打妈妈」按钮
```

### Journey E — 长辈发语音留言

```
长辈点击 VoiceRecorder → 录制（≤60s）
→ 上传至 Supabase Storage：voice-memos/{seniorId}/{messageId}.webm
→ INSERT messages：type='voice', audio_url=path
→ 晚辈端 FamilyTimeline 出现「发来一段语音」条目
→ 晚辈点击「播放」→ 生成 60s 签名 URL → 播放音频
```

### Journey F — 长辈请求回电 / 回微信

```
长辈点击「给我回个微信/电话」
→ INSERT messages：type='text', content='__WECHAT_REQUEST__' / '__CALL_REQUEST__'
→ FamilyTimeline 显示「给[长辈名]回个微信/电话」提示卡片
```

---

## 3. 数据架构对齐 (Data Architecture)

### 3-A 数据库表（当前实现，截至 2026-03-31）

#### `senior_profiles` — 长辈档案
```sql
id            uuid PK
created_by    uuid FK → auth.users    -- 创建者（主晚辈）
name          text NOT NULL
city          text                    -- 用于天气 API（预留）
age           integer                 -- 新增：年龄
gender        text                    -- 新增：'男' | '女'
relationship  text                    -- 新增：'父亲'|'母亲'|'公公'|'婆婆'|'其他'
custom_relation text                  -- 新增：relationship='其他' 时的自定义
avatar_url    text
created_at    timestamptz
```
**RLS**：创建者完整 CRUD；绑定晚辈（via carer_relationships）可 SELECT；UPDATE 政策使用 `created_by = auth.uid()`

#### `carer_relationships` — 晚辈-长辈绑定关系
```sql
id         uuid PK
senior_id  uuid FK → senior_profiles
carer_id   uuid FK → auth.users
role       text    -- 'primary' | 'secondary'
created_at timestamptz
```

#### `checkins` — 平安信号事件
```sql
id           uuid PK
senior_id    uuid FK → senior_profiles
checked_in_at timestamptz
source       text    -- 'button' | 'auto_active'
```
**数据保留**：pg_cron 每日 11:00 北京时间删除 7 天前记录

#### `messages` — 统一消息表（双向 + 系统事件）
```sql
id               uuid PK
senior_id        uuid FK → senior_profiles
sender_id        uuid FK → auth.users
sender_role      text    -- 'carer' | 'senior'
sender_name      text    -- 冗余存储：关系称谓/名字（避免跨用户 RLS 查询）
type             text    -- 'text' | 'voice' | 'alert'
content          text    -- text/alert 类型必填；voice 为 null
audio_url        text    -- voice 类型必填；text/alert 为 null
audio_mime_type  text    -- 'audio/webm' | 'audio/mp4'
is_read          boolean DEFAULT false
read_at          timestamptz
created_at       timestamptz
```
**特殊 content 标记**：
- `__WECHAT_REQUEST__` → 长辈请求晚辈回微信
- `__CALL_REQUEST__`   → 长辈请求晚辈回电话

**数据保留**：pg_cron 每日 11:00 北京时间删除 7 天前记录
**Realtime**：`REPLICA IDENTITY FULL` 已开启（UPDATE 事件包含完整行数据）

#### `health_metrics` — 实时健康数据（垂直 Schema）
```sql
id           uuid PK
senior_id    uuid FK → senior_profiles
metric_type  text    -- 'heart_rate' | 'steps'
value        float
measured_at  timestamptz
```
**Realtime**：已启用，晚辈端状态卡实时更新

#### `sleep_sessions` — 睡眠会话
```sql
id            uuid PK
senior_id     uuid FK → senior_profiles
session_date  date
total_hours   float
deep_hours    float
light_hours   float
rem_hours     float
current_state text    -- 'awake'|'deep'|'light'|'nap'|'resting'|null
```

#### `health_snapshots` — 每日健康快照（Tier 1–3）
（详见 SENIOR_BACKEND_PRD.md §2）

#### `senior_baselines` / `ai_assessments` / `device_connections`
（详见 SENIOR_BACKEND_PRD.md）

### 3-B AI 状态判定逻辑

| 状态 | 颜色 | 触发条件 | 晚辈端展示 |
|---|---|---|---|
| **Emerald** | 🟢 翡翠绿 | 所有指标在基线内 | 「爸今天睡得不错，已出门散步」 |
| **Amber** | 🟡 琥珀色 | 步数骤降 OR 睡眠变浅 | 「妈这两天活动量偏低，建议视频聊聊」 |
| **Rose** | 🔴 玫瑰红 | 气压骤降 + 静息心率异常 | 「⚠️ 气压骤降，体征异动，请致电确认」 |
| **SOS** | 🚨 紧急 | `fall_detected = true` | 全屏弹窗，Realtime 立即推送 |
| **心率异常** | 🔴 实时 | `heart_rate > 120`（来自 health_metrics） | StatusHeader 红色环 + alert 写入 Timeline |

### 3-C FeedItem 类型体系

```typescript
type FeedItem =
  | { kind: 'checkin' }                                    // 平安信号
  | { kind: 'text';    content; sender_role; is_read }     // 文字消息
  | { kind: 'voice';   audio_url; sender_role }            // 语音留言
  | { kind: 'wechat_request'; sender_role }                // 回微信请求
  | { kind: 'call_request';   sender_role }                // 回电话请求
  | { kind: 'alert';   content }                           // 系统警报（心率/信号）
```

---

## 4. API 路由合约 (API Contract)

| 路由 | 方法 | 状态 | 说明 |
|---|---|---|---|
| `/api/weather?city=beijing` | GET | ✅ 已实现 | QWeather 代理，返回 temp/pressure/icon_code |
| `/api/senior/checkin` | POST | ✅ 已实现 | 平安扣点击写入 checkins |
| `/api/senior/health-sync` | POST | ✅ 已实现 | 手动触发健康数据同步 |
| `/api/senior/voice-url` | GET | ✅ 已实现 | 生成 Supabase Storage 签名 URL |
| `/api/senior/create` | POST | 📋 待实现 | 创建 senior_profile + 返回 QR 邀请链接 |
| `/api/senior/[id]/status` | GET | 📋 待实现 | 最新 AI assessment |
| `/api/senior/[id]/history` | GET | 📋 待实现 | 历史 ai_assessments 列表 |
| `/api/auth/device/initiate` | POST | 📋 待实现 Phase 2 | 生成 OAuth Magic Link |
| `/api/auth/device/callback` | GET | 📋 待实现 Phase 2 | 厂商 OAuth 回调 |
| `/api/health/sync` | POST/Cron | 📋 待实现 Phase 2 | 批量拉取健康数据 |

---

## 5. 前端组件树 (Component Inventory)

### 长辈端 (`src/components/senior/senior/`)

| 组件 | 功能 |
|---|---|
| `PeaceButton.tsx` | 256px 呼吸圆形按钮；fire-and-forget check-in；成功提示 4s |
| `VoiceRecorder.tsx` | MediaRecorder API；≤60s；上传至 `voice-memos/`；显示波形进度 |
| `QuickRequest.tsx` | 两个快捷按钮；插入特殊 content 标记（WECHAT/CALL REQUEST） |
| `MessageBanner.tsx` | 展示晚辈最新文字/语音消息（已被 senior-home 内联实现取代） |
| `BottomNav.tsx` | 底部导航 |

### 晚辈端 (`src/components/senior/carer/`)

| 组件 | 功能 |
|---|---|
| `ComposeMessage.tsx` | 发消息；携带 sender_name（关系称谓 > display_name > 邮箱前缀） |
| `FamilyTimeline.tsx` | 合并 checkins + messages → FeedItem[]；7天展开；自动收起 |
| `CheckinTimeline.tsx` | 平安信号历史；Realtime 订阅 |
| `SeniorStatusCard.tsx` | 长辈卡片摘要（Dashboard 用） |
| `StatusBadge.tsx` | Emerald/Amber/Rose/SOS 四色徽章 |
| `AiInsightCard.tsx` | 详细 AI 解读 + 行动建议 |

### 页面级组件（内联于 page.tsx）

| 位置 | 组件 | 功能 |
|---|---|---|
| `carer/page.tsx` | `EnvTile` | 上海时钟 + 天气 + 气压条 + AI 洞察 |
| `carer/page.tsx` | `StatusHeader` | 实时心率环 + isAnomaly 检测 + onAnomaly 回调 |
| `carer/page.tsx` | `SleepInsightsCard` | 睡眠状态卡片 |
| `carer/page.tsx` | `WellnessCard` | 综合健康洞察 |
| `carer/page.tsx` | `SeniorIdentityTile` | 长辈身份 + 设备状态 |
| `carer/page.tsx` | `NightStatusPanel` | 夜间睡眠状态面板 |
| `senior-home/page.tsx` | EnvTile（内联） | 北京时钟 + 天气 + 气压条 + AI 洞察 + 晚辈消息展示 |

---

## 6. Phase 交付状态

| 功能 | 计划 Phase | 实现状态 |
|---|---|---|
| 平安扣按钮 + check-in | Phase 1 MVP | ✅ 已实现 |
| 长辈发语音留言 | Phase 1 | ✅ 已实现 |
| 快捷请求（微信/电话） | Phase 1 | ✅ 已实现 |
| 晚辈发文字消息 | Phase 1 | ✅ 已实现（含 sender_name） |
| 晚辈查看平安信号 Timeline | Phase 1 | ✅ 已实现（7天 + 自动收起） |
| 长辈端接收消息 + 已读 | Phase 1 | ✅ 已实现 |
| 天气集成 + 气压洞察 | Phase 1 | ✅ 已实现（QWeather） |
| 长辈档案编辑（姓名/年龄/关系/性别） | Phase 1 | ✅ 已实现 |
| 7 天数据保留（pg_cron） | Phase 1 | ✅ 已实现 |
| 心率异常实时警报 + 自动 Timeline 记录 | Phase 1 | ✅ 已实现 |
| 睡眠状态卡 | Phase 2 | ✅ 已实现（dev simulator） |
| 综合 AI 健康洞察（WellnessCard） | Phase 2 | ✅ 已实现（规则引擎） |
| 长辈邀请二维码 | Phase 2 | 📋 UI 预留，待实现 |
| 设备 OAuth 接入（华为/小米） | Phase 2 | 📋 待实现 |
| SOS 跌倒全屏弹窗 | Phase 3 | 📋 待实现 |
| 晚辈多人协同（carer_relationships） | Phase 3 | 📋 待实现 |
| 历史状态趋势图 | Phase 3 | 📋 待实现 |

---

## 7. 技术约束与安全护栏

1. **RLS 强制隔离**：晚辈只能查询与自己有关联的 senior 数据。`senior_profiles` UPDATE 只允许 `created_by = auth.uid()`。
2. **Tier 3 数据仅后端可见**：血压、体温字段前端 API 不返回原始值，只返回 AI 翻译文字。
3. **AI 输出护栏**：禁止临床疾病名称，异常统一翻译为中性词汇，必须附轻量行动建议（见 SENIOR_BACKEND_PRD.md §4）。
4. **Token 加密**：device_connections 中 OAuth token 使用 AES-256 加密，禁止明文。
5. **SOS 不可防抖**：fall_detected 推送不经延迟队列，直接 Realtime broadcast。
6. **数据保留 7 天**：messages + checkins 通过 pg_cron 定时清除，voice 文件需额外清理 Storage（待实现）。
7. **sender_name 冗余存储**：消息发送时写入 sender_name，避免长辈端因 RLS 无法跨用户读取 profiles。

---

## 8. 与现有 Child 模块的共存策略

| 维度 | Child 模块 | Senior 模块 | 共存方案 |
|---|---|---|---|
| 路由 | `/log`, `/insights`, `/settings` | `/senior-home`, `/carer`, `/carer/profile` | 路由隔离，Role-based redirect |
| 组件 | `MoodCard`, `RecentLogs` 等 | `PeaceButton`, `FamilyTimeline` 等 | 独立目录，无交叉 |
| 数据库 | `logs`, `profiles` | `senior_profiles` + 7 张新表 | Supabase 同一项目，RLS 隔离 |
| AI 引擎 | `predictor.ts` (Child) | `senior-predictor.ts` + `wellness-score.ts` | 独立文件 |
| 认证 | Supabase Magic Link | 同左 | 统一 Auth，role 字段区分流向 |
