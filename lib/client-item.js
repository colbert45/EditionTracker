// Runs in the browser on a release page: keeps the countdown right for the visitor's date.
(() => {
  const el = document.querySelector(".countdown[data-release]");
  if (!el) return;
  const t = new Date(); t.setHours(12,0,0,0);
  const n = Math.round((new Date(el.dataset.release + "T12:00:00") - t) / 86400000);
  const cd = n > 1 ? `Out in ${n} days.` : n === 1 ? "Out tomorrow." : n === 0 ? "Out today." : "";
  el.textContent = cd;
  el.hidden = !cd;
})();
