// src/app/api/senior/wellness-insight/route.ts
//
// POST /api/senior/wellness-insight
//
// Fully server-side pipeline:
//   1. Auth via cookie session
//   2. Fetch senior_profile (name / age / gender / relationship)
//   3. Fetch / auto-seed senior_baselines
//   4. Import personality persona (src/data/senior-persona.json)
//   5. Call Claude-Haiku with a context-rich prompt that knows the senior's
//      routine, hobby, health conditions, family, and today's weather
//   6. Fallback to rules-based advice if AI unavailable

import { anthropic }          from "@ai-sdk/anthropic";
import { generateText }       from "ai";
import { createServerClient } from "@/lib/supabase-server";
import { calculateSeniorWellness } from "@/lib/wellness-score";
import type { WellnessInput }  from "@/lib/wellness-score";
import persona from "@/data/senior-persona.json";

// ── Types ─────────────────────────────────────────────────────

interface SeniorProfile {
  id:              string;
  name:            string;
  age:             number | null;
  gender:          "男" | "女" | null;
  relationship:    string | null;
  custom_relation: string | null;
}

interface Baselines {
  avg_steps:       number;
  avg_resting_hr:  number;
  avg_sleep_hours: number;
  avg_hrv:         number | null;
}

interface RequestBody {
  metrics:     Partial<WellnessInput>;
  weatherText?: string;   // e.g. "晴", "多云", "大风", "小雨"
  iconCode?:   string;    // QWeather icon code, e.g. "100", "205", "305"
}

const DEFAULT_BASELINES: Baselines = {
  avg_steps:       3000,
  avg_resting_hr:  72,
  avg_sleep_hours: 7.0,
  avg_hrv:         null,
};

// ── Weather helpers ───────────────────────────────────────────

/** Returns true for wind (200-213) or precipitation (300-499) icon codes */
function isBadWeather(iconCode?: string, weatherText?: string): boolean {
  if (iconCode) {
    const n = parseInt(iconCode, 10);
    if (n >= 200 && n <= 213) return true; // wind
    if (n >= 300 && n <= 499) return true; // rain / snow
    if (n >= 500 && n <= 599) return true; // fog / haze — also unsuitable for elderly walk
  }
  // Fallback: keyword check in Chinese weather text
  if (weatherText) {
    return /风|雨|雪|雾|霾|沙尘/.test(weatherText);
  }
  return false;
}

// ── POST handler ──────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const { metrics = {}, weatherText, iconCode } = body;

  // ── 1. Authenticate ──────────────────────────────────────────
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });

  // ── 2. Resolve senior profile ────────────────────────────────
  const { data: profileRow } = await supabase
    .from("senior_profiles")
    .select("id, name, age, gender, relationship, custom_relation")
    .eq("created_by", user.id)
    .limit(1)
    .maybeSingle();

  const profile  = profileRow as SeniorProfile | null;
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
        avg_steps: number | null; avg_resting_hr: number | null;
        avg_sleep_hours: number | null; avg_hrv: number | null;
      };
      baselines = {
        avg_steps:       b.avg_steps       ?? DEFAULT_BASELINES.avg_steps,
        avg_resting_hr:  b.avg_resting_hr  ?? DEFAULT_BASELINES.avg_resting_hr,
        avg_sleep_hours: b.avg_sleep_hours ?? DEFAULT_BASELINES.avg_sleep_hours,
        avg_hrv:         b.avg_hrv,
      };
    } else {
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

  // ── 4. Rules-based fallback (deterministic) ──────────────────
  const rulesResult = calculateSeniorWellness(metrics);
  if (!process.env.ANTHROPIC_API_KEY) return Response.json(rulesResult);

  // ── 5. Build prompts and call Claude ─────────────────────────
  const badWeather = isBadWeather(iconCode, weatherText);

  try {
    const { text } = await generateText({
      model:           anthropic("claude-haiku-4-5-20251001"),
      system:          buildSystemPrompt(profile, baselines, badWeather),
      prompt:          buildUserPrompt(metrics, baselines, weatherText, badWeather),
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
  profile:    SeniorProfile | null,
  baselines:  Baselines,
  badWeather: boolean,
): string {
  const name     = profile?.name            ?? "这位长辈";
  const age      = profile?.age             ?? null;
  const gender   = profile?.gender          ?? null;
  const relation = profile?.custom_relation ?? profile?.relationship ?? "家人";
  const pronoun  = gender === "男" ? "他" : gender === "女" ? "她" : "老人家";
  const ageStr   = age ? `${age}岁` : "年龄未知";
  const genderStr = gender ? `${gender}性` : "";

  const walkInstruction = badWeather
    ? `【今日天气不佳】今天有风或下雨，${name}不适合出门晨练。请明确建议留在室内，可以做室内操、听音乐或陪伴家人。`
    : `今天天气适合出门，如果${name}状态良好，可以鼓励${pronoun}按时出门晨练。`;

  return `你是一位专注于老年健康关怀的AI助手，为中国独生子女一代提供每日健康分析简报。

【正在分析的长辈】
- 姓名：${name}
- 基本信息：${[ageStr, genderStr].filter(Boolean).join("，")}
- 与晚辈关系：${relation}

【${name}的个人7天基线】
- 日均步数：${Math.round(baselines.avg_steps).toLocaleString()} 步
- 静息心率：${Math.round(baselines.avg_resting_hr)} 次/分
- 每晚睡眠：${baselines.avg_sleep_hours.toFixed(1)} 小时

【${name}的日常作息】
- 每天早上5点醒来，6点起床
- 早饭后出门晨练，与老朋友晒太阳聊天，直到午饭时间
- 下午2点左右午睡
- 孙子名叫 Ethan（提到孙辈时使用此名字）

【健康状况（关键）】
- 慢性病：高血压、心脏疾病、肺部阴影、糖尿病
- 每日服用多种药物
- ⚠️ 所有建议必须以心脏稳定和血糖稳定为最高优先级
- ⚠️ 不建议剧烈运动或长时间高强度活动

【今日晨练建议】
${walkInstruction}

【金科玉律（必须遵守）】
1. 直接称呼"${name}"，不要用"老人家"或"长辈"。
2. 绝不使用医学缩写或专业术语，将技术指标翻译成日常语言。
3. 结合${pronoun}的个人基线，说明今天数据是否符合${pronoun}平时的状态。
4. 语气温暖，像了解${name}多年的老朋友，而非医生写报告。
5. 只给一条最具体的行动建议。
6. 回复控制在30个汉字以内，简洁有力。
7. 绝不使用"异常"、"警告"、"危险"、"立即就医"等令人焦虑的词汇。`;
}

function buildUserPrompt(
  metrics:     Partial<WellnessInput>,
  baselines:   Baselines,
  weatherText: string | undefined,
  badWeather:  boolean,
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

  const weatherLine = weatherText
    ? `- 今日天气：${weatherText}${badWeather ? "（不适合出门晨练）" : "（适合出门晨练）"}`
    : `- 北京气压：${pressure} hPa`;

  return [
    "今天的数据：",
    `- 心率：${heartRate} 次/分 ${hrNote}`,
    `- 步数：${steps.toLocaleString()} 步 ${stepsNote}`,
    `- 昨晚睡眠：${sleep.toFixed(1)} 小时 ${sleepNote}`,
    weatherLine,
    "",
    "请根据以上数据，结合她的个人基线、健康状况和今日天气，用一句温暖中文给晚辈提供今日健康建议。",
  ].join("\n");
}
