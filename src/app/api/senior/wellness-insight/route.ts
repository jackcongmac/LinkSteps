// src/app/api/senior/wellness-insight/route.ts
//
// POST /api/senior/wellness-insight
//
// Fully server-side: authenticates the caller, resolves their senior profile
// and baselines from Supabase, auto-seeds defaults if no baseline exists,
// then calls Claude (via @ai-sdk/anthropic) with all context injected into
// the system prompt.  Falls back to rules-based advice on any failure.

import { anthropic }          from "@ai-sdk/anthropic";
import { generateText }       from "ai";
import { createServerClient } from "@/lib/supabase-server";
import { calculateSeniorWellness } from "@/lib/wellness-score";
import type { WellnessInput }  from "@/lib/wellness-score";

// ── Types ─────────────────────────────────────────────────────

interface SeniorProfile {
  id:               string;
  name:             string;
  age:              number | null;
  gender:           "男" | "女" | null;
  relationship:     string | null;
  custom_relation:  string | null;
}

interface Baselines {
  avg_steps:       number;
  avg_resting_hr:  number;
  avg_sleep_hours: number;
  avg_hrv:         number | null;
}

const DEFAULT_BASELINES: Baselines = {
  avg_steps:       3000,
  avg_resting_hr:  72,
  avg_sleep_hours: 7.0,
  avg_hrv:         null,
};

// ── POST handler ──────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  let metrics: Partial<WellnessInput>;
  try {
    const body = await req.json() as { metrics: Partial<WellnessInput> };
    metrics = body.metrics ?? {};
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  // ── 1. Authenticate ──────────────────────────────────────────
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  // ── 2. Resolve senior profile (creator = auth.uid()) ─────────
  const { data: profileRow } = await supabase
    .from("senior_profiles")
    .select("id, name, age, gender, relationship, custom_relation")
    .eq("created_by", user.id)
    .limit(1)
    .maybeSingle();

  const profile = profileRow as SeniorProfile | null;
  const seniorId = profile?.id ?? null;

  // ── 3. Fetch baselines; auto-seed defaults if absent ─────────
  let baselines: Baselines = DEFAULT_BASELINES;

  if (seniorId) {
    const { data: baselineRow } = await supabase
      .from("senior_baselines")
      .select("avg_steps, avg_resting_hr, avg_sleep_hours, avg_hrv")
      .eq("senior_id", seniorId)
      .maybeSingle();

    if (baselineRow) {
      const b = baselineRow as {
        avg_steps: number | null;
        avg_resting_hr: number | null;
        avg_sleep_hours: number | null;
        avg_hrv: number | null;
      };
      baselines = {
        avg_steps:       b.avg_steps       ?? DEFAULT_BASELINES.avg_steps,
        avg_resting_hr:  b.avg_resting_hr  ?? DEFAULT_BASELINES.avg_resting_hr,
        avg_sleep_hours: b.avg_sleep_hours ?? DEFAULT_BASELINES.avg_sleep_hours,
        avg_hrv:         b.avg_hrv,
      };
    } else {
      // Auto-seed: insert defaults so AI always has a baseline reference
      await supabase.from("senior_baselines").upsert(
        {
          senior_id:       seniorId,
          avg_steps:       DEFAULT_BASELINES.avg_steps,
          avg_resting_hr:  DEFAULT_BASELINES.avg_resting_hr,
          avg_sleep_hours: DEFAULT_BASELINES.avg_sleep_hours,
          avg_hrv:         35,
          computed_at:     new Date().toISOString(),
        },
        { onConflict: "senior_id" },
      );
    }
  }

  // ── 4. Rules-based score + level (deterministic fallback) ────
  const rulesResult = calculateSeniorWellness(metrics);

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(rulesResult);
  }

  // ── 5. Build context-aware prompt ────────────────────────────
  const systemPrompt = buildSystemPrompt(profile, baselines);
  const userPrompt   = buildUserPrompt(metrics, baselines);

  try {
    const { text } = await generateText({
      model:           anthropic("claude-haiku-4-5-20251001"),
      system:          systemPrompt,
      prompt:          userPrompt,
      maxOutputTokens: 100,
    });

    return Response.json({
      score:  rulesResult.score,
      level:  rulesResult.level,
      advice: text.trim() || rulesResult.advice,
    });
  } catch (err) {
    console.error("[wellness-insight] AI call failed:", err);
    return Response.json(rulesResult);
  }
}

// ── Prompt builders ───────────────────────────────────────────

function buildSystemPrompt(
  profile:   SeniorProfile | null,
  baselines: Baselines,
): string {
  // Resolve display identity from profile
  const name         = profile?.name        ?? "这位长辈";
  const age          = profile?.age         ?? null;
  const gender       = profile?.gender      ?? null;
  const relation     = profile?.custom_relation ?? profile?.relationship ?? "家人";

  const ageStr    = age    ? `${age}岁` : "年龄未知";
  const genderStr = gender ? `${gender}性` : "";
  const pronoun   = gender === "男" ? "他" : gender === "女" ? "她" : "老人家";

  return `你是一位专注于老年健康关怀的AI助手，为中国独生子女一代提供每日健康分析简报。

你正在分析的长辈：
- 姓名：${name}
- 基本信息：${[ageStr, genderStr].filter(Boolean).join("，")}
- 与晚辈关系：${relation}

${name}的7天个人基线（参考）：
- 日均步数：${Math.round(baselines.avg_steps).toLocaleString()} 步
- 静息心率：${Math.round(baselines.avg_resting_hr)} 次/分
- 每晚睡眠：${baselines.avg_sleep_hours.toFixed(1)} 小时

金科玉律（必须遵守）：
1. 直接称呼长辈姓名（如"${name}今天……"），而非"老人家"或"长辈"。
2. 绝不使用医学缩写或专业术语——将技术指标翻译成生活语言。
3. 结合${pronoun}的个人基线，判断今天的数据是高于、低于还是符合${pronoun}平时的状态。
4. 语气温暖积极，像了解${name}多年的朋友，不像医生写报告。
5. 只给一条最具体的行动建议（例如：提醒喝水、建议午睡、鼓励散步）。
6. 回复控制在30个汉字以内，简洁有力。
7. 绝不使用"异常"、"警告"、"危险"、"需立即就医"等令人焦虑的词汇。`;
}

function buildUserPrompt(
  metrics:   Partial<WellnessInput>,
  baselines: Baselines,
): string {
  const { pressure = 1013, sleep = 7, steps = 0, heartRate = 75 } = metrics;

  const stepsDelta = steps - baselines.avg_steps;
  const hrDelta    = heartRate - baselines.avg_resting_hr;
  const sleepDelta = sleep - baselines.avg_sleep_hours;

  const stepsNote = stepsDelta >= 300
    ? `（比平时多 ${Math.round(stepsDelta)} 步）`
    : stepsDelta <= -300
    ? `（比平时少 ${Math.abs(Math.round(stepsDelta))} 步）`
    : "（接近平时水平）";

  const hrNote = hrDelta >= 8
    ? `（比平时偏高 ${Math.round(hrDelta)} 次）`
    : hrDelta <= -8
    ? `（比平时偏低 ${Math.abs(Math.round(hrDelta))} 次）`
    : "（接近平时水平）";

  const sleepNote = sleepDelta >= 0.5
    ? `（比平时多睡 ${sleepDelta.toFixed(1)} 小时）`
    : sleepDelta <= -0.5
    ? `（比平时少睡 ${Math.abs(sleepDelta).toFixed(1)} 小时）`
    : "（接近平时水平）";

  return [
    "今天的数据：",
    `- 心率：${heartRate} 次/分 ${hrNote}`,
    `- 步数：${steps.toLocaleString()} 步 ${stepsNote}`,
    `- 昨晚睡眠：${sleep.toFixed(1)} 小时 ${sleepNote}`,
    `- 北京气压：${pressure} hPa`,
    "",
    "请根据以上数据，结合这位长辈的个人基线，用一句温暖中文给晚辈提供今日健康建议。",
  ].join("\n");
}
