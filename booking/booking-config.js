window.MarquisBookingConfig = {
  bookingEndpoint: "https://marquis-booking-bridge.marquis-spa.workers.dev",
  location: "Marquis day SPA",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  successMessage: "Your booking request was submitted to the shared calendar.",
};
