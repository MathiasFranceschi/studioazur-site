/**
 * Vercel Serverless Function — Contact form handler
 *
 * Receives POST from the contact form, validates fields,
 * sends email via MailChannels API.
 *
 * NOTE: MailChannels free tier requires Cloudflare Workers origin.
 * For Vercel production, set MAILCHANNELS_API_KEY env var (paid),
 * or replace with Resend/SendGrid by updating the sendEmail() call.
 *
 * Destination: contact@studioazur.dev
 */

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  const headers = {
    "Access-Control-Allow-Origin": "https://studioazur.dev",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    return res.end();
  }

  if (req.method !== "POST") {
    res.writeHead(405, headers);
    return res.end(JSON.stringify({ error: "Method Not Allowed" }));
  }

  try {
    const body = await parseBody(req);

    const name = (body.name || "").trim();
    const email = (body.email || "").trim();
    const service = (body.service || "").trim();
    const message = (body.message || "").trim();
    const honeypot = (body._gotcha || "").trim();

    // Anti-spam: honeypot field must be empty
    if (honeypot) {
      res.writeHead(200, headers);
      return res.end(JSON.stringify({ ok: true }));
    }

    // Validate required fields
    if (!name || !email || !message) {
      res.writeHead(400, headers);
      return res.end(
        JSON.stringify({ error: "Champs requis manquants (nom, email, message)." })
      );
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.writeHead(400, headers);
      return res.end(JSON.stringify({ error: "Adresse email invalide." }));
    }

    // Send email via MailChannels
    const mailPayload = {
      personalizations: [
        {
          to: [{ email: "contact@studioazur.dev", name: "Studio Azur" }],
          reply_to: { email: email, name: name },
        },
      ],
      from: {
        email: "noreply@studioazur.dev",
        name: "Studio Azur — Formulaire",
      },
      subject: `Nouveau contact — ${service || "Projet"}`,
      content: [
        {
          type: "text/plain",
          value: [
            `Nom : ${name}`,
            `Email : ${email}`,
            `Service : ${service || "Non spécifié"}`,
            ``,
            `Message :`,
            message,
            ``,
            `---`,
            `Envoyé depuis le formulaire studioazur.dev`,
          ].join("\n"),
        },
        {
          type: "text/html",
          value: `
            <div style="font-family:sans-serif;max-width:600px;">
              <h2 style="color:#1a2332;border-bottom:2px solid #c2693d;padding-bottom:8px;">Nouveau contact</h2>
              <table style="width:100%;border-collapse:collapse;">
                <tr><td style="padding:8px 0;color:#5a5a55;width:100px;"><strong>Nom</strong></td><td style="padding:8px 0;">${escapeHtml(name)}</td></tr>
                <tr><td style="padding:8px 0;color:#5a5a55;"><strong>Email</strong></td><td style="padding:8px 0;"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
                <tr><td style="padding:8px 0;color:#5a5a55;"><strong>Service</strong></td><td style="padding:8px 0;">${escapeHtml(service || "Non spécifié")}</td></tr>
              </table>
              <div style="margin-top:16px;padding:16px;background:#f5f0e8;border-radius:8px;">
                <strong style="color:#5a5a55;">Message :</strong>
                <p style="white-space:pre-wrap;margin:8px 0 0;">${escapeHtml(message)}</p>
              </div>
              <p style="margin-top:24px;font-size:12px;color:#8a8a82;">Envoyé depuis le formulaire studioazur.dev</p>
            </div>`,
        },
      ],
    };

    const fetchOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mailPayload),
    };

    // Attach API key if configured (required outside Cloudflare Workers)
    if (process.env.MAILCHANNELS_API_KEY) {
      fetchOptions.headers["X-Auth-Token"] = process.env.MAILCHANNELS_API_KEY;
    }

    const mailResponse = await fetch(
      "https://api.mailchannels.net/tx/v1/send",
      fetchOptions
    );

    if (mailResponse.status === 202 || mailResponse.ok) {
      res.writeHead(200, headers);
      return res.end(JSON.stringify({ ok: true }));
    }

    const errBody = await mailResponse.text();
    console.error("MailChannels error:", mailResponse.status, errBody);
    res.writeHead(500, headers);
    return res.end(
      JSON.stringify({ error: "Erreur lors de l'envoi. Veuillez réessayer." })
    );
  } catch (err) {
    console.error("Contact function error:", err);
    res.writeHead(500, headers);
    return res.end(
      JSON.stringify({ error: "Erreur serveur. Veuillez réessayer." })
    );
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        const contentType = req.headers["content-type"] || "";
        if (contentType.includes("application/json")) {
          resolve(JSON.parse(data));
        } else if (
          contentType.includes("application/x-www-form-urlencoded") ||
          contentType.includes("multipart/form-data")
        ) {
          const params = new URLSearchParams(data);
          const obj = {};
          for (const [k, v] of params) obj[k] = v;
          resolve(obj);
        } else {
          resolve({});
        }
      } catch {
        reject(new Error("Failed to parse body"));
      }
    });
    req.on("error", reject);
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
