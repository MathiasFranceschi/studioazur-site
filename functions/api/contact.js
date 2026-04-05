/**
 * Cloudflare Pages Function — Contact form handler
 *
 * Receives POST from the contact form, validates fields,
 * sends email via MailChannels API (free with Cloudflare Workers),
 * returns JSON success/error.
 *
 * Required DNS record for MailChannels SPF:
 *   TXT _mailchannels.studioazur.dev "v=mc1 cfid=studioazur.pages.dev"
 *
 * Destination: contact@studioazur.dev
 */

export async function onRequestPost(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "https://studioazur.dev",
  };

  try {
    const formData = await context.request.formData();

    const name = (formData.get("name") || "").trim();
    const email = (formData.get("email") || "").trim();
    const service = (formData.get("service") || "").trim();
    const message = (formData.get("message") || "").trim();
    const honeypot = (formData.get("_gotcha") || "").trim();

    // Anti-spam: honeypot field must be empty
    if (honeypot) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    // Validate required fields
    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ error: "Champs requis manquants (nom, email, message)." }),
        { status: 400, headers }
      );
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(
        JSON.stringify({ error: "Adresse email invalide." }),
        { status: 400, headers }
      );
    }

    // Send email via MailChannels
    const mailResponse = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      }),
    });

    if (mailResponse.status === 202 || mailResponse.ok) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    const errBody = await mailResponse.text();
    console.error("MailChannels error:", mailResponse.status, errBody);
    return new Response(
      JSON.stringify({ error: "Erreur lors de l'envoi. Veuillez réessayer." }),
      { status: 500, headers }
    );
  } catch (err) {
    console.error("Contact function error:", err);
    return new Response(
      JSON.stringify({ error: "Erreur serveur. Veuillez réessayer." }),
      { status: 500, headers }
    );
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "https://studioazur.dev",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
