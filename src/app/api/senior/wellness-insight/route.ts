// src/app/api/senior/wellness-insight/route.ts
//
// POST /api/senior/wellness-insight
//
// Accepts today's health metrics + 7-day baselines.
// 1. Computes a deterministic score + level via rules.
// 2. Calls Claude (via @ai-sdk/anthropic) to generate a warm, actionable
//    one-sentence advice string following the Golden Rules.
// 3. Falls back to the rules-based advice string if the AI call fails or
//    ANTHROPIC_API_KEY is absent.

import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { calculateSeniorWellness } from "@/lib/wellness-score";
import type { WellnessInput } from "@/lib/wellness-score";

export const runtime = "edge";

interface Baselines {
  avg_steps?:       number | null;
  avg_resting_hr?:  number | null;
  avg_sleep_hours?: number | null;
}

interface WellnessInsightRequest {
  metrics:   Partial<WellnessInput>;
  baselines: Baselines | null;
}

// ── Golden-rules system prompt ────────────────────────────────

const SYSTEM_PROMPT = `你是一位专注于老年健康关怀的AI助手，为关心父母的子女提供每日健康分析简报。

金科玉律（必须遵守）：
1. 绝不使用医学缩写或专业术语——将"心率变异性低"说成"今天看起来有些累"。
2. 语气温暖、积极，像了解这位老人的家庭朋友，不像医生写报告。
3. 每次分析只给一条最具体的行动建议（例如：提醒喝水、建议午睡、鼓励外出）。
4. 回复控制在 30 个汉字以内，简洁有力。
5. 绝不使用"异常"、"警告"、"危险"、"需立即就医"等令人焦虑的词汇。
6. 状态良好时，语气轻快愉悦；需要关注时，语气平和关切，而非紧张。`;

// ── Build the per-request user prompt ─────────────────────────

function buildUserPrompt(
  metrics:   Partial<WellnessInput>,
  baselines: Baselines | null,
): string {
  const { pressure = 1013, sleep = 7, steps = 0, heartRate = 75 } = metrics;

  const lines: string[] = [
    `今天的数据：`,
    `- 心率：${heartRate} 次/分${baselines?.avg_resting_hr ? `（7天平均：${Math.round(baselines.avg_resting_hr)} 次/分）` : ""}`,
    `- 步数：${steps.toLocaleString()} 步${baselines?.avg_steps ? `（7天平均：${Math.round(baselines.avg_steps).toLocaleString()} 步）` : ""}`,
    `- 昨晚睡眠：${sleep.toFixed(1)} 小时${baselines?.avg_sleep_hours ? `（7天平均：${baselines.avg_sleep_hours.toFixed(1)} 小时）` : ""}`,
    `- 北京气压：${pressure} hPa`,
    ``,
    `请根据以上数据，用一句温暖中文给晚辈提供今日健康建议。`,
  ];

  return lines.join("\n");
}

// ── POST handler ──────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  let body: WellnessInsightRequest;
  try {
    body = await req.json() as WellnessInsightRequest;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const { metrics, baselines } = body;

  // Rules-based result — always computed as fallback
  const rulesResult = calculateSeniorWellness(metrics);

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(rulesResult);
  }

  try {
    const { text } = await generateText({
      model:     anthropic("claude-haiku-4-5-20251001"),
      system:    SYSTEM_PROMPT,
      prompt:    buildUserPrompt(metrics, baselines),
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
