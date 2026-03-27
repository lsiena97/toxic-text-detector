import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body || {};

    if (!message) {
      return res.status(400).json({ error: "Paste a message." });
    }

    const prompt = `
Analyze the following message for emotional manipulation.

Return ONLY a valid JSON object.
Do not use markdown.
Do not use code blocks.
Do not add any text before or after the JSON.

Use exactly this format:
{
  "toxicity_score": 0,
  "detected": ["Gaslighting"],
  "explanation": "short explanation",
  "emotional_impact": "short emotional impact",
  "suggested_reply": "short reply"
}

Message:
${message}
`;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const text = response.content[0].text;

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1) {
      return res.status(500).json({
        error: "Model did not return JSON",
        raw: text,
      });
    }

    const jsonText = text.slice(start, end + 1);
    const data = JSON.parse(jsonText);

    return res.status(200).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: "Error analyzing message",
      details: error.message,
    });
  }
}