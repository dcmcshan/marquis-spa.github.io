# CalDAV Booking Bridge

GitHub Pages cannot safely talk to a private CalDAV server directly because the
CalDAV credentials would be visible in the browser. The pattern used here is:

1. Static site form on `/booking/`
2. Small server-side bridge
3. Bridge writes a `.ics` event into the shared CalDAV collection

## Files

- `booking/index.html`: booking form
- `booking/booking.js`: client-side submit logic
- `booking/booking-config.js`: site-side endpoint configuration
- `supabase/functions/caldav-booking/index.ts`: Supabase Edge Function bridge
- `supabase/config.toml`: function config
- `examples/caldav-booking-bridge.js`: generic bridge example if you move away from Supabase later

## Recommended deployment

Deploy the included Supabase Edge Function:

- `supabase/functions/caldav-booking/index.ts`
- `supabase/config.toml`

Set these environment variables:

- `ALLOWED_ORIGIN`: your GitHub Pages origin
- `CALDAV_COLLECTION_URL`: the full CalDAV collection URL where events are stored
- `CALDAV_USERNAME`: CalDAV username
- `CALDAV_PASSWORD`: CalDAV password or app password

## Supabase setup

From this repo:

```bash
supabase login
supabase link
supabase secrets set \
  ALLOWED_ORIGIN=https://<your-user>.github.io \
  CALDAV_COLLECTION_URL=https://caldav.example.com/calendars/team/shared \
  CALDAV_USERNAME=your-user \
  CALDAV_PASSWORD=your-password
supabase functions deploy caldav-booking --no-verify-jwt
```

Your public endpoint will look like:

```text
https://<project-ref>.supabase.co/functions/v1/caldav-booking
```

## Final hookup

After deploying the bridge, edit `booking/booking-config.js`:

```js
window.MarquisBookingConfig = {
  bookingEndpoint: "https://<project-ref>.supabase.co/functions/v1/caldav-booking",
  location: "Marquis day SPA",
  timezone: "America/Denver",
  successMessage: "Your session has been added to the shared calendar.",
};
```

## Notes

- The bridge currently creates one `.ics` event per request using `PUT`.
- The Supabase function now performs a CalDAV `REPORT` before writing and returns `409` when the requested window overlaps an existing event.
- If the endpoint is not configured yet, the booking page falls back to downloading an `.ics` request for manual import.
- `verify_jwt = false` is intentional so a public GitHub Pages form can call the function directly.
