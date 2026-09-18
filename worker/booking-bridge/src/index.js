const REQUIRED_FIELDS = ["name", "email", "service", "start", "end"];
const MAX_RETRIES = 3;

let env;

export default {
  async fetch(request, workerEnv) {
    env = workerEnv;
    if (request.method === "OPTIONS") {
      return respond(null, 204);
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/availability") {
      try {
        const busy = await availability(url.searchParams);
        return respond({ ok: true, busy }, 200);
      } catch (error) {
        return respond(
          { error: error.message ?? "Unexpected availability error" },
          error.status ?? 400,
        );
      }
    }

    if (request.method !== "POST") {
      return respond(
        {
          ok: true,
          service: "marquis-booking-bridge",
          google: googleConfigured() ? "read_only" : "not_configured",
          usage: "GET /availability?start=<ISO>&end=<ISO> | POST JSON {name,email,phone,service,notes,start,end,timezone,location}",
        },
        200,
      );
    }

    try {
      const body = await request.json();
      validate(body);
      const result = await commitBooking(body);
      return respond(result, 200);
    } catch (error) {
      return respond(
        { error: error.message ?? "Unexpected booking error", conflicts: error.conflicts },
        error.status ?? 400,
      );
    }
  },
};

function respond(data, status) {
  return new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN ?? "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function validate(body) {
  for (const field of REQUIRED_FIELDS) {
    if (!body[field] || typeof body[field] !== "string" || !body[field].trim()) {
      throw httpError(`Missing required field: ${field}`, 400);
    }
  }
  for (const field of ["name", "email", "service", "start", "end", "timezone", "location"]) {
    if (body[field] && String(body[field]).length > 500) {
      throw httpError(`Field too long: ${field}`, 400);
    }
  }
  if (body.notes && String(body.notes).length > 2000) {
    throw httpError("Field too long: notes", 400);
  }
  if (!/^\S+@\S+\.\S+$/.test(body.email.trim())) {
    throw httpError("Invalid email address", 400);
  }

  const start = new Date(body.start);
  const end = new Date(body.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw httpError("Invalid start or end time", 400);
  }
  if (end.getTime() <= start.getTime()) {
    throw httpError("End time must be after start time", 400);
  }
  if (end.getTime() - start.getTime() > 12 * 60 * 60 * 1000) {
    throw httpError("Booking duration cannot exceed 12 hours", 400);
  }
  if (start.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
    throw httpError("Start time must be in the future", 400);
  }
}

function httpError(message, status, conflicts) {
  const error = new Error(message);
  error.status = status;
  error.conflicts = conflicts;
  return error;
}

async function commitBooking(body) {
  const start = new Date(body.start).getTime();
  const end = new Date(body.end).getTime();

  const useGoogle = googleConfigured();

  if (useGoogle) {
    const token = await getGoogleAccessToken();
    const googleConflicts = await findGoogleConflicts(token, start, end);
    if (googleConflicts.length > 0) {
      throw httpError(
        "The requested time is unavailable.",
        409,
        googleConflicts,
      );
    }
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const file = await fetchCalendarFile();
    const events = parseEvents(file.content);

    const conflicts = events
      .filter((event) => event.start < end && event.end > start)
      .map((event) => ({
        start: new Date(event.start).toISOString(),
        end: new Date(event.end).toISOString(),
      }));
    if (conflicts.length > 0) {
      throw httpError("The requested time overlaps an existing booking request.", 409, conflicts);
    }

    const updated = insertEvent(file.content, buildVevent(body));
    const committed = await putCalendarFile(updated, file.sha, body);
    if (committed.ok) {
      return {
        ...committed.result,
        google: useGoogle ? { mode: "read_only" } : { skipped: "not_configured" },
      };
    }
  }
  throw httpError("Calendar update conflict, please retry.", 503);
}

async function availability(searchParams) {
  if (!googleConfigured()) {
    throw httpError("Google Calendar reading is not configured.", 503);
  }

  const now = new Date();
  const defaultEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const start = searchParams.get("start") ? new Date(searchParams.get("start")) : now;
  const end = searchParams.get("end") ? new Date(searchParams.get("end")) : defaultEnd;

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw httpError("Invalid start or end parameter", 400);
  }
  if (end.getTime() <= start.getTime()) {
    throw httpError("End must be after start", 400);
  }
  if (end.getTime() - start.getTime() > 90 * 24 * 60 * 60 * 1000) {
    throw httpError("Availability window cannot exceed 90 days", 400);
  }

  const token = await getGoogleAccessToken();
  return findGoogleConflicts(token, start.getTime(), end.getTime());
}

function googleConfigured() {
  return Boolean(
    env.GOOGLE_CALENDAR_ID &&
      env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  );
}

async function getGoogleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const assertion = await createSignedJwt(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, payload);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw httpError(
      `Failed to fetch Google access token: ${response.status} ${errorText.slice(0, 300)}`,
      502,
    );
  }

  const token = await response.json();
  if (!token.access_token) {
    throw httpError("Google token response did not include an access token", 502);
  }
  return token.access_token;
}

async function createSignedJwt(privateKeyPem, payload) {
  const header = { alg: "RS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

async function importPrivateKey(privateKeyPem) {
  const normalized = privateKeyPem.replace(/\\n/g, "\n");
  return crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(normalized),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function pemToArrayBuffer(pem) {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0)).buffer;
}

function base64UrlEncode(input) {
  let binary = "";
  for (const byte of new Uint8Array(input)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function findGoogleConflicts(accessToken, startMs, endMs) {
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      timeMin: new Date(startMs).toISOString(),
      timeMax: new Date(endMs).toISOString(),
      items: [{ id: env.GOOGLE_CALENDAR_ID }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw httpError(
      `Google Calendar availability check failed: ${response.status} ${errorText.slice(0, 300)}`,
      502,
    );
  }

  const freeBusy = await response.json();
  return (freeBusy?.calendars?.[env.GOOGLE_CALENDAR_ID]?.busy ?? []).map((slot) => ({
    start: slot.start,
    end: slot.end,
  }));
}

async function fetchCalendarFile() {
  const path = env.CALENDAR_PATH;
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`;
  const response = await fetch(url, {
    headers: await githubHeaders(),
  });

  if (response.status === 404) {
    return { sha: undefined, content: skeletonCalendar() };
  }
  if (!response.ok) {
    const text = await response.text();
    throw httpError(`Failed to read calendar file: ${response.status} ${text.slice(0, 300)}`, 502);
  }

  const data = await response.json();
  const bytes = Uint8Array.from(atob(data.content.replace(/\s+/g, "")), (ch) => ch.charCodeAt(0));
  return { sha: data.sha, content: new TextDecoder().decode(bytes) };
}

async function putCalendarFile(content, sha, body) {
  const path = env.CALENDAR_PATH;
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
  const payload = {
    message: sanitizeCommitTitle(`booking: ${body.service} - ${body.name}`),
    content: btoa(String.fromCharCode(...new TextEncoder().encode(content))),
    branch: env.GITHUB_BRANCH,
  };
  if (sha) {
    payload.sha = sha;
  }

  const response = await fetch(url, {
    method: "PUT",
    headers: await githubHeaders(),
    body: JSON.stringify(payload),
  });

  if (response.status === 409 || response.status === 422) {
    return { ok: false };
  }
  if (!response.ok) {
    const text = await response.text();
    throw httpError(`Failed to write calendar file: ${response.status} ${text.slice(0, 300)}`, 502);
  }

  const data = await response.json();
  return {
    ok: true,
    result: {
      ok: true,
      commitUrl: data.commit?.html_url,
      calendarUrl: `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${env.GITHUB_BRANCH}/${path}`,
    },
  };
}

async function githubHeaders() {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    throw httpError("Worker is missing GITHUB_TOKEN secret", 500);
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "marquis-booking-bridge",
  };
}

function skeletonCalendar() {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Marquis SPA//Booking Bridge//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Marquis day SPA Bookings",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function buildVevent(body) {
  const start = toIcsUtc(body.start);
  const end = toIcsUtc(body.end);
  const description = [
    `Requester: ${body.name}`,
    `Email: ${body.email}`,
    `Phone: ${body.phone ?? ""}`,
    `Timezone: ${body.timezone ?? "UTC"}`,
    `Notes: ${body.notes ?? ""}`,
  ].join("\\n");

  return [
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@marquis.spa`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${icsEscape(`${body.service} - ${body.name}`)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `LOCATION:${icsEscape(body.location ?? "Marquis day SPA")}`,
    "END:VEVENT",
  ];
}

function insertEvent(calendar, eventLines) {
  const marker = "END:VCALENDAR";
  const idx = calendar.lastIndexOf(marker);
  if (idx === -1) {
    throw httpError("Calendar file is malformed", 500);
  }
  const head = calendar.slice(0, idx);
  const tail = calendar.slice(idx);
  const sep = head.endsWith("\n") ? "" : "\r\n";
  return head + sep + eventLines.join("\r\n") + "\r\n" + tail;
}

function parseEvents(ics) {
  const events = [];
  for (const block of ics.split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];
    const dtStart = /DTSTART[^:\r\n]*:(\S+)/.exec(body);
    const dtEnd = /DTEND[^:\r\n]*:(\S+)/.exec(body);
    const start = dtStart && parseIcsUtc(dtStart[1]);
    const end = dtEnd && parseIcsUtc(dtEnd[1]);
    if (start !== null && end !== null) {
      events.push({ start, end });
    }
  }
  return events;
}

function parseIcsUtc(value) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) {
    return null;
  }
  return Date.UTC(
    +match[1],
    +match[2] - 1,
    +match[3],
    +match[4],
    +match[5],
    +match[6],
  );
}

function toIcsUtc(isoString) {
  return new Date(isoString)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function icsEscape(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function sanitizeCommitTitle(title) {
  return title.replace(/[\r\n]+/g, " ").slice(0, 200);
}
