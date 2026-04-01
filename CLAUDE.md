# LinkSteps 项目宪章

## 项目愿景
本项目包含两个独立模块，共用同一 Supabase 项目和认证体系：

1. **Child 模块**（原有）：为谱系儿童（ASD/ADHD）建立家校协同日志，解决家长与老师之间的信息断层。路由：`/log`, `/insights`, `/settings`
2. **Senior 模块**（新增）：为独生子女一代提供远距离长辈关怀工具，"关怀，不是监管"。路由：`/senior-home`（长辈端）、`/carer`（晚辈端）、`/carer/profile`

> 详细规格见 `docs/SENIOR_IA.md`、`docs/SENIOR_BACKEND_PRD.md`、`docs/SENIOR_DESIGN.md`

## 语言规范
- **用户侧全中文**：所有面向用户的内容（AI 提醒、通知、状态文案、空态、错误提示、seed 数据）一律使用中文，禁止出现英文字符串。
- 代码本身（变量名、注释、类型）保持英文。

## 核心原则 (MVP)
- **极简录入**：所有日常操作（打卡、记录）必须在 60 秒内完成。
- **低感官刺激**：UI 必须柔和，避免高饱和度颜色和复杂动效。
- **情感连接**：强化家校之间的正面反馈循环。

## 技术栈
- 框架: Next.js (App Router)
- 样式: Tailwind CSS + Lucide Icons
- 后端: Supabase (Auth + Database)
- 认证: Supabase Magic Link (免密登录)

## UI 规范
- **色彩**:
  - Child 模块背景：`bg-slate-50`
  - **Senior 长辈端背景：`bg-stone-50`**（更温暖的米白，区别于晚辈端）
  - Senior 晚辈端背景：`bg-slate-50`
  - 主色 `sky-500`（柔和蓝），成功色 `emerald-400`（薄荷绿）
- **形状**: 卡片和按钮统一使用大圆角 `rounded-3xl`。
- **交互**: 按钮需具备 `active:scale-95` 的微互动反馈。
- **色彩使用说明**:
  - `sky-500` 用于**按钮背景色**（白色文字在其上，对比度足够）
  - `sky-500` 用于小图标前景色时对比度仅 2.77:1，不达标 — 图标前景色应使用 `sky-600` 或更深（对比度 ≥ 3:1）
  - 所有非装饰性图标前景色需满足 WCAG AA 3:1，正文需满足 4.5:1

## 团队分工
- **Architect**: 负责数据库 Schema、API 路由及安全规范（参考 HIPAA）。
- **Frontend**: 负责响应式 UI 实现，严格遵守色彩和形状规范。
- **QA**: 负责辅助功能测试、移动端适配及感官负荷检查。

## 开发规范
- 所有代码使用 TypeScript strict mode — 禁止 `any`
- 组件目录: `src/components/`，页面目录: `src/app/`
- Senior 模块组件：`src/components/senior/carer/`（晚辈端）和 `src/components/senior/senior/`（长辈端）
- Supabase 客户端统一在 `src/lib/supabase.ts` 初始化
- 默认使用 Server Components；仅在必要时使用 Client Components（标记 `"use client"`）
- 遵循 Next.js App Router 约定
- Mobile-first 响应式设计
- 所有 Supabase 表必须启用 Row Level Security (RLS)

### Senior 模块特有规范

- **跨用户数据禁止直接查询**：`profiles` 表 RLS 只允许读自己的行。需要在消息中展示发件人名字时，**必须在 INSERT 时将 `sender_name` 冗余写入 `messages` 表**，不可在长辈端运行时再去查 `profiles`。
- **`senior_profiles` UPDATE**：必须有 `created_by = auth.uid()` 的 RLS UPDATE 政策，否则 UPDATE 静默返回 0 行不报错。
- **PostgREST schema cache**：通过 `supabase db push` 添加新列后若立即不可用，执行 `SELECT pg_notify('pgrst', 'reload schema')` 刷新缓存。
- **Supabase Storage**：语音文件存储在 `voice-memos/{seniorId}/{messageId}.webm` 路径，下载须通过 `createSignedUrl(path, 60)` 生成 60s 签名 URL。
- **7 天数据保留**：`messages` 和 `checkins` 表通过 pg_cron 每日自动删除 7 天前数据，不要构建依赖更早历史的功能。
- **消息特殊标记**：`__WECHAT_REQUEST__` 和 `__CALL_REQUEST__` 是存储在 `messages.content` 的特殊字符串，由 `buildFeed()` 识别转换为 FeedItem 类型，**禁止修改这两个常量的值**。

## 工作流
1. Architect 优先完成 schema 和 API 合约设计
2. Frontend 依据合约实现 UI
3. QA 在每个功能完成后审查，sign-off 后方可标记完成

## 命名规范
- 文件: `kebab-case`
- 组件: `PascalCase`
- 函数/变量: `camelCase`
- 数据库表: `snake_case`
