# Messaging, Voice Memo & Family Timeline — Design Spec

**Date:** 2026-03-30
**Status:** Approved
**Feature:** 平安扣通讯层 — 文字消息 + 语音备忘 + 统一家庭动态

---

## Goal

让晚辈（Jack）可以给老人发文字问候，老人可以录制语音回复，双方通过统一的「家庭动态」时间线保持情感连接。

---

## Architecture

### 选型：方案 A — 在现有页面扩展

不新增独立 Tab/页面，直接在现有的 `/senior-home` 和 `/carer` 页面上叠加功能。理由：
- 老人端保持极简，一屏可见所有信息
- 晚辈端升级现有 Timeline，不破坏已有交互

### 数据流

```
Carer types message
  → INSERT messages (type='text', sender_role='carer')
  → Realtime pushes to senior-home
  → MessageBanner updates + heart animation
  → Senior taps 🔊 → speechSynthesis reads aloud

Senior taps record
  → MediaRecorder captures audio
  → Upload to Supabase Storage (voice-memos bucket)
  → INSERT messages (type='voice', sender_role='senior', audio_url=...)
  → Realtime pushes to carer dashboard
  → FamilyTimeline shows play button
```

---

## Database

### 新表：`messages`

```sql
CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id        uuid NOT NULL REFERENCES senior_profiles(id) ON DELETE CASCADE,
  sender_id        uuid NOT NULL REFERENCES auth.users(id),
  sender_role      text NOT NULL CHECK (sender_role IN ('carer', 'senior')),
  type             text NOT NULL CHECK (type IN ('text', 'voice')),
  content          text,        -- text messages; NULL for voice
  audio_url        text,        -- Storage path; NULL for text
  audio_mime_type  text,        -- 'audio/webm' or 'audio/mp4'; NULL for text
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Enforce content/audio_url mutual exclusivity by type
  CONSTRAINT messages_content_check CHECK (
    (type = 'text'  AND content   IS NOT NULL AND audio_url IS NULL)
    OR
    (type = 'voice' AND audio_url IS NOT NULL AND content   IS NULL)
  )
);

CREATE INDEX messages_senior_time ON messages (senior_id, created_at DESC);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
```

### RLS Policies

```sql
-- Carers can read all messages for their seniors
CREATE POLICY "messages: carers can read"
  ON messages FOR SELECT
  USING (
    senior_id IN (SELECT id FROM senior_profiles WHERE created_by = auth.uid())
    OR
    senior_id IN (SELECT senior_id FROM carer_relationships WHERE carer_id = auth.uid())
  );

-- Phase 1 assumption: the senior's auth account IS the created_by account
-- (senior and carer share one login). The two SELECT policies are intentionally
-- equivalent for now. A future multi-login phase will add a separate senior auth flow.
-- The carer read policy above already covers the senior's read access in Phase 1.

-- Sender can insert their own messages, but only for a senior they are linked to
CREATE POLICY "messages: sender can insert"
  ON messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      senior_id IN (SELECT id FROM senior_profiles WHERE created_by = auth.uid())
      OR senior_id IN (SELECT senior_id FROM carer_relationships WHERE carer_id = auth.uid())
    )
  );
```

### Supabase Storage

- Bucket: `voice-memos` (private)
- Path convention: `{senior_id}/{message_id}.webm` (or `.mp4` — see format note below)
- **Upload policy:** authenticated users can upload to `{their_senior_id}/*` — enforced via Supabase Storage bucket policy (owner = uploader)
- **Download:** audio playback uses a server-side API route (`GET /api/senior/voice-url?messageId=`) that calls `supabase.storage.from('voice-memos').createSignedUrl(path, 300)` (5-min expiry). The signed URL is returned to the client and passed to an `<audio>` element. This avoids exposing the bucket to public reads.
- **Audio format:** Use `MediaRecorder.isTypeSupported('audio/webm')` first; fall back to `audio/mp4` for iOS Safari compatibility. Store the MIME type in `messages.audio_mime_type` so the player knows what to set on `<audio>`.

---

## Components

### 新增组件

| Component | Path | Responsibility |
|-----------|------|---------------|
| `MessageBanner` | `src/components/senior/senior/MessageBanner.tsx` | 老人端：显示最新 carer 文字消息 + 🔊 TTS 按钮 |
| `VoiceRecorder` | `src/components/senior/senior/VoiceRecorder.tsx` | 老人端：录音 + 上传到 Storage + 插入 messages |
| `ComposeMessage` | `src/components/senior/carer/ComposeMessage.tsx` | 晚辈端：文字输入框 + 发送按钮 |
| `FamilyTimeline` | `src/components/senior/carer/FamilyTimeline.tsx` | 晚辈端：合并 checkins + messages 的时间线 |
| HeartBurst animation | inlined in `MessageBanner.tsx` | 老人端：新消息到达时的心形粒子动画（纯 CSS keyframe，不单独成文件）|

### 修改现有文件

| File | Change |
|------|--------|
| `src/app/senior-home/page.tsx` | 加载最新 carer 消息；订阅 Realtime；渲染 MessageBanner + VoiceRecorder |
| `src/app/carer/page.tsx` | 加载 messages；订阅 Realtime；渲染 ComposeMessage；用 FamilyTimeline 替换 CheckinTimeline |
| `src/components/senior/carer/CheckinTimeline.tsx` | **Deprecated** — kept in place during transition; `FamilyTimeline` supersedes it. Delete after FamilyTimeline is confirmed working. |
| `supabase/migrations/` | 新增 messages 表迁移 SQL |

---

## Component Details

### Shared Types

```ts
// src/types/messages.ts
export interface MessageRow {
  id:              string;
  senior_id:       string;
  sender_id:       string;
  sender_role:     'carer' | 'senior';
  type:            'text' | 'voice';
  content:         string | null;
  audio_url:       string | null;
  audio_mime_type: string | null;  // e.g. 'audio/webm', 'audio/mp4'
  created_at:      string;
}
```

### `MessageBanner`

```tsx
interface MessageBannerProps {
  message: MessageRow | null;  // latest carer message
  isNew: boolean;              // triggers heart burst CSS animation (inlined keyframe)
}
```

- 无消息时：显示占位语（"Jack 还没有留言"），淡灰色
- 有消息时：显示消息文字 + 🔊 按钮
- 🔊 点击：`window.speechSynthesis.speak(new SpeechSynthesisUtterance(content))`，lang='zh-CN'
- `isNew=true` 时：触发 HeartBurst 动画

### `VoiceRecorder`

状态机：`idle → recording → uploading → done`

- idle：显示"🎙 发语音给 Jack"按钮
- recording：显示波形动画 + "停止" 按钮（最长 60 秒）
- uploading：显示 spinner，fire-and-forget，老人不等待
- done：显示"已发送 ✅"，3 秒后 reset to idle

录音格式：`audio/webm`（浏览器原生支持），上传至 Supabase Storage。

### `ComposeMessage`

- 单行输入框 + 发送按钮
- 发送后：input 清空，按钮短暂 confetti 动画（CSS keyframe）
- 字数限制：100 字（不显示计数器，超出 disable 发送按钮）

### `FamilyTimeline`

统一时间线，支持三种条目类型：

```tsx
type FeedItem =
  | { kind: 'checkin'; id: string; created_at: string; }
  | { kind: 'text';    id: string; created_at: string; content: string; sender_role: 'carer' | 'senior'; }
  | { kind: 'voice';   id: string; created_at: string; audio_url: string; sender_role: 'carer' | 'senior'; }
```

- 在客户端将 `checkins[]` + `messages[]` 合并排序（`created_at DESC`）
- 语音条目显示播放按钮，点击用 `<audio>` 元素播放（carer 端）
- 老人端的 FamilyTimeline 只读，不显示发送入口

### HeartBurst animation (inlined in `MessageBanner`)

- CSS keyframe：5-8 个 ❤️ 从 MessageBanner 向上漂浮 + 渐隐，持续 1.2s
- `isNew=true` 时渲染；`onAnimationEnd` 后父组件 reset `isNew=false`
- 不是独立组件，直接写在 `MessageBanner.tsx` 内部

---

## Realtime

### 晚辈端订阅

Both subscriptions must include `filter: \`senior_id=eq.${seniorId}\`` to avoid receiving events for other seniors. Supabase Realtime row-filters require the filtered column to be in the table's `REPLICA IDENTITY` (the default `REPLICA IDENTITY DEFAULT` uses the primary key only — must be upgraded to `FULL` or use a filtered publication if row-level filter is needed). For MVP, filter in JS via `seniorIdRef.current` guard (same pattern already used in the live checkins subscription).

```ts
supabase.channel('carer-dashboard')
  .on('postgres_changes', { event: 'INSERT', table: 'checkins' }, (p) => {
    if (p.new.senior_id !== seniorIdRef.current) return;
    // ...
  })
  .on('postgres_changes', { event: 'INSERT', table: 'messages' }, (p) => {
    if (p.new.senior_id !== seniorIdRef.current) return;
    // ...
  })
  .subscribe()
```

### 老人端订阅

```ts
supabase.channel('senior-home')
  .on('postgres_changes', {
    event: 'INSERT', table: 'messages',
    filter: `senior_id=eq.${seniorId}`
  }, handleNewMessage)
  .subscribe()
```

---

## Error Handling

- **VoiceRecorder 上传失败**：静默失败，显示"已发送 ✅"（老人不看错误）；`console.error` 记录。已知后果：晚辈端 FamilyTimeline 不会出现此条语音，属于 MVP 可接受的静默丢失。如需可靠性保证，Phase 2 可加重试队列。
- **TTS 不可用**（浏览器不支持）：🔊 按钮不渲染，只显示文字
- **ComposeMessage 发送失败**：晚辈侧可以看到错误（toast 或 inline），重试即可
- **Storage URL 过期**：语音播放前重新获取 signed URL

---

## Out of Scope (MVP)

- 消息已读回执
- 推送通知（PWA Push API）
- 消息删除
- 图片发送
- 老人端发文字消息

---

## Testing Checklist

- [ ] Carer 发文字 → 老人端 MessageBanner 实时更新
- [ ] 老人端点击🔊 → 中文语音朗读
- [ ] 老人录音 → Storage 有文件 → carer FamilyTimeline 出现语音条目
- [ ] Carer 点击语音条目 → 播放
- [ ] FamilyTimeline 正确按时间倒序合并 checkins + messages
- [ ] HeartBurst 在新消息到达时触发，1.2s 后消失
- [ ] TTS 不可用时🔊按钮不显示（不报错）
- [ ] 60 秒录音上限正常工作
