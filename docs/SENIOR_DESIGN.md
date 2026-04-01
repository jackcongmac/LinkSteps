# LinkSteps Senior — UI/UX Design Spec

> 本文档描述 Senior 模块的视觉设计系统、屏幕布局和交互规范。
> **最后更新**：2026-03-31（反映 v0.4 实现状态）

---

## 1. 设计原则

### 双端非对称（Asymmetric UX）
- **长辈端**：去标签化、极简、疗愈。唯一任务：点按钮 + 接收关怀。不出现任何数字、警告、复杂操作。
- **晚辈端**：信息密集、行动导向。数据翻译为自然语言，降低认知负荷。

### 低感官刺激
- 无高饱和度颜色
- 无复杂动效（仅 breathing animation、scale-95 微互动）
- 圆角优先：`rounded-3xl` 统一大圆角，柔化视觉边界

### 情感连接
- 每次数据更新都是关怀机会（AI 洞察语句温暖、具体）
- 时间戳使用相对时间（「刚刚」「昨天」）而非 ISO 时间

---

## 2. 色彩系统

### 基础色板

| 用途 | Token | 值 | 说明 |
|---|---|---|---|
| 长辈端背景 | `bg-stone-50` | `#FAFAF9` | 米白，更温暖 |
| 晚辈端背景 | `bg-slate-50` | `#F8FAFC` | 冷白，聚焦信息 |
| 白色卡片 | `bg-white` | `#FFFFFF` | 主卡片背景 |
| 主色（按钮/选中） | `sky-500` | `#0EA5E9` | 保存按钮、选中徽章 |
| 成功色 | `emerald-400/500` | `#34D399` | 平安信号、平稳状态 |
| 警示色 | `amber-400/500` | `#FBBF24` | 关注状态、休眠 |
| 危险色 | `red-500` | `#EF4444` | 心率异常、SOS |
| 系统事件 | `red-50 + border-red-100` | — | alert 类消息背景 |

### 可访问性要求（WCAG AA）
- 按钮背景 `sky-500`：白色文字对比度 ≥ 4.5:1 ✅
- 图标前景色：使用 `sky-600`（深一级），确保对比度 ≥ 3:1
- 正文最小对比度 4.5:1；非装饰性图标 3:1

### 状态色系

| 状态 | 背景 | 边框 | 文字 | 点/环 |
|---|---|---|---|---|
| safe（平稳） | `emerald-50` | `emerald-100` | `emerald-700` | `emerald-500` |
| idle（关注） | `amber-50` | `amber-100` | `amber-700` | `amber-400` |
| wechat_request | `emerald-50` | `emerald-200` | `emerald-700` | `emerald-500` |
| call_request | `amber-50` | `amber-200` | `amber-700` | `amber-400` |
| voice | `purple-50` | `purple-100` | `purple-700` | `purple-400` |
| alert（系统警报） | `red-50` | `red-100` | `red-700` | `red-500` |
| anomaly（心率） | `red-50` | `red-200` | `red-700` | `red-500` + ping |
| offline（断连） | `amber-50` | `amber-100` | `amber-600` | `amber-300` |
| dormant（休眠） | `slate-50` | `slate-200` | `slate-500` | `slate-300` |

---

## 3. 形状与间距

| 元素 | 圆角 | 内边距 |
|---|---|---|
| 主卡片 | `rounded-3xl` | `px-5 py-5` |
| 按钮（主要） | `rounded-2xl` | `py-3.5 px-4` |
| 按钮（小型） | `rounded-full` or `rounded-2xl` | `px-3 py-1.5` |
| 输入框 | `rounded-2xl` | `px-4 py-3` |
| 快捷标签 | `rounded-full` | `px-1.5 py-0.5` |
| 时间线竖线 | 绝对定位，`w-px bg-slate-100` | — |

---

## 4. 字体规范

| 层级 | Class | 用途 |
|---|---|---|
| 大标题（时钟） | `text-3xl font-bold tabular-nums` | 时钟数字 |
| 页面标题 | `text-lg font-semibold text-slate-800` | 页面 H1 |
| 卡片标题 | `text-base font-semibold text-slate-700` | 卡片主标题 |
| 正文 | `text-sm text-slate-700` | 消息内容、描述 |
| 次要文字 | `text-sm text-slate-500` | AI 洞察句 |
| 辅助文字 | `text-xs text-slate-400` | 时间戳、副标题 |
| 微型标签 | `text-[11px] font-semibold text-slate-400 tracking-wide` | 日期分组标题 |
| 章节标题 | `text-xs font-semibold uppercase tracking-widest text-slate-400` | 表单章节 |

---

## 5. 交互规范

### 微互动
- 所有可点击按钮：`active:scale-95 transition-transform`
- 卡片跳转链接：`active:scale-[0.98] transition-transform`
- 加载 spinner：`animate-spin`，颜色使用对应状态色
- 消息发送成功：`animate-[confettiBurst_0.4s_ease-out]`

### 状态反馈
- Toast 通知：`rounded-3xl bg-emerald-50 text-emerald-600`，2.5s 自动消失
- 未保存提示：`text-xs text-amber-500 font-medium`（「未保存」badge）
- 操作中按钮：禁用 + 文字改为「保存中…」/「发送中…」

### 脏状态管理（表单页）
- 用 `Snapshot` 接口记录初始值
- `isDirty = snapshot !== null && 任意字段变化`
- 保存按钮：dirty → `bg-sky-500`；clean → `bg-slate-200 cursor-not-allowed`
- 返回键：dirty → 弹出确认 Modal（底部弹出，`rounded-3xl bg-white`）

---

## 6. 长辈端屏幕设计 (`/senior-home`)

### 布局结构
```
<main bg-stone-50, flex-col center, gap-8, px-6>
  │
  ├── 顶部信息卡（bg-white, rounded-3xl, shadow-sm）
  │     ├── [时钟区] 左：XX:XX 大字 + 北京·时段
  │     │           右：天气图标 + 温度 + 范围
  │     ├── [气压条] 气压标签 + 进度条 + hPa 值
  │     ├── [AI 洞察] 一句话，text-slate-500, text-sm
  │     └── [消息区，有未读时] 分隔线 + 发件人 + 消息 + 时间 + 已读按钮
  │
  ├── 平安扣按钮（PeaceButton）
  │     └── 256px circle, bg-emerald-400, shadow-emerald, 呼吸动画
  │
  └── 操作区（flex-col, gap-3, max-w-xs）
        ├── VoiceRecorder（bg-white, rounded-3xl）
        └── QuickRequest（两个按钮，bg-white, rounded-3xl）
```

### 顶部信息卡 — 消息区设计
```
┌─────────────────────────────────────────┐
│ 小杰              [已读] ← emerald-50   │
│ 💬 啥情况？？                           │
│ 刚刚                                    │
└─────────────────────────────────────────┘
```
- 发件人名（sender_name）：`text-xs font-semibold text-slate-400`
- 消息内容：`text-sm text-slate-700`，带 💬 前缀
- 时间戳：`text-xs text-slate-400`，FamilyTimeline 相同格式
- 已读按钮：点击立即隐藏消息 + 异步更新 DB

### 平安扣按钮状态
| 状态 | 颜色 | 动画 | 文字 |
|---|---|---|---|
| 待机 | `bg-emerald-400` | 呼吸扩缩（3s cycle） | 「点击」 |
| 发送中 | `scale-down` | — | 「发送中」 |
| 成功（4s） | `bg-emerald-500` | 波纹 | 「已通知 [晚辈名]」 |

---

## 7. 晚辈端主屏设计 (`/carer`)

### 布局结构
```
<main bg-slate-50, flex-col, items-center, px-4, py-8, pb-24>
  │
  ├── Header（用户问候 + 今日日期 + 设置入口）
  │
  ├── 顶部信息卡（EnvTile）
  │     ├── 上海时钟 + 天气 + 气压条 + AI 洞察
  │     └── [ComposeMessage] 发消息输入框
  │
  ├── StatusHeader（心率状态环）
  │     ├── 正常：emerald 呼吸环
  │     ├── 休眠/断线：amber/slate 静态
  │     └── 异常：red 闪烁环 + 立即拨打按钮
  │
  ├── SleepInsightsCard
  │
  ├── WellnessCard（AI 综合健康洞察）
  │
  ├── SeniorIdentityTile → 跳转 /carer/profile
  │
  └── FamilyTimeline（平安扣信号 + 消息历史）
        ├── 今天（默认展开）
        ├── [↓ 显示更多]（逐日，最多 7 天）
        └── [↑ 收起]（手动 + 3分钟自动）
```

### FamilyTimeline 条目样式

| 事件类型 | 圆点颜色 | 卡片样式 | 文案 |
|---|---|---|---|
| checkin | `emerald-500`（最新）/ `slate-200` | 无卡片，纯文字 | 「发送了平安信号」 |
| text（carer 发） | `slate-200` | 无卡片 | 「💬 你发了一条消息」+ 内容 |
| text（senior 发） | `slate-200` | 无卡片 | 「💬 妈妈回复了」+ 内容 |
| voice | `slate-200` | 播放按钮 | 「🎙 你/妈妈发来一段语音」 |
| wechat_request | `emerald-500`（最新）/ `emerald-200` | `bg-emerald-50 border-emerald-100` | 「给[长辈名]回个微信」|
| call_request | `amber-400`（最新）/ `amber-200` | `bg-amber-50 border-amber-100` | 「给[长辈名]回个电话」 |
| alert（系统） | `red-500`（最新）/ `red-200` | `bg-red-50 border-red-100` | 「⚠️ 心率异常：XXX次/分，系统已触发提醒」 |

---

## 8. 长辈档案页设计 (`/carer/profile`)

### 布局
```
<main bg-slate-50, px-4, py-8>
  │
  ├── Header
  │     ├── ← 返回按钮（圆形，shadow-sm）
  │     ├── 「长辈信息」标题
  │     └── [有改动时] 「未保存」amber badge
  │
  ├── 基本信息卡（bg-white, rounded-3xl）
  │     ├── 姓名（text input）
  │     ├── 年龄（number input, min:50 max:120）
  │     ├── 与您的关系（5 格按钮：父亲/母亲/公公/婆婆/其他）
  │     ├── [其他时] 具体关系（text input）
  │     ├── 性别（2 格按钮：👨 男 / 👩 女）
  │     │     └── 关系选中时自动填充，「其他」时可手动选
  │     └── 保存按钮（dirty → sky-500；clean → slate-200）
  │
  ├── Toast（保存成功：emerald；失败：red）
  │
  └── 平安扣二维码卡（bg-white, rounded-3xl）
        └── 生成邀请二维码按钮（indigo-500，预留功能）

[有未保存改动时点返回 → 底部 Modal]
  「放弃未保存的更改？」
  ├── 继续编辑（slate border）
  └── 放弃保存（red-500）
```

---

## 9. 时间戳格式规范

所有时间戳使用北京时区（`Asia/Shanghai`），格式统一：

| 时间距离 | 格式 | 示例 |
|---|---|---|
| < 1 分钟 | `刚刚` | — |
| 1–59 分钟 | `X 分钟前 · HH:mm` | `5 分钟前 · 09:30` |
| 1–23 小时（今天） | `X 小时前 · HH:mm` | `2 小时前 · 07:15` |
| 昨天 | `昨天 · HH:mm` | `昨天 · 21:40` |
| 2–6 天前 | `周X · HH:mm` | `周三 · 14:20` |

---

## 10. 气压条设计规范

```
[气压]  ████████░░  1008 hPa
         颜色      数值
```

| 气压范围 | 颜色 | 含义 |
|---|---|---|
| < 1005 hPa | `bg-amber-400` | 骤降，关节不适风险 |
| 1005–1010 hPa | `bg-sky-400` | 偏低，轻度关注 |
| ≥ 1010 hPa | `bg-emerald-400` | 正常 |

**进度条计算**：`width = min(100%, (pressure - 990) / 40 * 100%)`（映射 990–1030 hPa 到 0–100%）

---

## 11. 空态与加载态设计

| 场景 | 设计 |
|---|---|
| 页面加载中 | 全屏居中 spinner：`w-12 h-12 rounded-full border-4 border-emerald-200 border-t-emerald-500 animate-spin` |
| 天气加载中 | 右上角小 spinner（`w-5 h-5`），不阻塞其他内容 |
| Timeline 空态 | `「今天暂无记录」` / `「暂无记录」`，`text-slate-400 text-sm text-center py-8` |
| 未绑定长辈 | 「请让家人帮您完成初始设置」，`text-stone-500 text-xl text-center` |
| 语音加载 | 播放按钮内小 spinner + 「加载中…」 |

---

## 12. 移动端适配

- 最大内容宽度：`max-w-sm`（晚辈端）/ `max-w-xs`（长辈端和信息卡）
- 底部安全区：`pb-24`（避免被手机底部栏遮挡）
- 触摸区最小尺寸：`44×44px`（iOS HIG 规范）
- 输入法弹出：页面使用 `flex flex-col` 布局，输入框紧跟内容

---

## 13. 设计待办（Future Design Work）

| 功能 | 优先级 | 说明 |
|---|---|---|
| 晚辈个人档案页 | 🔴 高 | 目前用 /settings（英文，属于 child 模块），需独立中文版本 |
| 平安扣邀请二维码 | 🟡 中 | `/carer/profile` 已预留 UI，待实现生成逻辑 |
| 多晚辈协同视图 | 🟡 中 | FamilyTimeline 需显示「谁发的」区分多晚辈消息 |
| 历史状态趋势图 | 🟢 低 | 7 天 AI 状态颜色条 |
| SOS 全屏弹窗 | 🔴 高（Phase 3） | fall_detected 触发，需特殊全屏设计 |
