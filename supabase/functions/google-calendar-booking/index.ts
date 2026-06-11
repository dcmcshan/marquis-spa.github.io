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

    const calendarId = requiredEnv("GOOGLE_CALENDAR_ID");
    const serviceAccountEmail = requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
    const privateKey = requiredEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");

    const requestedStart = new Date(String(body.start));
    const requestedEnd = new Date(String(body.end));

    if (Number.isNaN(requestedStart.getTime()) || Number.isNaN(requestedEnd.getTime())) {
      throw new Error("Invalid start or end time");
    }

    if (requestedEnd.getTime() <= requestedStart.getTime()) {
      throw new Error("End time must be after start time");
    }

    const accessToken = await getGoogleAccessToken(serviceAccountEmail, privateKey);
    const conflicts = await findConflicts(
      accessToken,
      calendarId,
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

    const event = buildEvent(body);
    const insertResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(event),
      },
    );

    if (!insertResponse.ok) {
      const errorText = await insertResponse.text();
      return json(
        {
          error: `Google Calendar rejected the booking: ${insertResponse.status} ${errorText}`,
        },
        502,
      );
    }

    const createdEvent = await insertResponse.json();
    return json(
      {
        ok: true,
        id: createdEvent.id,
        htmlLink: createdEvent.htmlLink,
      },
      200,
    );
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

async function getGoogleAccessToken(
  clientEmail: string,
  privateKeyPem: string,
) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const assertion = await createSignedJwt(privateKeyPem, payload);
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
    throw new Error(`Failed to fetch Google access token: ${response.status} ${errorText}`);
  }

  const token = await response.json();
  if (!token.access_token) {
    throw new Error("Google token response did not include an access token");
  }

  return token.access_token as string;
}

async function createSignedJwt(
  privateKeyPem: string,
  payload: Record<string, unknown>,
) {
  const header = { alg: "RS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

async function importPrivateKey(privateKeyPem: string) {
  const normalized = privateKeyPem.replace(/\\n/g, "\n");
  const keyData = pemToArrayBuffer(normalized);
  return crypto.subtle.importKey(
    "pkcs8",
    keyData,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
}

function pemToArrayBuffer(pem: string) {
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64UrlEncode(input: string | ArrayBuffer) {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function findConflicts(
  accessToken: string,
  calendarId: string,
  requestedStart: Date,
  requestedEnd: Date,
) {
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      timeMin: requestedStart.toISOString(),
      timeMax: requestedEnd.toISOString(),
      items: [{ id: calendarId }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Calendar availability check failed: ${response.status} ${errorText}`);
  }

  const freeBusy = await response.json();
  const busySlots = freeBusy?.calendars?.[calendarId]?.busy ?? [];

  return busySlots.map((slot: { start: string; end: string }) => ({
    summary: "Busy",
    start: slot.start,
    end: slot.end,
  }));
}

function buildEvent(body: Record<string, unknown>) {
  const description = [
    `Requester: ${body.name}`,
    `Email: ${body.email}`,
    `Phone: ${body.phone ?? ""}`,
    `Timezone: ${body.timezone ?? "UTC"}`,
    `Notes: ${body.notes ?? ""}`,
  ].join("\n");

  return {
    summary: `${body.service} - ${body.name}`,
    description,
    location: body.location ?? "Marquis day SPA",
    start: {
      dateTime: String(body.start),
      timeZone: String(body.timezone ?? "UTC"),
    },
    end: {
      dateTime: String(body.end),
      timeZone: String(body.timezone ?? "UTC"),
    },
  };
}
