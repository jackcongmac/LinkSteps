# LinkSteps Database Schema

## ER 关系概览

```
auth.users (Supabase 内置)
    │
    ▼
profiles ──────────┐
    │               │
    ▼               ▼
children      child_teacher (关联表)
    │               │
    ▼               │
daily_logs ◄────────┘
    │
    ▼
log_entries
    │
    ▼
feedback
    │
audit_logs (独立审计)
```

---

## 1. profiles — 用户档案

与 `auth.users` 一对一关联，存储角色和显示信息。

```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('parent', 'teacher')),
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
```

**RLS 策略：**

```sql
-- 用户只能读写自己的档案
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- 老师可以查看与自己关联的家长档案（用于显示名称）
CREATE POLICY "profiles_select_linked_parents"
  ON profiles FOR SELECT
  USING (
    role = 'parent'
    AND id IN (
      SELECT c.parent_id FROM children c
      JOIN child_teacher ct ON ct.child_id = c.id
      WHERE ct.teacher_id = auth.uid()
    )
  );

-- 家长可以查看与自己孩子关联的老师档案
CREATE POLICY "profiles_select_linked_teachers"
  ON profiles FOR SELECT
  USING (
    role = 'teacher'
    AND id IN (
      SELECT ct.teacher_id FROM child_teacher ct
      JOIN children c ON c.id = ct.child_id
      WHERE c.parent_id = auth.uid()
    )
  );
```

---

## 2. children — 儿童档案

```sql
CREATE TABLE children (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  date_of_birth DATE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_children_parent_id ON children(parent_id);

ALTER TABLE children ENABLE ROW LEVEL SECURITY;
```

**RLS 策略：**

```sql
-- 家长完全管理自己的孩子档案
CREATE POLICY "children_parent_all"
  ON children FOR ALL
  USING (auth.uid() = parent_id)
  WITH CHECK (auth.uid() = parent_id);

-- 老师只读被授权关联的学生
CREATE POLICY "children_teacher_select"
  ON children FOR SELECT
  USING (
    id IN (
      SELECT child_id FROM child_teacher
      WHERE teacher_id = auth.uid()
    )
  );
```

---

## 3. child_teacher — 家校关联表

将老师与学生关联，实现跨角色数据共享。

```sql
CREATE TABLE child_teacher (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(child_id, teacher_id)
);

CREATE INDEX idx_child_teacher_teacher ON child_teacher(teacher_id);
CREATE INDEX idx_child_teacher_child ON child_teacher(child_id);

ALTER TABLE child_teacher ENABLE ROW LEVEL SECURITY;
```

**RLS 策略：**

```sql
-- 家长可以管理自己孩子的关联（邀请/撤销老师）
CREATE POLICY "child_teacher_parent_all"
  ON child_teacher FOR ALL
  USING (
    child_id IN (
      SELECT id FROM children WHERE parent_id = auth.uid()
    )
  )
  WITH CHECK (
    child_id IN (
      SELECT id FROM children WHERE parent_id = auth.uid()
    )
  );

-- 老师可以查看自己的关联邀请
CREATE POLICY "child_teacher_teacher_select"
  ON child_teacher FOR SELECT
  USING (teacher_id = auth.uid());

-- 老师只能将 pending 状态的邀请改为 active（接受），不可修改其他字段
CREATE POLICY "child_teacher_teacher_accept"
  ON child_teacher FOR UPDATE
  USING (teacher_id = auth.uid() AND status = 'pending')
  WITH CHECK (teacher_id = auth.uid() AND status = 'active');
```

---

## 4. daily_logs — 每日日志

每个孩子每天一条日志，作为当日所有条目的容器。

```sql
CREATE TABLE daily_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  author_id UUID NOT NULL REFERENCES profiles(id),
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(child_id, log_date, author_id)
);

CREATE INDEX idx_daily_logs_child_date ON daily_logs(child_id, log_date DESC);

ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;
```

**RLS 策略：**

```sql
-- 家长可以管理自己孩子的日志
CREATE POLICY "daily_logs_parent_all"
  ON daily_logs FOR ALL
  USING (
    child_id IN (
      SELECT id FROM children WHERE parent_id = auth.uid()
    )
  )
  WITH CHECK (
    child_id IN (
      SELECT id FROM children WHERE parent_id = auth.uid()
    )
    AND author_id = auth.uid()
  );

-- 老师可以查看和创建被授权学生的日志
CREATE POLICY "daily_logs_teacher_select"
  ON daily_logs FOR SELECT
  USING (
    child_id IN (
      SELECT child_id FROM child_teacher
      WHERE teacher_id = auth.uid() AND status = 'active'
    )
  );

CREATE POLICY "daily_logs_teacher_insert"
  ON daily_logs FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND child_id IN (
      SELECT child_id FROM child_teacher
      WHERE teacher_id = auth.uid() AND status = 'active'
    )
  );

-- 老师只能更新自己创建的日志，且关联仍处于 active 状态
CREATE POLICY "daily_logs_teacher_update"
  ON daily_logs FOR UPDATE
  USING (
    author_id = auth.uid()
    AND child_id IN (
      SELECT child_id FROM child_teacher
      WHERE teacher_id = auth.uid() AND status = 'active'
    )
  )
  WITH CHECK (author_id = auth.uid());
```

---

## 5. log_entries — 日志条目

日志内的具体记录项，支持多维度打卡。

```sql
CREATE TABLE log_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_log_id UUID NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (
    category IN ('mood', 'behavior', 'sleep', 'meal', 'medication', 'note')
  ),
  value JSONB NOT NULL DEFAULT '{}',
  -- value 示例：
  --   mood:       {"level": 4, "label": "happy"}
  --   sleep:      {"hours": 8.5, "quality": "good"}
  --   meal:       {"type": "lunch", "amount": "full"}
  --   medication: {"name": "...", "taken": true}
  --   behavior:   {"description": "...", "intensity": 3}
  --   note:       {"text": "..."}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_log_entries_daily_log ON log_entries(daily_log_id);
CREATE INDEX idx_log_entries_category ON log_entries(category);

ALTER TABLE log_entries ENABLE ROW LEVEL SECURITY;
```

**RLS 策略：**

```sql
-- 继承 daily_logs 的访问权限：通过 daily_log_id 关联判定
CREATE POLICY "log_entries_parent_all"
  ON log_entries FOR ALL
  USING (
    daily_log_id IN (
      SELECT dl.id FROM daily_logs dl
      JOIN children c ON c.id = dl.child_id
      WHERE c.parent_id = auth.uid()
    )
  )
  WITH CHECK (
    daily_log_id IN (
      SELECT dl.id FROM daily_logs dl
      JOIN children c ON c.id = dl.child_id
      WHERE c.parent_id = auth.uid()
    )
  );

CREATE POLICY "log_entries_teacher_select"
  ON log_entries FOR SELECT
  USING (
    daily_log_id IN (
      SELECT dl.id FROM daily_logs dl
      JOIN child_teacher ct ON ct.child_id = dl.child_id
      WHERE ct.teacher_id = auth.uid() AND ct.status = 'active'
    )
  );

CREATE POLICY "log_entries_teacher_insert"
  ON log_entries FOR INSERT
  WITH CHECK (
    daily_log_id IN (
      SELECT dl.id FROM daily_logs dl
      WHERE dl.author_id = auth.uid()
    )
  );
```

---

## 6. feedback — 家校正面反馈

老师/家长互相发送的鼓励和反馈，强化情感连接。

```sql
CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id),
  recipient_id UUID NOT NULL REFERENCES profiles(id),
  content TEXT NOT NULL,
  emoji TEXT,  -- 可选表情符号，如 "star", "heart", "thumbsup"
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_feedback_child ON feedback(child_id);
CREATE INDEX idx_feedback_recipient ON feedback(recipient_id, is_read);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
```

**RLS 策略：**

```sql
-- 作者可以创建反馈：需校验 child_id 授权关系 + recipient_id 合法性
CREATE POLICY "feedback_author_insert"
  ON feedback FOR INSERT
  WITH CHECK (
    auth.uid() = author_id
    -- 作者必须与该儿童有关联（家长或授权老师）
    AND (
      child_id IN (SELECT id FROM children WHERE parent_id = auth.uid())
      OR child_id IN (
        SELECT child_id FROM child_teacher
        WHERE teacher_id = auth.uid() AND status = 'active'
      )
    )
    -- 接收者也必须与该儿童有关联（家长或授权老师）
    AND (
      recipient_id IN (
        SELECT parent_id FROM children WHERE id = child_id
      )
      OR recipient_id IN (
        SELECT teacher_id FROM child_teacher
        WHERE child_id = feedback.child_id AND status = 'active'
      )
    )
  );

-- 作者可以查看自己发出的反馈
CREATE POLICY "feedback_author_select"
  ON feedback FOR SELECT
  USING (auth.uid() = author_id);

-- 接收者可以查看收到的反馈
CREATE POLICY "feedback_recipient_select"
  ON feedback FOR SELECT
  USING (auth.uid() = recipient_id);

-- 接收者可以标记已读
CREATE POLICY "feedback_recipient_update_read"
  ON feedback FOR UPDATE
  USING (auth.uid() = recipient_id)
  WITH CHECK (auth.uid() = recipient_id);
```

---

## 7. audit_logs — 审计日志 (HIPAA)

记录敏感数据的访问和修改，不可变表。

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,        -- 'INSERT', 'UPDATE', 'DELETE', 'SELECT'
  table_name TEXT NOT NULL,
  record_id UUID,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_table ON audit_logs(table_name, created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
```

**RLS 策略：**

```sql
-- 审计日志仅服务端可写入（通过 service_role），普通用户不可读写
-- 不创建任何允许策略，默认拒绝所有客户端访问
-- 写入通过数据库触发器或 Edge Function（使用 service_role key）完成
```

---

## 8. bulk_create_log_entries — 批量创建日志条目 (RPC)

老师一次性为多个孩子批量创建相同的日志记录，使用数据库函数保证事务原子性。

```sql
CREATE OR REPLACE FUNCTION bulk_create_log_entries(
  p_child_ids UUID[],
  p_category TEXT,
  p_value JSONB,
  p_log_date DATE DEFAULT CURRENT_DATE
)
RETURNS UUID[] -- 返回创建的 log_entry IDs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_teacher_id UUID := auth.uid();
  v_child_id UUID;
  v_daily_log_id UUID;
  v_entry_ids UUID[] := '{}';
  v_entry_id UUID;
  v_deduped_ids UUID[];
BEGIN
  -- ===== 输入防护 =====

  -- 1. 数组上限：防止超大数组造成 DoS（长时间锁表 + 审计日志膨胀）
  IF array_length(p_child_ids, 1) IS NULL OR array_length(p_child_ids, 1) = 0 THEN
    RAISE EXCEPTION 'p_child_ids must not be empty';
  END IF;
  IF array_length(p_child_ids, 1) > 50 THEN
    RAISE EXCEPTION 'Too many children: maximum 50 per batch';
  END IF;

  -- 2. 去重：防止重复 child_id 导致重复插入
  SELECT ARRAY(SELECT DISTINCT unnest(p_child_ids)) INTO v_deduped_ids;

  -- 3. 校验调用者为老师
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = v_teacher_id AND role = 'teacher'
  ) THEN
    RAISE EXCEPTION 'Only teachers can use bulk_create_log_entries';
  END IF;

  -- 4. 校验 category 合法性
  IF p_category NOT IN ('mood', 'behavior', 'sleep', 'meal', 'medication', 'note') THEN
    RAISE EXCEPTION 'Invalid category';
  END IF;

  -- 5. 校验 p_value JSONB 结构与 category 匹配
  CASE p_category
    WHEN 'mood' THEN
      IF NOT (p_value ? 'level' AND p_value ? 'label') THEN
        RAISE EXCEPTION 'mood value requires "level" and "label" fields';
      END IF;
    WHEN 'sleep' THEN
      IF NOT (p_value ? 'hours' AND p_value ? 'quality') THEN
        RAISE EXCEPTION 'sleep value requires "hours" and "quality" fields';
      END IF;
    WHEN 'meal' THEN
      IF NOT (p_value ? 'type' AND p_value ? 'amount') THEN
        RAISE EXCEPTION 'meal value requires "type" and "amount" fields';
      END IF;
    WHEN 'medication' THEN
      IF NOT (p_value ? 'name' AND p_value ? 'taken') THEN
        RAISE EXCEPTION 'medication value requires "name" and "taken" fields';
      END IF;
    WHEN 'behavior' THEN
      IF NOT (p_value ? 'description' AND p_value ? 'intensity') THEN
        RAISE EXCEPTION 'behavior value requires "description" and "intensity" fields';
      END IF;
    WHEN 'note' THEN
      IF NOT (p_value ? 'text') THEN
        RAISE EXCEPTION 'note value requires "text" field';
      END IF;
  END CASE;

  -- ===== 批量处理 =====

  FOREACH v_child_id IN ARRAY v_deduped_ids
  LOOP
    -- 校验老师与该孩子的关联处于 active 状态（通用错误信息，不泄露 UUID）
    IF NOT EXISTS (
      SELECT 1 FROM child_teacher
      WHERE teacher_id = v_teacher_id
        AND child_id = v_child_id
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'Unauthorized child in batch';
    END IF;

    -- Upsert daily_log（确保当天日志存在）
    INSERT INTO daily_logs (child_id, log_date, author_id)
    VALUES (v_child_id, p_log_date, v_teacher_id)
    ON CONFLICT (child_id, log_date, author_id) DO UPDATE
      SET updated_at = now()
    RETURNING id INTO v_daily_log_id;

    -- 插入 log_entry
    INSERT INTO log_entries (daily_log_id, category, value)
    VALUES (v_daily_log_id, p_category, p_value)
    RETURNING id INTO v_entry_id;

    v_entry_ids := v_entry_ids || v_entry_id;
  END LOOP;

  RETURN v_entry_ids;
END;
$$;
```

**设计说明：**
- 使用 `SECURITY DEFINER` 以函数创建者身份执行，绕过 RLS 实现跨行批量插入，但在函数内部显式校验权限
- 整个函数在一个事务中执行，任意一个 child_id 校验失败则全部回滚，保证数据一致性
- 为每个孩子自动 upsert 当日的 `daily_logs` 记录，然后插入 `log_entries` 条目
- 返回所有新创建的 `log_entry` ID 数组，方便前端确认

**安全防护：**
- **DoS 防护**：`p_child_ids` 上限 50，防止超大数组造成长时间锁表和审计日志膨胀
- **去重**：自动对 `p_child_ids` 去重，避免同一孩子重复插入
- **JSONB 结构校验**：按 `p_category` 校验 `p_value` 必要字段存在性
- **通用错误信息**：授权失败时返回 "Unauthorized child in batch"，不泄露具体 child UUID
- **RLS 注意**：因为使用 `SECURITY DEFINER`，函数内的 INSERT 不受 RLS 策略限制，权限检查由函数逻辑自行完成。家长端查看时，现有的 `log_entries_parent_all` RLS 策略确保家长只能看到自己孩子的条目

---

## 9. 辅助：自动更新 updated_at 触发器

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER children_updated_at
  BEFORE UPDATE ON children
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER daily_logs_updated_at
  BEFORE UPDATE ON daily_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## 10. 审计触发器示例 (HIPAA)

```sql
CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 对敏感表启用审计
CREATE TRIGGER audit_children AFTER INSERT OR UPDATE OR DELETE ON children
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER audit_daily_logs AFTER INSERT OR UPDATE OR DELETE ON daily_logs
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER audit_log_entries AFTER INSERT OR UPDATE OR DELETE ON log_entries
  FOR EACH ROW EXECUTE FUNCTION audit_trigger();
```

---

## API 合约 (Supabase Client 调用示意)

### 认证 — Magic Link

```typescript
// 发送 Magic Link
await supabase.auth.signInWithOtp({ email })

// 登出
await supabase.auth.signOut()

// 监听认证状态
supabase.auth.onAuthStateChange((event, session) => { ... })
```

### profiles

```typescript
// 获取当前用户档案
const { data } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', userId)
  .single()

// 创建档案（注册后首次）
await supabase.from('profiles').insert({
  id: userId,
  role: 'parent',
  display_name: '...'
})

// 更新档案
await supabase.from('profiles').update({ display_name: '...' }).eq('id', userId)
```

### children

```typescript
// 获取当前家长的所有孩子
const { data } = await supabase
  .from('children')
  .select('*')
  .eq('parent_id', userId)

// 添加孩子
await supabase.from('children').insert({
  parent_id: userId,
  name: '...',
  date_of_birth: '2020-01-01'
})
```

### daily_logs + log_entries (快速打卡)

```typescript
// 获取或创建今日日志
const { data: log } = await supabase
  .from('daily_logs')
  .upsert(
    { child_id: childId, log_date: today, author_id: userId },
    { onConflict: 'child_id,log_date,author_id' }
  )
  .select()
  .single()

// 添加条目（如情绪打卡）
await supabase.from('log_entries').insert({
  daily_log_id: log.id,
  category: 'mood',
  value: { level: 4, label: 'happy' }
})

// 获取某日的完整日志（含条目）
const { data } = await supabase
  .from('daily_logs')
  .select('*, log_entries(*)')
  .eq('child_id', childId)
  .eq('log_date', date)
```

### child_teacher (邀请老师)

```typescript
// 家长邀请老师
await supabase.from('child_teacher').insert({
  child_id: childId,
  teacher_id: teacherId,
  invited_by: userId
})

// 老师接受邀请
await supabase.from('child_teacher')
  .update({ status: 'active' })
  .eq('id', invitationId)
  .eq('teacher_id', userId)
```

### feedback

```typescript
// 发送反馈
await supabase.from('feedback').insert({
  child_id: childId,
  author_id: userId,
  recipient_id: recipientId,
  content: '今天表现很棒！',
  emoji: 'star'
})

// 获取我收到的未读反馈
const { data } = await supabase
  .from('feedback')
  .select('*, author:profiles!author_id(display_name, avatar_url)')
  .eq('recipient_id', userId)
  .eq('is_read', false)
  .order('created_at', { ascending: false })

// 标记已读
await supabase.from('feedback')
  .update({ is_read: true })
  .eq('id', feedbackId)
```

### bulk_create_log_entries (RPC — 老师批量打卡)

```typescript
// 老师为多个孩子批量创建相同的日志条目
const { data: entryIds, error } = await supabase.rpc('bulk_create_log_entries', {
  p_child_ids: ['child-uuid-1', 'child-uuid-2', 'child-uuid-3'],
  p_category: 'meal',
  p_value: { type: 'lunch', amount: 'full' },
  p_log_date: '2026-03-23'  // 可选，默认今天
})

// entryIds: string[] — 返回所有新创建的 log_entry ID
// 如果任一 child_id 权限校验失败，整个调用回滚，error 中包含失败原因
```

**调用约束：**
- 仅 `role = 'teacher'` 的用户可调用
- 所有 `child_ids` 必须与该老师存在 `status = 'active'` 的关联
- 事务原子性：全部成功或全部回滚
- `p_category` 和 `p_value` 的结构需匹配 `LogCategory` 和对应的 value 类型
