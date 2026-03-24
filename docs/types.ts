/**
 * LinkSteps — TypeScript 类型定义
 * 供 Frontend 使用，与数据库 schema 对应
 */

// ============================================================
// 枚举 / 联合类型
// ============================================================

export type UserRole = 'parent' | 'teacher';

export type LogCategory = 'mood' | 'behavior' | 'sleep' | 'meal' | 'medication' | 'note';

export type InvitationStatus = 'pending' | 'active' | 'revoked';

export type FeedbackEmoji = 'star' | 'heart' | 'thumbsup';

// ============================================================
// 数据库行类型 (对应 Supabase table rows)
// ============================================================

export interface Profile {
  id: string;
  role: UserRole;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Child {
  id: string;
  parent_id: string;
  name: string;
  date_of_birth: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChildTeacher {
  id: string;
  child_id: string;
  teacher_id: string;
  invited_by: string;
  status: InvitationStatus;
  created_at: string;
}

export interface DailyLog {
  id: string;
  child_id: string;
  log_date: string;
  author_id: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface LogEntry {
  id: string;
  daily_log_id: string;
  category: LogCategory;
  value: LogEntryValue;
  created_at: string;
}

export interface Feedback {
  id: string;
  child_id: string;
  author_id: string;
  recipient_id: string;
  content: string;
  emoji: FeedbackEmoji | null;
  is_read: boolean;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

// ============================================================
// LogEntry value 类型 (JSONB 字段的结构化类型)
// ============================================================

export interface MoodValue {
  level: 1 | 2 | 3 | 4 | 5;
  label: string;
  icon_name: 'sun' | 'smile' | 'cloud' | 'cloud-rain' | 'zap';
}

export interface SleepValue {
  hours: number;
  quality: 'poor' | 'fair' | 'good' | 'excellent';
}

export interface MealValue {
  type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  amount: 'none' | 'little' | 'half' | 'full';
}

export interface MedicationValue {
  name: string;
  taken: boolean;
}

export interface BehaviorValue {
  description: string;
  intensity: 1 | 2 | 3 | 4 | 5;
}

export interface NoteValue {
  text: string;
}

export type LogEntryValue =
  | MoodValue
  | SleepValue
  | MealValue
  | MedicationValue
  | BehaviorValue
  | NoteValue;

// ============================================================
// 关联查询的扩展类型 (用于前端展示)
// ============================================================

/** daily_logs 含所有 log_entries */
export interface DailyLogWithEntries extends DailyLog {
  log_entries: LogEntry[];
}

/** feedback 含作者信息 */
export interface FeedbackWithAuthor extends Feedback {
  author: Pick<Profile, 'display_name' | 'avatar_url'>;
}

/** child 含关联老师列表 */
export interface ChildWithTeachers extends Child {
  child_teacher: (ChildTeacher & {
    teacher: Pick<Profile, 'id' | 'display_name' | 'avatar_url'>;
  })[];
}

// ============================================================
// 表单 / 插入类型 (省略自动生成字段)
// ============================================================

export type ProfileInsert = Pick<Profile, 'id' | 'role' | 'display_name'> &
  Partial<Pick<Profile, 'avatar_url'>>;

export type ProfileUpdate = Partial<Pick<Profile, 'display_name' | 'avatar_url'>>;

export type ChildInsert = Pick<Child, 'parent_id' | 'name'> &
  Partial<Pick<Child, 'date_of_birth' | 'avatar_url'>>;

export type ChildUpdate = Partial<Pick<Child, 'name' | 'date_of_birth' | 'avatar_url'>>;

export type DailyLogUpsert = Pick<DailyLog, 'child_id' | 'log_date' | 'author_id'> &
  Partial<Pick<DailyLog, 'summary'>>;

export type LogEntryInsert = Pick<LogEntry, 'daily_log_id' | 'category' | 'value'>;

export type FeedbackInsert = Pick<Feedback, 'child_id' | 'author_id' | 'recipient_id' | 'content'> &
  Partial<Pick<Feedback, 'emoji'>>;

export type ChildTeacherInsert = Pick<ChildTeacher, 'child_id' | 'teacher_id' | 'invited_by'>;

// ============================================================
// RPC 调用类型 (Supabase RPC 函数的输入/输出)
// ============================================================

/** bulk_create_log_entries RPC 输入参数 */
export interface BulkCreateLogEntriesInput {
  p_child_ids: string[];
  p_category: LogCategory;
  p_value: LogEntryValue;
  p_log_date?: string; // ISO 8601 日期，默认今天
}

/** bulk_create_log_entries RPC 返回值：新创建的 log_entry ID 数组 */
export type BulkCreateLogEntriesResult = string[];
