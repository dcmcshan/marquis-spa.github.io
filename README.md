# Marquis GitHub Pages Mirror

This repository publishes a static snapshot of [marquis.spa](https://marquis.spa) to GitHub Pages.

## How it works

`scripts/mirror-site.sh` downloads the core public pages and their assets, then writes the generated HTML into the repository root. GitHub Pages can then serve the site as a plain static site with `.nojekyll`.

## Refresh the snapshot

```bash
./scripts/mirror-site.sh
```

After the script finishes:

1. Review the changed files.
2. Commit and push to `main`.
3. Publish with GitHub Pages from the repository root.

## Notes

- Interactive WordPress features such as cart, checkout, login, and AJAX booking behavior may not work fully on GitHub Pages.
- The current export targets the main marketing pages plus the shop and services landing pages. Add more URLs in `scripts/mirror-site.sh` if you want additional detail pages mirrored too.

## Booking

A lightweight booking flow is included at `/booking/`.

- The static page collects booking requests.
- A Supabase Edge Function can write the event into a shared calendar.
- CalDAV setup details are documented in `docs/caldav-booking-bridge.md`.
- Google Calendar setup details are documented in `docs/google-calendar-booking-bridge.md`.
