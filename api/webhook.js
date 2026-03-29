const crypto = require("crypto");

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

function generateLicenseKey() {
  return "TTD-" + crypto.randomBytes(12).toString("hex").toUpperCase();
}

async function redisSet(key, value, exSeconds) {
  const res = await fetch(`${UPSTASH_URL}/set/${key}/${encodeURIComponent(value)}${exSeconds ? `?ex=${exSeconds}` : ""}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  return res.json();
}

async function sendEmail(to, licenseKey) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Toxic Text Detector <onboarding@resend.dev>",
      to: [to],
      subject: "Your Toxic Text Detector Premium access key 🔑",
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#fff8f4;border-radius:16px;">
          <h1 style="font-size:28px;color:#2a2321;margin-bottom:8px;">You're in. ✨</h1>
          <p style="color:#7d6d68;font-size:16px;margin-bottom:24px;">
            Thank you for unlocking <strong>Toxic Text Detector Premium</strong>. 
            Here's your personal access key:
          </p>

          <div style="background:#fff;border:2px solid #ecd5ce;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
            <p style="font-size:13px;color:#c97c6b;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:0 0 8px;">Your License Key</p>
            <p style="font-size:24px;font-weight:800;color:#2a2321;letter-spacing:.05em;margin:0;">${licenseKey}</p>
          </div>

          <p style="color:#7d6d68;font-size:15px;margin-bottom:8px;">To activate your access:</p>
          <ol style="color:#2a2321;font-size:15px;line-height:1.8;padding-left:20px;">
            <li>Go to <a href="https://toxictextdetector.com" style="color:#c97c6b;">toxictextdetector.com</a></li>
            <li>Click <strong>"Already have a key?"</strong></li>
            <li>Paste your key and unlock unlimited analyses</li>
          </ol>

          <p style="color:#7d6d68;font-size:13px;margin-top:24px;border-top:1px solid #ecd5ce;padding-top:16px;">
            Keep this email safe — your key is tied to your account.<br/>
            Questions? Reply to this email and we'll help you out.
          </p>
        </div>
      `,
    }),
  });
  return res.json();
}

function verifyStripeSignature(rawBody, signature, secret) {
  const elements = signature.split(",");
  const timestamp = elements.find((e) => e.startsWith("t="))?.split("=")[1];
  const sigHash = elements.find((e) => e.startsWith("v1="))?.split("=")[1];

  if (!timestamp || !sigHash) return false;

  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigHash));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) {
    return res.status(400).json({ error: "Missing stripe signature" });
  }

  let rawBody = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => (rawBody += chunk));
    req.on("end", resolve);
  });

  const isValid = verifyStripeSignature(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  if (!isValid) {
    return res.status(400).json({ error: "Invalid signature" });
  }

  const event = JSON.parse(rawBody);

  if (event.type === "checkout.session.completed" || event.type === "invoice.payment_succeeded") {
    const customerEmail =
      event.data.object.customer_email ||
      event.data.object.customer_details?.email ||
      null;

    if (!customerEmail) {
      return res.status(200).json({ received: true, note: "No email found" });
    }

    const licenseKey = generateLicenseKey();

    // Guarda a chave no Redis por 400 dias (assinatura mensal com margem)
    await redisSet(`license:${licenseKey}`, customerEmail, 60 * 60 * 24 * 400);

    // Envia o e-mail com a chave
    await sendEmail(customerEmail, licenseKey);

    return res.status(200).json({ received: true });
  }

  return res.status(200).json({ received: true });
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
