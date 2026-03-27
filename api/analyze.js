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

You MUST return ONLY valid JSON.
Do not include any text before or after the JSON.

Format:
{
  "toxicity_score": number,
  "detected": ["Gaslighting", "Manipulation"],
  "explanation": "short explanation",
  "emotional_impact": "short emotional impact",
  "suggested_reply": "short reply"
}

Message:
${message}
`;

    const response = await anthropic.messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const text = response.content[0].text;

    const data = JSON.parse(text);

    return res.status(200).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Error analyzing message" });
  }
}