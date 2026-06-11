const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await request.json();
    validate(body);

    const collectionUrl = requiredEnv("CALDAV_COLLECTION_URL").replace(/\/$/, "");
    const username = requiredEnv("CALDAV_USERNAME");
    const password = requiredEnv("CALDAV_PASSWORD");

    const uid = `${crypto.randomUUID()}@marquis.spa`;
    const eventUrl = `${collectionUrl}/${uid}.ics`;
    const calendarBody = buildCalendar(uid, body);
    const credentials = basicAuth(username, password);
    const requestedStart = new Date(String(body.start));
    const requestedEnd = new Date(String(body.end));

    const conflicts = await findConflicts(
      collectionUrl,
      credentials,
      requestedStart,
      requestedEnd,
    );

    if (conflicts.length > 0) {
      return json(
        {
          error: "The requested time overlaps an existing calendar event.",
          conflicts,
        },
        409,
      );
    }

    const caldavResponse = await fetch(eventUrl, {
      method: "PUT",
      headers: {
        Authorization: credentials,
        "Content-Type": "text/calendar; charset=utf-8",
        "If-None-Match": "*",
      },
      body: calendarBody,
    });

    if (!caldavResponse.ok) {
      const errorText = await caldavResponse.text();
      return json(
        {
          error: `CalDAV server rejected the booking: ${caldavResponse.status} ${errorText}`,
        },
        502
      );
    }

    return json({ ok: true, uid, eventUrl }, 200);
  } catch (error) {
    return json({ error: error.message ?? "Unexpected booking error" }, 400);
  }
});

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function validate(body: Record<string, unknown>) {
  const required = ["name", "email", "service", "start", "end"];
  for (const field of required) {
    if (!body[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
}

function basicAuth(username: string, password: string) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

async function findConflicts(
  collectionUrl: string,
  credentials: string,
  requestedStart: Date,
  requestedEnd: Date,
) {
  const reportBody = buildCalendarQuery(requestedStart, requestedEnd);
  const response = await fetch(collectionUrl, {
    method: "REPORT",
    headers: {
      Authorization: credentials,
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: reportBody,
  });

  if (!response.ok && response.status !== 207) {
    const errorText = await response.text();
    throw new Error(
      `CalDAV availability check failed: ${response.status} ${errorText}`,
    );
  }

  const xml = await response.text();
  const events = extractEventsFromMultistatus(xml);

  return events.filter((event) =>
    event.start.getTime() < requestedEnd.getTime() &&
    event.end.getTime() > requestedStart.getTime()
  ).map((event) => ({
    summary: event.summary,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
  }));
}

function buildCalendarQuery(start: Date, end: Date) {
  return `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${toUtcStamp(start.toISOString())}" end="${toUtcStamp(end.toISOString())}" />
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
}

function extractEventsFromMultistatus(xml: string) {
  const matches = Array.from(xml.matchAll(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g));

  return matches
    .map((match) => parseVevent(match[0]))
    .filter(Boolean) as Array<{ summary: string; start: Date; end: Date }>;
}

function parseVevent(rawEvent: string) {
  const unfolded = rawEvent.replace(/\r?\n[ \t]/g, "");
  const startRaw = readIcsField(unfolded, "DTSTART");
  const endRaw = readIcsField(unfolded, "DTEND");

  if (!startRaw || !endRaw) {
    return null;
  }

  const start = parseIcsDate(startRaw);
  const end = parseIcsDate(endRaw);

  if (!start || !end) {
    return null;
  }

  return {
    summary: readIcsField(unfolded, "SUMMARY") ?? "Busy",
    start,
    end,
  };
}

function readIcsField(rawEvent: string, fieldName: string) {
  const match = rawEvent.match(
    new RegExp(`^${fieldName}(?:;[^:]+)?:([^\\r\\n]+)$`, "m"),
  );
  return match?.[1]?.trim() ?? null;
}

function parseIcsDate(value: string) {
  if (/^\d{8}T\d{6}Z$/.test(value)) {
    const iso =
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
    return new Date(iso);
  }

  if (/^\d{8}T\d{6}$/.test(value)) {
    const iso =
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}`;
    return new Date(iso);
  }

  return null;
}

function escapeText(value: unknown) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function toUtcStamp(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildCalendar(uid: string, body: Record<string, unknown>) {
  const description = [
    `Requester: ${body.name}`,
    `Email: ${body.email}`,
    `Phone: ${body.phone ?? ""}`,
    `Timezone: ${body.timezone ?? "UTC"}`,
    `Notes: ${body.notes ?? ""}`,
  ].join("\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Marquis SPA//Supabase CalDAV Booking//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toUtcStamp(new Date().toISOString())}`,
    `DTSTART:${toUtcStamp(String(body.start))}`,
    `DTEND:${toUtcStamp(String(body.end))}`,
    `SUMMARY:${escapeText(`${body.service} - ${body.name}`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(body.location ?? "Marquis day SPA")}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
