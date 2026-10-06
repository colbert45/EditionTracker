// Runs in the browser on the homepage. The page is already fully built as HTML;
// this keeps "in N days" and the Coming up / Already out split correct for the
// visitor's own date, and makes the category buttons work. Same rules as the design.
(() => {
  const old = location.hash.match(/^#\/item\/(.+)$/);
  if (old) { location.replace("/" + encodeURIComponent(decodeURIComponent(old[1])) + "/"); return; }

  const toDate = d => new Date(d + "T12:00:00");
  const short = d => toDate(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const long = d => toDate(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const daysOut = d => { const t = new Date(); t.setHours(12,0,0,0); return Math.round((toDate(d) - t) / 86400000); };
  const isOut = i => i.status === "out" || i.status === "soldout" || (i.date && daysOut(i.date) < 0);

  const app = document.getElementById("app");
  const items = [...app.querySelectorAll("li[data-i]")]
    .map(li => ({ li, n: +li.dataset.i, q: li.dataset.q || "", cat: li.dataset.cat, status: li.dataset.status, date: li.dataset.date || null }))
    .sort((a, b) => a.n - b.n);
  let filter = "all", query = "";

  function dateCell(i) {
    if (!i.date) return;
    let sub = "";
    if (!isOut(i)) { const n = daysOut(i.date); sub = n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`; }
    i.li.querySelector(".dt").innerHTML = (isOut(i) ? long(i.date) : short(i.date)) + (sub ? `<span>${sub}</span>` : "");
  }

  function fill(name, list, alwaysShow) {
    const sec = app.querySelector(`[data-sec="${name}"]`);
    const ul = sec.querySelector("ul");
    ul.replaceChildren(...list.map(i => i.li));
    if (!list.length) ul.innerHTML = `<li><p class="empty">Nothing here right now.</p></li>`;
    sec.hidden = !list.length && !alwaysShow;
  }

  function render() {
    const words = query.split(/\s+/).filter(Boolean);
    const pool = items.filter(i => (filter === "all" || i.cat === filter) && words.every(w => i.q.includes(w)));
    const byDate = (a, b) => (a.date || "9999").localeCompare(b.date || "9999");
    pool.forEach(dateCell);
    fill("coming", pool.filter(i => i.status !== "rumor" && !isOut(i)).sort(byDate), true);
    fill("rumors", pool.filter(i => i.status === "rumor"));
    fill("out", pool.filter(i => i.status !== "rumor" && isOut(i)).sort((a, b) => byDate(b, a)));
    app.querySelectorAll(".chips button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.cat === filter)));
  }

  app.querySelectorAll(".chips button").forEach(b => b.addEventListener("click", () => { filter = b.dataset.cat; render(); }));
  const search = app.querySelector(".search");
  if (search) search.addEventListener("input", () => { query = search.value.trim().toLowerCase(); render(); });
  app.querySelectorAll(".fwhen[data-date]").forEach(el => {
    const n = daysOut(el.dataset.date), sub = n < 0 ? "" : n === 0 ? "out today" : n === 1 ? "out tomorrow" : `in ${n} days`;
    const s = el.querySelector("span");
    if (s) s.textContent = sub;
  });
  render();

  // Featured carousel: swipe or scroll by hand, or let it advance every 6 seconds.
  // Pauses while hovered, focused or touched, when the tab is hidden, and never
  // auto-advances for people who prefer reduced motion.
  const car = app.querySelector(".carousel");
  if (car) {
    const track = car.querySelector(".feature");
    const slides = [...track.children];
    const dots = [...car.querySelectorAll(".dots button")];
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cur = 0, timer = null, held = false;
    const go = k => {
      cur = (k + slides.length) % slides.length;
      track.scrollTo({ left: slides[cur].offsetLeft - track.offsetLeft, behavior: still ? "auto" : "smooth" });
    };
    const mark = () => dots.forEach((d, k) => d.setAttribute("aria-current", String(k === cur)));
    const stop = () => { clearInterval(timer); timer = null; };
    const start = () => { stop(); if (!still && !held && !document.hidden && slides.length > 1) timer = setInterval(() => go(cur + 1), 6000); };
    track.addEventListener("scroll", () => {
      const k = Math.round(track.scrollLeft / track.clientWidth);
      if (k !== cur && slides[k]) { cur = k; }
      mark();
    }, { passive: true });
    dots.forEach((d, k) => d.addEventListener("click", () => { go(k); start(); }));
    car.querySelector(".cprev")?.addEventListener("click", () => { go(cur - 1); start(); });
    car.querySelector(".cnext")?.addEventListener("click", () => { go(cur + 1); start(); });
    const hold = v => () => { held = v; v ? stop() : start(); };
    car.addEventListener("mouseenter", hold(true));
    car.addEventListener("mouseleave", hold(false));
    car.addEventListener("focusin", hold(true));
    car.addEventListener("focusout", e => { if (!car.contains(e.relatedTarget)) hold(false)(); });
    track.addEventListener("touchstart", hold(true), { passive: true });
    track.addEventListener("touchend", () => setTimeout(hold(false), 4000), { passive: true });
    document.addEventListener("visibilitychange", start);
    start();
  }
})();
