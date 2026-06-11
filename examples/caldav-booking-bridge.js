export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, corsHeaders);
    }

    try {
      const body = await request.json();
      validate(body);

      const uid = `${crypto.randomUUID()}@marquis.spa`;
      const eventUrl = `${env.CALDAV_COLLECTION_URL.replace(/\/$/, "")}/${uid}.ics`;
      const calendarBody = buildCalendar(uid, body);

      const credentials = btoa(`${env.CALDAV_USERNAME}:${env.CALDAV_PASSWORD}`);
      const caldavResponse = await fetch(eventUrl, {
        method: "PUT",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "text/calendar; charset=utf-8",
          "If-None-Match": "*",
        },
        body: calendarBody,
      });

      if (!caldavResponse.ok) {
        const errorText = await caldavResponse.text();
        return json(
          { error: `CalDAV server rejected the booking: ${caldavResponse.status} ${errorText}` },
          502,
          corsHeaders
        );
      }

      return json({ ok: true, uid, eventUrl }, 200, corsHeaders);
    } catch (error) {
      return json({ error: error.message || "Unexpected booking error" }, 400, corsHeaders);
    }
  },
};

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function validate(body) {
  const required = ["name", "email", "service", "start", "end"];
  for (const field of required) {
    if (!body[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
}

function escapeText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function toUtcStamp(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildCalendar(uid, body) {
  const description = [
    `Requester: ${body.name}`,
    `Email: ${body.email}`,
    `Phone: ${body.phone || ""}`,
    `Timezone: ${body.timezone || "UTC"}`,
    `Notes: ${body.notes || ""}`,
  ].join("\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Marquis SPA//CalDAV Booking Bridge//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toUtcStamp(new Date().toISOString())}`,
    `DTSTART:${toUtcStamp(body.start)}`,
    `DTEND:${toUtcStamp(body.end)}`,
    `SUMMARY:${escapeText(`${body.service} - ${body.name}`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(body.location || "Marquis day SPA")}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
