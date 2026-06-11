(function () {
  if (document.querySelector("[data-booking-cta]")) {
    return;
  }

  const cta = document.createElement("a");
  const path = window.location.pathname.replace(/index\.html$/, "");
  const isChildPage = /\/(about|books|contact|shop|work-with-me)\/?$/.test(path);
  cta.href = isChildPage ? "../booking/" : "booking/";
  cta.textContent = "Book Now";
  cta.setAttribute("data-booking-cta", "true");

  Object.assign(cta.style, {
    position: "fixed",
    right: "18px",
    bottom: "18px",
    zIndex: "9999",
    padding: "14px 18px",
    borderRadius: "999px",
    background: "linear-gradient(135deg, #8f5b3e, #6d3b22)",
    color: "#fff9f3",
    textDecoration: "none",
    fontFamily: "Arial, sans-serif",
    fontWeight: "700",
    letterSpacing: "0.02em",
    boxShadow: "0 18px 40px rgba(60, 35, 22, 0.28)",
  });

  document.body.appendChild(cta);
})();
