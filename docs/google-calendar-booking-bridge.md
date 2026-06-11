# Google Calendar Booking Bridge

This repository includes a Supabase Edge Function that accepts booking requests from the static `/booking/` page and writes them into a shared Google Calendar.

## Included files

- `supabase/functions/google-calendar-booking/index.ts`: Google Calendar bridge
- `booking/index.html`: public booking form
- `booking/booking.js`: form submission logic
- `booking/booking-config.js`: where the public bridge URL is configured

## How it works

1. GitHub Pages serves the static booking form.
2. The form posts booking details to the Supabase Edge Function.
3. The Edge Function uses a Google service account to:
   - check for time conflicts with the Google Calendar FreeBusy API
   - create the event in the shared calendar if the slot is open

## Important requirement

The calendar ID alone is not enough to write events.

You must create a Google service account and share the target Google Calendar with that service account email with permission to edit events.

That means your shared calendar should be shared with an address that looks like:

- `booking-bridge@your-project.iam.gserviceaccount.com`

## Supabase secrets

Set these secrets before deployment:

```bash
supabase secrets set \
  ALLOWED_ORIGIN=https://marquis.spa \
  GOOGLE_CALENDAR_ID='your-shared-calendar-id@group.calendar.google.com' \
  GOOGLE_SERVICE_ACCOUNT_EMAIL='booking-bridge@your-project.iam.gserviceaccount.com' \
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n'
```

## Deploy

```bash
supabase functions deploy google-calendar-booking --no-verify-jwt
```

## Frontend config

Point the public booking page to the deployed function in `booking/booking-config.js`:

```js
window.MarquisBookingConfig = {
  bookingEndpoint: "https://<project-ref>.supabase.co/functions/v1/google-calendar-booking",
  location: "Marquis day SPA",
  timezone: "America/Denver",
  successMessage: "Your session has been added to the shared calendar.",
};
```

## Conflict behavior

If the requested time overlaps an existing busy event, the function returns HTTP `409` instead of creating a new event.

## Your shared calendar

The calendar you mentioned fits this setup:

- `ca7a560e76044c59bbb72a70b98a21a774b99c2f5195eb7357ecd1a1cdf74344@group.calendar.google.com`

Use that value as `GOOGLE_CALENDAR_ID` after the calendar has been shared with the service account email.
