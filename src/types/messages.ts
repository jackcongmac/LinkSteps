// src/types/messages.ts

/** Special content markers for quick-request messages (stored as type='text') */
export const WECHAT_REQUEST = "__WECHAT_REQUEST__";
export const CALL_REQUEST   = "__CALL_REQUEST__";

export interface MessageRow {
  id:              string;
  senior_id:       string;
  sender_id:       string;
  sender_role:     'carer' | 'senior';
  type:            'text' | 'voice';
  content:         string | null;
  audio_url:       string | null;
  audio_mime_type: string | null;
  is_read:         boolean;
  read_at:         string | null;
  created_at:      string;
}

export type FeedItem =
  | { kind: 'checkin';       id: string; created_at: string }
  | { kind: 'text';          id: string; created_at: string; content: string; sender_role: 'carer' | 'senior'; is_read: boolean }
  | { kind: 'voice';         id: string; created_at: string; audio_url: string; audio_mime_type: string | null; sender_role: 'carer' | 'senior' }
  | { kind: 'wechat_request'; id: string; created_at: string; sender_role: 'carer' | 'senior' }
  | { kind: 'call_request';   id: string; created_at: string; sender_role: 'carer' | 'senior' };

/** Merge checkins + messages into one sorted feed (newest first) */
export function buildFeed(
  checkins: { id: string; checked_in_at: string }[],
  messages: MessageRow[],
): FeedItem[] {
  const items: FeedItem[] = [
    ...checkins.map((c) => ({
      kind: 'checkin' as const,
      id: c.id,
      created_at: c.checked_in_at,
    })),
    ...messages.map((m): FeedItem => {
      if (m.type === 'voice') {
        return {
          kind: 'voice',
          id: m.id,
          created_at: m.created_at,
          audio_url: m.audio_url!,
          audio_mime_type: m.audio_mime_type,
          sender_role: m.sender_role,
        };
      }
      if (m.content === WECHAT_REQUEST) {
        return { kind: 'wechat_request', id: m.id, created_at: m.created_at, sender_role: m.sender_role };
      }
      if (m.content === CALL_REQUEST) {
        return { kind: 'call_request', id: m.id, created_at: m.created_at, sender_role: m.sender_role };
      }
      return {
        kind: 'text',
        id: m.id,
        created_at: m.created_at,
        content: m.content!,
        sender_role: m.sender_role,
        is_read: m.is_read,
      };
    }),
  ];
  return items.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}
