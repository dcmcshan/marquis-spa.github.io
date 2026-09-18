# Booking Bridge (Cloudflare Worker, read-only Google Calendar)

The `/booking/` form posts to a Cloudflare Worker that records booking
requests and reads unavailable times from the shared "Daniel & Camille"
Google Calendar.

## Included files

- `worker/booking-bridge/src/index.js`: booking bridge Worker
- `worker/booking-bridge/wrangler.toml`: Worker configuration
- `booking/index.html`: public booking form
- `booking/booking.js`: form submission logic
- `booking/booking-config.js`: where the public bridge URL is configured

## How it works

1. GitHub Pages serves the static booking form.
2. The form posts booking details to the Worker.
3. The Worker records the request in `bookings/calendar.ics` in the
   `marquis-spa.github.io` repository (the public calendar link).
4. If the Google Calendar service account is configured, the Worker also
   checks the "Daniel & Camille" calendar for busy times (FreeBusy) and
   rejects the request with HTTP `409` when the slot is unavailable.
5. Google Calendar is **read-only**; the Worker never writes events there.
   Block times on the "Daniel & Camille" calendar and the booking form
   will refuse those slots.

## Endpoints

- `GET /availability?start=<ISO>&end=<ISO>`: busy slots for a window
  (max 90 days).
- `POST {name,email,phone,service,notes,start,end,timezone,location}`:
  submit a booking request.

## Google Cloud setup

A service account with the Calendar JSON API enabled is required. The
service account only needs Reader access to the shared calendar.

1. `gcloud services enable calendar-json.googleapis.com --project=<project>`
2. `gcloud iam service-accounts create marquis-booking-reader --project=<project>`
3. `gcloud iam service-accounts keys create .secrets/marquis-booking-calendar-key.json --iam-account=marquis-booking-reader@<project>.iam.gserviceaccount.com`
4. Share the "Daniel & Camille" calendar with the service account email
   (Reader) in Google Calendar > Settings > Share with specific people.

## Cloudflare secrets

```bash
wrangler secret put GITHUB_TOKEN
wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
wrangler secret put GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
```

`GOOGLE_CALENDAR_ID` is set in `wrangler.toml`:

- `ca7a560e76044c59bbb72a70b98a21a774b99c2f5195eb7357ecd1a1cdf74344@group.calendar.google.com`

## Deploy

```bash
cd worker/booking-bridge && wrangler deploy
```

## Booking records

Booking requests accumulate in:

- `https://raw.githubusercontent.com/dcmcshan/marquis-spa.github.io/main/bookings/calendar.ics`

