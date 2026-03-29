const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const data = await res.json();
  return data.result;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { licenseKey } = req.body || {};

  if (!licenseKey || typeof licenseKey !== "string") {
    return res.status(400).json({ valid: false, error: "License key is required" });
  }

  const clean = licenseKey.trim().toUpperCase();

  if (!clean.startsWith("TTD-")) {
    return res.status(200).json({ valid: false, error: "Invalid key format" });
  }

  const email = await redisGet(`license:${clean}`);

  if (!email) {
    return res.status(200).json({ valid: false, error: "Key not found or expired" });
  }

  return res.status(200).json({ valid: true, email });
};
