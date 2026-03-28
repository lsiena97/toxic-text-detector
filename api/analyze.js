const Anthropic = require("@anthropic-ai/sdk").default;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MIN_SCORE_BY_TAG = {
  gaslighting: 68,
  manipulation: 58,
  dismissal: 48,
  deflection: 50,
  "blame shifting": 54,
  "character attack": 58,
  guilt: 50,
  minimization: 48,
  invalidation: 56,
  generalization: 48,
  "pattern-based invalidation": 60,
};

const PHRASE_BOOSTS = [
  { pattern: /\boverreacting\b/i, boost: 18, floor: 64 },
  { pattern: /\btoo sensitive\b/i, boost: 18, floor: 64 },
  { pattern: /\byou always\b/i, boost: 14, floor: 52 },
  { pattern: /\byou never\b/i, boost: 12, floor: 48 },
  { pattern: /\bi never said that\b/i, boost: 22, floor: 72 },
  { pattern: /\bit'?s your fault\b/i, boost: 20, floor: 66 },
  { pattern: /\bi'?m sorry you feel that way\b/i, boost: 16, floor: 54 },
  { pattern: /\byou made me\b/i, boost: 16, floor: 58 },
  { pattern: /\bcalm down\b/i, boost: 10, floor: 42 },
  { pattern: /\bmaybe try therapy\b/i, boost: 16, floor: 56 },
  { pattern: /\byou'?re crazy\b/i, boost: 25, floor: 78 },
  { pattern: /\bwhatever\b/i, boost: 8, floor: 28 },
];

function clampScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeTag(tag) {
  return String(tag || "").trim().toLowerCase();
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return valid JSON");
  }

  return text.slice(start, end + 1);
}

function recalibrateScore(message, detected, originalScore) {
  let score = clampScore(originalScore);
  let minScore = 0;
  let boost = 0;

  for (const tag of detected || []) {
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

  const exclamations = (message.match(/!/g) || []).length;
  if (exclamations >= 2) {
    boost += 4;
  }

  score += boost;
  score = Math.max(score, minScore);

  return clampScore(score);
}

function ensureDetectedTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

function cleanText(value, fallback) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text || fallback;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const message = String(body.message || "").trim();

    if (!message) {
      return res.status(400).json({ error: "Paste a message." });
    }

    const prompt = `
You are analyzing a message for emotional manipulation.

This is NOT a moderation task.
This is a psychological clarity task.

Your job is to explain:
- why this message feels wrong, confusing, or emotionally heavy
- what it subtly does psychologically
- why it stays in the person's head instead of being easy to dismiss

Scoring rules:
- Score based on emotional impact, invalidation, manipulation, blame, distortion, and self-doubt risk.
- Do NOT reserve high scores only for explicit abuse or threats.
- If a message dismisses feelings, reframes the person as the problem, uses absolutes like "always" or "never", creates shame, or makes someone question themselves, the score should often be moderate or high.
- Do NOT be overly conservative.

Writing style:
- Make the user feel understood immediately.
- Be emotionally precise, not generic.
- Sound human, clear, and sharp.
- Avoid robotic or academic phrasing.
- Keep it concise, but make it feel valuable.

Return ONLY valid JSON in this exact shape:

{
  "toxicity_score": number,
  "detected": ["Gaslighting"],
  "explanation": "Clear, emotionally sharp explanation in 2-4 sentences.",
  "emotional_impact": "Human, validating impact in 2-3 sentences.",
  "suggested_reply": "Short, confident, real-world usable response."
}

Message:
${message}
`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 450,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response &&
      response.content &&
      response.content[0] &&
      response.content[0].text
        ? response.content[0].text
        : "";

    const jsonText = extractJson(text);
    const data = JSON.parse(jsonText);

    const detected = ensureDetectedTags(data.detected);

    const finalScore = recalibrateScore(
      message,
      detected,
      data.toxicity_score
    );

    return res.status(200).json({
      toxicity_score: finalScore,
      detected: detected.length ? detected : ["Emotional Dismissal"],
      explanation: cleanText(
        data.explanation,
        "This message shifts attention away from what hurt you and makes your reaction seem like the real problem."
      ),
      emotional_impact: cleanText(
        data.emotional_impact,
        "It can leave you feeling dismissed, confused, and less sure of your own judgment."
      ),
      suggested_reply: cleanText(
        data.suggested_reply,
        "My reaction is valid. If you have a concern, address it directly instead of dismissing how I feel."
      ),
    });
  } catch (error) {
    console.error("Error analyzing message:", error);

    return res.status(500).json({
      error: "Error analyzing message",
      details: error.message,
    });
  }
};