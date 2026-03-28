import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MIN_SCORE_BY_TAG = {
  gaslighting: 60,
  manipulation: 55,
  dismissal: 45,
  deflection: 48,
  "blame shifting": 50,
  "character attack": 55,
  guilt: 48,
  minimization: 46,
  invalidation: 50,
  generalization: 44,
};

const PHRASE_BOOSTS = [
  { pattern: /\boverreacting\b/i, boost: 15, floor: 55 },
  { pattern: /\btoo sensitive\b/i, boost: 15, floor: 55 },
  { pattern: /\byou always\b/i, boost: 12, floor: 45 },
  { pattern: /\byou never\b/i, boost: 10, floor: 42 },
  { pattern: /\bi never said that\b/i, boost: 20, floor: 65 },
  { pattern: /\bit'?s your fault\b/i, boost: 18, floor: 60 },
  { pattern: /\bi'?m sorry you feel that way\b/i, boost: 14, floor: 50 },
];

function clampScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeTag(tag) {
  return String(tag || "").toLowerCase();
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

  score += boost;
  score = Math.max(score, minScore);

  return clampScore(score);
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return text.slice(start, end + 1);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Paste a message." });
    }

    const prompt = `
You are analyzing a message for emotional manipulation.

This is NOT a moderation task.
This is a psychological clarity task.

Your job is to explain WHY this message feels wrong, confusing, or emotionally heavy.

Scoring rules:
- Score based on emotional impact, not just aggression.
- If the message causes doubt, confusion, guilt, or invalidation → score should NOT be low.
- Do NOT be conservative.
- Messages that make someone question themselves should be mid/high score.

Writing style:
- Make the user feel understood immediately.
- Be emotionally precise, not generic.
- Do not sound robotic or academic.
- Avoid fluff.

CRITICAL:
Explain WHY this message stays in the person's head.
Explain WHAT it subtly does psychologically.

Return ONLY JSON:

{
  "toxicity_score": number,
  "detected": ["Gaslighting"],
  "explanation": "Clear, emotionally sharp explanation (2-4 sentences).",
  "emotional_impact": "Make the user feel seen (2-3 sentences).",
  "suggested_reply": "Short, confident, real-world usable response."
}

Message:
${message}
`;

    const response = await anthropic.messages.create({
      model: "model: "claude-haiku-4-5"",
      max_tokens: 400,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].text;
    const jsonText = extractJson(text);
    const data = JSON.parse(jsonText);

    const finalScore = recalibrateScore(
      message,
      data.detected || [],
      data.toxicity_score
    );

    return res.status(200).json({
      toxicity_score: finalScore,
      detected: data.detected || [],
      explanation: data.explanation,
      emotional_impact: data.emotional_impact,
      suggested_reply: data.suggested_reply,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Error analyzing message",
      details: error.message,
    });
  }
}