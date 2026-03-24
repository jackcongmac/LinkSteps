# LinkSteps 项目宪章

## 项目愿景
为谱系儿童（ASD/ADHD）建立一个极简、疗愈的家校协同日志 Web App，解决家长与老师之间的信息断层。

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
- **色彩**: 背景 `bg-slate-50`，主色 `sky-500` (柔和蓝)，成功色 `emerald-400` (薄荷绿)。
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
- Supabase 客户端统一在 `src/lib/supabase.ts` 初始化
- 默认使用 Server Components；仅在必要时使用 Client Components（标记 `"use client"`）
- 遵循 Next.js App Router 约定
- Mobile-first 响应式设计
- 所有 Supabase 表必须启用 Row Level Security (RLS)

## 工作流
1. Architect 优先完成 schema 和 API 合约设计
2. Frontend 依据合约实现 UI
3. QA 在每个功能完成后审查，sign-off 后方可标记完成

## 命名规范
- 文件: `kebab-case`
- 组件: `PascalCase`
- 函数/变量: `camelCase`
- 数据库表: `snake_case`
