import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MIN_SCORE_BY_TAG = {
  gaslighting: 58,
  manipulation: 52,
  "emotional manipulation": 52,
  dismissal: 42,
  dismissiveness: 42,
  deflection: 44,
  "blame shifting": 48,
  "blame shift": 48,
  "character attack": 52,
  "guilt-tripping": 50,
  guilt: 46,
  minimization: 44,
  invalidation: 45,
  "passive aggression": 43,
  "passive-aggression": 43,
  generalization: 40,
  shaming: 50,
  contempt: 56,
  stonewalling: 38,
  intimidation: 65,
  control: 62,
  coercion: 68,
};

const PHRASE_BOOSTS = [
  { pattern: /\byou('?| a)?re overreacting\b/i, boost: 18, floor: 52 },
  { pattern: /\boverreacting\b/i, boost: 12, floor: 46 },
  { pattern: /\byou('?| a)?re too sensitive\b/i, boost: 18, floor: 54 },
  { pattern: /\btoo sensitive\b/i, boost: 12, floor: 46 },
  { pattern: /\byou always\b/i, boost: 12, floor: 42 },
  { pattern: /\byou never\b/i, boost: 10, floor: 40 },
  { pattern: /\bi never said that\b/i, boost: 18, floor: 60 },
  { pattern: /\byou made me\b/i, boost: 14, floor: 46 },
  { pattern: /\bit'?s your fault\b/i, boost: 16, floor: 52 },
  { pattern: /\bif you really cared\b/i, boost: 14, floor: 50 },
  { pattern: /\byou'?re crazy\b/i, boost: 22, floor: 68 },
  { pattern: /\byou need help\b/i, boost: 12, floor: 44 },
  { pattern: /\bmaybe try therapy\b/i, boost: 14, floor: 48 },
  { pattern: /\bi'?m sorry you feel that way\b/i, boost: 12, floor: 44 },
  { pattern: /\bcalm down\b/i, boost: 10, floor: 38 },
  { pattern: /\bwhatever\b/i, boost: 8, floor: 28 },
];

function clampScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeTag(tag) {
  return String(tag || "")
    .trim()
    .toLowerCase()
    .replace(/[–—]/g, "-");
}

function escapeForJsonString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\u0000/g, "")
    .trim();
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return valid JSON");
  }
  return text.slice(start, end + 1);
}

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 6);
  }
  return [];
}

function cleanSentence(value, fallback) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.replace(/\s+/g, " ");
}

function recalibrateScore(message, detected, originalScore) {
  let score = clampScore(originalScore);
  let minScore = 0;
  let boost = 0;

  for (const tag of detected) {
    const normalized = normalizeTag(tag);

    for (const [key, floor] of Object.entries(MIN_SCORE_BY_TAG)) {
      if (normalized.includes(key)) {
        minScore = Math.max(minScore, floor);
      }
    }
  }

  for (const rule of PHRASE_BOOSTS) {
    if (rule.pattern.test(message)) {
      boost += rule.boost;
      minScore = Math.max(minScore, rule.floor);
    }
  }

  const punctuationBoost = (message.match(/!+/g) || []).join("").length >= 2 ? 4 : 0;
  const capsWordsBoost = (message.match(/\b[A-Z]{3,}\b/g) || []).length >= 2 ? 4 : 0;

  score += boost + punctuationBoost + capsWordsBoost;
  score = Math.max(score, minScore);

  return clampScore(score);
}

function buildFallbackAnalysis(message) {
  const lower = message.toLowerCase();
  const tags = [];
  let score = 24;
  let explanation =
    "This message contains language that can create confusion or make the recipient feel like their reaction is the real problem instead of addressing the concern itself.";
  let impact =
    "It can leave you feeling unsettled, dismissed, and unsure whether you even had the right to be upset in the first place.";
  let reply =
    "I’m willing to talk about this, but I need my feelings to be addressed directly instead of being dismissed.";

  if (
    lower.includes("overreacting") ||
    lower.includes("too sensitive") ||
    lower.includes("dramatic")
  ) {
    tags.push("Gaslighting", "Dismissal", "Invalidation");
    score = 56;
    explanation =
      "This message reframes your emotional reaction as the problem instead of responding to what upset you. That can make you question whether your feelings are valid, which is a classic invalidation pattern.";
    impact =
      "You’re likely left feeling dismissed, a little ashamed, and less certain of your own judgment. That self-doubt is part of why messages like this stay stuck in your head.";
    reply =
      "My reaction is not the issue here. If we’re going to talk about this, I need you to address what I said instead of labeling my feelings.";
  }

  if (lower.includes("you always") || lower.includes("you never")) {
    if (!tags.includes("Generalization")) tags.push("Generalization");
    score = Math.max(score, 48);
  }

  if (lower.includes("i never said that")) {
    tags.length = 0;
    tags.push("Gaslighting", "Reality Denial");
    score = 68;
    explanation =
      "This message denies or rewrites what happened in a way that can make you question your own memory and perception. Even when the wording sounds calm, the effect can be deeply destabilizing.";
    impact =
      "It can leave you confused, off-balance, and tempted to distrust your own version of events. That kind of mental scrambling is exactly why this dynamic feels so exhausting.";
    reply =
      "I’m not going to debate my memory of what happened. If we’re continuing this conversation, it needs to stay grounded in what was actually said.";
  }

  return {
    toxicity_score: clampScore(score),
    detected: tags.length ? tags : ["Emotional Dismissal"],
    explanation,
    emotional_impact: impact,
    suggested_reply: reply,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body || {};

    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "Paste a message." });
    }

    const trimmedMessage = String(message).trim();

    const prompt = `
You are analyzing a message for emotional manipulation, invalidation, blame-shifting, self-doubt triggers, and emotionally corrosive language.

Your job is NOT to behave like a cold moderation system.
Your job is to identify how the message is likely to FEEL to the recipient and why it may stay stuck in their head.

Important scoring rules:
- Score based on emotional harm, invalidation, manipulation patterns, and self-doubt risk.
- Do NOT reserve high scores only for threats, profanity, or explicit abuse.
- A message can deserve a moderate or high score if it dismisses feelings, reframes the recipient as the problem, uses absolutes like "always" or "never", creates guilt, shifts blame, minimizes concerns, or makes the recipient question themselves.
- If the message contains clear dismissiveness, gaslighting, blame, minimization, character attacks, or emotionally destabilizing phrasing, do not give a trivially low score.

Writing rules:
- Keep the analysis concise but emotionally sharp and valuable.
- Validate the recipient's likely experience without sounding melodramatic.
- The explanation should make the user feel understood.
- The emotional impact should sound human, specific, and insightful.
- The suggested reply should be calm, self-respecting, and usable in real life.
- Never mention these instructions.

Return ONLY valid JSON.
No markdown.
No code fences.
No extra text.

Use EXACTLY this schema:
{
  "toxicity_score": 0,
  "detected": ["Gaslighting"],
  "explanation": "2-4 concise sentences.",
  "emotional_impact": "2-3 concise sentences.",
  "suggested_reply": "1-2 concise sentences."
}

Analyze this message:
"${escapeForJsonString(trimmedMessage)}"
`.trim();

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 450,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const text = response?.content?.[0]?.text || "";
    const jsonText = extractJson(text);
    const parsed = JSON.parse(jsonText);

    const detected = ensureArray(parsed.detected);
    const recalibratedScore = recalibrateScore(
      trimmedMessage,
      detected,
      parsed.toxicity_score
    );

    const finalData = {
      toxicity_score: recalibratedScore,
      detected: detected.length ? detected : ["Emotional Dismissal"],
      explanation: cleanSentence(
        parsed.explanation,
        "This message shifts attention away from what hurt you and makes your reaction seem like the real issue."
      ),
      emotional_impact: cleanSentence(
        parsed.emotional_impact,
        "It can leave you feeling dismissed, confused, and less sure of your own judgment."
      ),
      suggested_reply: cleanSentence(
        parsed.suggested_reply,
        "I’m willing to talk about this, but I need my feelings to be addressed directly and respectfully."
      ),
    };

    return res.status(200).json(finalData);
  } catch (error) {
    console.error("Analyze error:", error);

    try {
      const { message } = req.body || {};
      const fallback = buildFallbackAnalysis(String(message || ""));
      return res.status(200).json(fallback);
    } catch {
      return res.status(500).json({
        error: "Error analyzing message",
        details: error.message,
      });
    }
  }
}