/**
 * Vercel Serverless Function — Stripe Webhook Handler
 *
 * Listens for Stripe events and:
 *   - checkout.session.completed → sends email alert to mathias.franceschi@gmail.com
 *   - checkout.session.created   → logs checkout start (funnel tracking)
 *
 * Required env vars:
 *   STRIPE_WEBHOOK_SECRET  — from Stripe Dashboard > Webhooks > signing secret
 *   MAILCHANNELS_API_KEY   — optional, required outside Cloudflare Workers
 *
 * Stripe signature verification is done via Node.js built-in `crypto`
 * (no npm packages needed).
 */

import crypto from "crypto";

export const config = {
  api: {
    bodyParser: false, // Raw body required for Stripe signature verification
  },
};

const ALERT_EMAIL = "mathias.franceschi@gmail.com";
const FROM_EMAIL = "noreply@studioazur.dev";
const FROM_NAME = "Studio Azur — Stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Method Not Allowed" }));
  }

  // Collect raw body for signature verification
  const rawBody = await getRawBody(req);
  const signature = req.headers["stripe-signature"];

  if (!signature) {
    console.error("[stripe-webhook] Missing Stripe-Signature header");
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Missing Stripe-Signature" }));
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not set");
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Webhook secret not configured" }));
  }

  // Verify Stripe signature
  let event;
  try {
    event = verifyStripeSignature(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err.message);
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Invalid signature" }));
  }

  console.log(`[stripe-webhook] Event received: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object);
        break;

      case "checkout.session.created":
        handleCheckoutCreated(event.data.object);
        break;

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`[stripe-webhook] Handler error for ${event.type}:`, err);
    // Return 200 anyway so Stripe doesn't retry — log the error above
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  return res.end(JSON.stringify({ received: true }));
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleCheckoutCompleted(session) {
  const amount = formatAmount(session.amount_total, session.currency);
  const customerEmail = session.customer_details?.email || "inconnu";
  const customerName = session.customer_details?.name || "Inconnu";
  const productName = session.metadata?.product_name || session.line_items?.data?.[0]?.description || "Produit";
  const sessionId = session.id;
  const mode = session.mode; // 'payment' | 'subscription'

  console.log(
    `[stripe-webhook] ✅ PAYMENT COMPLETED — ${amount} from ${customerEmail} (session: ${sessionId})`
  );

  // Send email alert to Mathias
  await sendPaymentAlert({
    amount,
    customerEmail,
    customerName,
    productName,
    sessionId,
    mode,
  });
}

function handleCheckoutCreated(session) {
  const sessionId = session.id;
  const customerEmail = session.customer_email || session.customer_details?.email || "unknown";
  const mode = session.mode;

  console.log(
    `[stripe-webhook] 🛒 CHECKOUT STARTED — session: ${sessionId}, mode: ${mode}, email: ${customerEmail}`
  );
  // Logged for funnel visibility — no action needed
}

// ---------------------------------------------------------------------------
// Email via MailChannels
// ---------------------------------------------------------------------------

async function sendPaymentAlert({ amount, customerEmail, customerName, productName, sessionId, mode }) {
  const subject = `💳 Nouveau paiement Studio Azur — ${amount}`;
  const modeLabel = mode === "subscription" ? "Abonnement" : "Paiement unique";

  const textContent = [
    `🎉 Nouveau paiement reçu !`,
    ``,
    `Montant    : ${amount}`,
    `Type       : ${modeLabel}`,
    `Produit    : ${productName}`,
    `Client     : ${customerName}`,
    `Email      : ${customerEmail}`,
    `Session ID : ${sessionId}`,
    ``,
    `---`,
    `Studio Azur — studioazur.dev`,
  ].join("\n");

  const htmlContent = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1a2332;padding:24px;border-radius:8px 8px 0 0;">
        <h2 style="color:#ffffff;margin:0;font-size:20px;">🎉 Nouveau paiement reçu</h2>
      </div>
      <div style="background:#f5f0e8;padding:24px;border-radius:0 0 8px 8px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:10px 0;color:#5a5a55;width:120px;font-weight:bold;">Montant</td>
            <td style="padding:10px 0;color:#1a2332;font-size:20px;font-weight:bold;">${escapeHtml(amount)}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#5a5a55;font-weight:bold;">Type</td>
            <td style="padding:10px 0;">${escapeHtml(modeLabel)}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#5a5a55;font-weight:bold;">Produit</td>
            <td style="padding:10px 0;">${escapeHtml(productName)}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#5a5a55;font-weight:bold;">Client</td>
            <td style="padding:10px 0;">${escapeHtml(customerName)}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#5a5a55;font-weight:bold;">Email</td>
            <td style="padding:10px 0;"><a href="mailto:${escapeHtml(customerEmail)}" style="color:#c2693d;">${escapeHtml(customerEmail)}</a></td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#5a5a55;font-weight:bold;">Session</td>
            <td style="padding:10px 0;font-size:12px;color:#8a8a82;">${escapeHtml(sessionId)}</td>
          </tr>
        </table>
        <div style="margin-top:16px;padding:12px;background:#c2693d;border-radius:6px;text-align:center;">
          <a href="https://dashboard.stripe.com/payments/${escapeHtml(sessionId)}"
             style="color:#ffffff;text-decoration:none;font-weight:bold;">
            Voir dans Stripe Dashboard →
          </a>
        </div>
        <p style="margin-top:24px;font-size:12px;color:#8a8a82;text-align:center;">
          Alerte automatique — Studio Azur · studioazur.dev
        </p>
      </div>
    </div>
  `;

  const mailPayload = {
    personalizations: [
      {
        to: [{ email: ALERT_EMAIL, name: "Mathias Franceschi" }],
      },
    ],
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject,
    content: [
      { type: "text/plain", value: textContent },
      { type: "text/html", value: htmlContent },
    ],
  };

  const fetchOptions = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mailPayload),
  };

  if (process.env.MAILCHANNELS_API_KEY) {
    fetchOptions.headers["X-Auth-Token"] = process.env.MAILCHANNELS_API_KEY;
  }

  const mailResponse = await fetch("https://api.mailchannels.net/tx/v1/send", fetchOptions);

  if (mailResponse.status === 202 || mailResponse.ok) {
    console.log(`[stripe-webhook] 📧 Alert email sent to ${ALERT_EMAIL}`);
  } else {
    const errBody = await mailResponse.text();
    console.error("[stripe-webhook] MailChannels error:", mailResponse.status, errBody);
    throw new Error(`MailChannels failed: ${mailResponse.status}`);
  }
}

// ---------------------------------------------------------------------------
// Stripe signature verification (HMAC-SHA256, no Stripe SDK required)
// See: https://stripe.com/docs/webhooks/signatures
// ---------------------------------------------------------------------------

function verifyStripeSignature(rawBody, header, secret) {
  // Parse header: "t=timestamp,v1=sig1,v1=sig2"
  const parts = {};
  for (const part of header.split(",")) {
    const [key, ...rest] = part.split("=");
    const value = rest.join("=");
    if (!parts[key]) parts[key] = [];
    parts[key].push(value);
  }

  const timestamp = parts["t"]?.[0];
  const signatures = parts["v1"] || [];

  if (!timestamp || signatures.length === 0) {
    throw new Error("Invalid Stripe-Signature header format");
  }

  // Reject timestamps older than 5 minutes (replay attack prevention)
  const tolerance = 5 * 60; // 5 minutes in seconds
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > tolerance) {
    throw new Error("Stripe webhook timestamp is too old");
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  // Timing-safe comparison
  const match = signatures.some((sig) => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expectedSig, "hex"),
        Buffer.from(sig, "hex")
      );
    } catch {
      return false;
    }
  });

  if (!match) {
    throw new Error("Stripe signature mismatch");
  }

  // Parse the event JSON
  const body = rawBody.toString("utf8");
  return JSON.parse(body);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function formatAmount(amountCents, currency = "eur") {
  if (amountCents == null) return "N/A";
  const amount = amountCents / 100;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
