# QA Schema Security Review (v3 Final)

**审查人**: QA Engineer
**审查日期**: 2026-03-23
**审查对象**: `docs/schema.md`, `docs/types.ts`
**状态**: **APPROVED — 正式 Sign-Off**

---

## 修复验证：高严重度（2/2 通过）

### Fix #1: feedback_author_insert — child_id 授权 + recipient_id 合法性

✅ **PASS** — schema.md 第 352-374 行。修复正确，策略现在包含三层校验：

1. `auth.uid() = author_id` — 身份校验
2. `child_id IN (children WHERE parent_id = auth.uid()) OR child_id IN (child_teacher WHERE teacher_id = auth.uid() AND status = 'active')` — 作者与 child_id 授权关系校验
3. `recipient_id IN (children.parent_id WHERE id = child_id) OR recipient_id IN (child_teacher.teacher_id WHERE child_id = feedback.child_id AND status = 'active')` — 接收者与 child_id 关联校验

验证要点：
- 家长只能给自己孩子的授权老师发 feedback
- 老师只能给被授权学生的家长或同校老师发 feedback
- 无法向无关用户发送 feedback
- recipient_id 子查询中正确引用了 `feedback.child_id` 避免歧义

### Fix #2: RPC 数组上限 + 空数组检查

✅ **PASS** — schema.md 第 454-460 行。修复正确：

- 空数组检查：`array_length(p_child_ids, 1) IS NULL OR ... = 0` 时抛出异常
- 上限检查：`> 50` 时抛出异常
- 错误消息清晰且不泄露敏感信息

---

## 修复验证：中严重度（5/5 通过）

### Fix #3: daily_logs_teacher_update — 增加 active 状态检查

✅ **PASS** — schema.md 第 241-250 行。USING 子句现在同时检查 `author_id = auth.uid()` 和 `child_id IN (child_teacher WHERE teacher_id = auth.uid() AND status = 'active')`。被撤销授权的老师无法再更新旧日志。

### Fix #4: child_teacher_teacher_accept — 限制状态转换

✅ **PASS** — schema.md 第 173-176 行。策略已重命名为 `child_teacher_teacher_accept`，语义更清晰：
- USING: `teacher_id = auth.uid() AND status = 'pending'` — 只能操作待处理的邀请
- WITH CHECK: `teacher_id = auth.uid() AND status = 'active'` — 只能改为 active

这完全封锁了以下攻击路径：
- 不能将 active 改为其他值（USING 不匹配）
- 不能将 pending 改为 revoked（WITH CHECK 不通过）
- 不能修改 child_id、invited_by 等其他字段（WITH CHECK 隐式保护，因为整行要满足约束）

### Fix #5: p_value JSONB 按 category 校验

✅ **PASS** — schema.md 第 478-503 行。CASE 语句覆盖全部 6 种 category：
- mood: 要求 `level` + `label`
- sleep: 要求 `hours` + `quality`
- meal: 要求 `type` + `amount`
- medication: 要求 `name` + `taken`
- behavior: 要求 `description` + `intensity`
- note: 要求 `text`

使用 `?` 操作符检查字段存在性，实现合理。

注意：这是"必要字段存在性"校验，不是"字段值类型"校验（如 level 是否为 1-5 整数）。对 MVP 来说已足够，值域校验可在前端 TypeScript 层面保障。

### Fix #6: 重复 child_id 去重

✅ **PASS** — schema.md 第 463 行：
```sql
SELECT ARRAY(SELECT DISTINCT unnest(p_child_ids)) INTO v_deduped_ids;
```
第 507 行循环使用 `v_deduped_ids` 而非原始 `p_child_ids`。去重逻辑正确。

### Fix #7: 错误消息不泄露 UUID

✅ **PASS** — schema.md 第 516 行：
```sql
RAISE EXCEPTION 'Unauthorized child in batch';
```
通用错误消息，不包含具体的 child_id UUID。其他错误消息也已检查，均为通用文本。

---

## 遗留问题（已知风险，不阻塞 sign-off）

以下问题在 v1/v2 审查中标记为低严重度或信息性，已与团队确认为 MVP 可接受风险：

| 编号 | 问题 | 严重程度 | 决议 |
|------|------|----------|------|
| L1 | 审计触发器未覆盖 profiles、child_teacher、feedback | 低 | MVP 后续迭代补充 |
| L2 | audit_logs 缺少 UPDATE/DELETE 不可变约束 | 低 | MVP 后续迭代补充 |
| L3 | medication 数据与普通日志共享访问控制 | 低 (MVP) | 需求明确后再做字段级隔离 |
| L4 | category 与 value 类型无编译期强关联（TypeScript 层面） | 低 | 前端可用 Zod 补充 |

---

## 最终检查清单

| 检查项 | 状态 |
|--------|------|
| 全部 7 张表启用 RLS | ✅ |
| 家长数据隔离完整 | ✅ |
| 老师授权边界严格（含 active 状态检查） | ✅ |
| feedback 双向授权校验（author + recipient） | ✅ |
| child_teacher 状态转换受限（pending -> active only） | ✅ |
| RPC 输入防护（数组上限、去重、空数组） | ✅ |
| RPC JSONB 结构校验（6 种 category 全覆盖） | ✅ |
| RPC 错误消息不泄露敏感信息 | ✅ |
| RPC 事务回滚完整 | ✅ |
| RPC search_path 安全 | ✅ |
| audit_logs 客户端完全隔离 | ✅ |
| TypeScript 类型无 any | ✅ |
| JSONB 字段有结构化类型 | ✅ |

---

## 结论

**APPROVED** — 全部 7 个问题（2 高 + 5 中）已正确修复。Schema 安全设计满足 MVP 发布要求。

**Sign-off by**: QA Engineer
**Sign-off date**: 2026-03-23
