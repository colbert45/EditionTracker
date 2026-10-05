/* Simple drawings of each item type, tinted to the edition's colors. Not product photos.
   Copied verbatim from design/edition-tracker.html. */
export function art(spec) {
  const [k, a, b, c] = spec || ["mystery", "#888", "#aaa", "#333"];
  const S = inner => `<svg viewBox="0 0 200 120" role="img" aria-hidden="true">${inner}</svg>`;
  const shadow = `<ellipse cx="100" cy="110" rx="78" ry="5" fill="#000" opacity=".08"/>`;
  switch (k) {
    case "hybrid": return S(shadow + `
      <rect x="20" y="30" width="26" height="70" rx="12" fill="${a}"/><rect x="154" y="30" width="26" height="70" rx="12" fill="${a}"/>
      <rect x="44" y="30" width="112" height="70" rx="5" fill="${c}"/><rect x="50" y="36" width="100" height="58" rx="2" fill="#2A2F38"/>
      <path d="M50 36h40l-22 58H50z" fill="#fff" opacity=".06"/>
      <circle cx="33" cy="48" r="6" fill="${c}"/><circle cx="167" cy="76" r="6" fill="${c}"/>
      <g fill="${b}"><circle cx="167" cy="44" r="2.6"/><circle cx="173" cy="50" r="2.6"/><circle cx="161" cy="50" r="2.6"/><circle cx="167" cy="56" r="2.6"/>
      <rect x="30" y="68" width="6" height="16" rx="1"/><rect x="25" y="73" width="16" height="6" rx="1"/></g>
      <rect x="44" y="96" width="112" height="4" fill="${b}" opacity=".9"/>`);
    case "pad": return S(shadow + `
      <path d="M56 34h88c18 0 28 12 32 30l6 30c3 13-9 20-18 12l-16-16H52l-16 16c-9 8-21 1-18-12l6-30c4-18 14-30 32-30z" fill="${a}"/>
      <path d="M56 34h88c10 0 18 4 23 12H33c5-8 13-12 23-12z" fill="#fff" opacity=".18"/>
      <circle cx="74" cy="76" r="10" fill="${c}"/><circle cx="126" cy="76" r="10" fill="${c}"/>
      <circle cx="74" cy="76" r="6" fill="${b}"/><circle cx="126" cy="76" r="6" fill="${b}"/>
      <g fill="${c}"><rect x="46" y="50" width="6" height="18" rx="1"/><rect x="40" y="56" width="18" height="6" rx="1"/></g>
      <g fill="${b}"><circle cx="152" cy="50" r="3.4"/><circle cx="160" cy="58" r="3.4"/><circle cx="144" cy="58" r="3.4"/><circle cx="152" cy="66" r="3.4"/></g>
      <rect x="88" y="46" width="24" height="12" rx="3" fill="${b}" opacity=".85"/>`);
    case "case": return S(shadow + `
      <rect x="62" y="10" width="76" height="98" rx="4" fill="${a}"/>
      <rect x="62" y="10" width="76" height="16" rx="4" fill="${a}"/><rect x="62" y="20" width="76" height="6" fill="#000" opacity=".15"/>
      <rect x="70" y="32" width="60" height="62" rx="2" fill="${c}"/>
      <path d="M70 32h60v62z" fill="${b}" opacity=".55"/><path d="M78 32h14l-22 40V50z" fill="#fff" opacity=".35"/>
      <rect x="76" y="98" width="48" height="4" rx="2" fill="#fff" opacity=".5"/>`);
    case "mystery": return S(shadow + `
      <path d="M48 40l52-20 52 20v52l-52 18-52-18z" fill="${c}"/><path d="M48 40l52 18 52-18-52-20z" fill="${a}"/>
      <path d="M100 58v52l52-18V40z" fill="#000" opacity=".2"/>
      <text x="100" y="94" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="34" fill="${b}" text-anchor="middle">?</text>`);
    case "joycons": return S(shadow + `
      <rect x="62" y="16" width="30" height="88" rx="14" fill="${a}"/><rect x="108" y="16" width="30" height="88" rx="14" fill="${b}"/>
      <circle cx="76" cy="38" r="7" fill="#1B1D22"/><circle cx="123" cy="74" r="7" fill="#1B1D22"/>
      <g fill="${c}"><circle cx="123" cy="34" r="3"/><circle cx="130" cy="41" r="3"/><circle cx="116" cy="41" r="3"/><circle cx="123" cy="48" r="3"/>
      <rect x="73" y="62" width="6" height="18" rx="1"/><rect x="67" y="68" width="18" height="6" rx="1"/></g>`);
    case "figure": return S(shadow + `
      <ellipse cx="72" cy="100" rx="24" ry="7" fill="${c}"/><ellipse cx="128" cy="100" rx="24" ry="7" fill="${c}"/>
      <rect x="62" y="44" width="20" height="54" rx="10" fill="${a}"/><circle cx="72" cy="34" r="12" fill="${a}"/>
      <rect x="118" y="44" width="20" height="54" rx="10" fill="${b}"/><circle cx="128" cy="34" r="12" fill="${b}"/>
      <path d="M62 30c4-14 16-14 20 0z" fill="#fff" opacity=".2"/><path d="M118 30c4-14 16-14 20 0z" fill="#fff" opacity=".2"/>`);
    case "bricks": {
      const brick = (x, y, w, col) => `<rect x="${x}" y="${y}" width="${w}" height="18" rx="2" fill="${col}"/><rect x="${x}" y="${y + 14}" width="${w}" height="4" fill="#000" opacity=".15"/>` +
        Array.from({ length: Math.floor(w / 16) }, (_, i) => `<rect x="${x + 4 + i * 16}" y="${y - 5}" width="9" height="5" rx="1" fill="${col}"/>`).join("");
      return S(shadow + brick(44, 88, 112, c) + brick(52, 66, 64, a) + brick(116, 66, 32, b) + brick(68, 44, 48, b) + brick(84, 22, 32, a));
    }
    case "tower": return S(shadow + `
      <rect x="66" y="8" width="68" height="98" rx="4" fill="${a}" opacity=".55"/><rect x="66" y="8" width="68" height="98" rx="4" fill="none" stroke="${a}" stroke-width="2"/>
      <g opacity=".75" fill="${b}"><rect x="74" y="30" width="52" height="8" rx="1"/><rect x="74" y="44" width="34" height="20" rx="1"/><rect x="112" y="44" width="14" height="44" rx="1"/><rect x="74" y="70" width="34" height="18" rx="1"/></g>
      <ellipse cx="100" cy="16" rx="26" ry="4" fill="${c}" opacity=".8"/><circle cx="76" cy="98" r="3" fill="${c}"/>
      <path d="M70 12h18L72 100h-2z" fill="#fff" opacity=".18"/>`);
    case "keyboard": return S(`<ellipse cx="100" cy="104" rx="88" ry="5" fill="#000" opacity=".08"/>
      <rect x="10" y="44" width="150" height="56" rx="6" fill="${a}" opacity=".7"/><rect x="10" y="44" width="150" height="56" rx="6" fill="none" stroke="${a}" stroke-width="2"/>
      ${Array.from({ length: 4 }, (_, r) => Array.from({ length: 12 }, (_, i) => `<rect x="${17 + i * 11.6}" y="${50 + r * 11.5}" width="9" height="9" rx="1.5" fill="${b}"/>`).join("")).join("")}
      <path d="M168 62c0-10 8-16 14-16s14 6 14 16v18c0 12-6 20-14 20s-14-8-14-20z" fill="${a}" opacity=".75"/><path d="M182 46v20" stroke="${b}" stroke-width="2"/>`);
    case "dock": return S(shadow + `
      <path d="M40 74h120l8 30H32z" fill="${a}" opacity=".7"/><path d="M40 74h120l8 30H32z" fill="none" stroke="${a}" stroke-width="2"/>
      <path d="M58 30h30c8 0 12 6 14 14l2 30H48l2-30c2-8 4-14 8-14z" fill="${b}"/><path d="M112 30h30c4 0 6 6 8 14l2 30H96l2-30c2-8 6-14 14-14z" fill="${b}"/>
      <circle cx="132" cy="96" r="3" fill="${c}"/><circle cx="68" cy="96" r="3" fill="${c}"/>`);
    case "phonepad": return S(shadow + `
      <rect x="20" y="40" width="34" height="56" rx="14" fill="${a}"/><rect x="146" y="40" width="34" height="56" rx="14" fill="${a}"/>
      <rect x="50" y="42" width="100" height="52" rx="8" fill="${b}"/><rect x="56" y="47" width="88" height="42" rx="4" fill="#2A2F38"/>
      <circle cx="37" cy="58" r="6" fill="${b}"/><circle cx="163" cy="78" r="6" fill="${b}"/>
      <g fill="${c}"><circle cx="163" cy="54" r="2.6"/><circle cx="169" cy="60" r="2.6"/><circle cx="157" cy="60" r="2.6"/></g>`);
    case "handheld": return S(shadow + `
      <path d="M30 34h140c12 0 18 10 18 22v26c0 14-8 22-20 22-8 0-12-4-18-10H50c-6 6-10 10-18 10-12 0-20-8-20-22V56c0-12 6-22 18-22z" fill="${a}"/>
      <path d="M30 34h140c8 0 14 4 16 12H14c2-8 8-12 16-12z" fill="#fff" opacity=".08"/>
      <rect x="52" y="38" width="96" height="56" rx="3" fill="#0B0D12"/><path d="M52 38h36L66 94H52z" fill="#fff" opacity=".06"/>
      <circle cx="34" cy="56" r="8" fill="${c}"/><circle cx="34" cy="56" r="8" fill="none" stroke="${b}" stroke-width="1.5"/>
      <circle cx="166" cy="78" r="8" fill="${c}"/><circle cx="166" cy="78" r="8" fill="none" stroke="${b}" stroke-width="1.5"/>
      <g fill="${b}"><circle cx="166" cy="50" r="2.6"/><circle cx="172" cy="56" r="2.6"/><circle cx="160" cy="56" r="2.6"/><circle cx="166" cy="62" r="2.6"/></g>`);
    case "ps5": return S(shadow + `
      <path d="M70 8c-6 0-10 4-10 10v80c0 6 4 10 10 10h6V8z" fill="${a}"/><path d="M130 8c6 0 10 4 10 10v80c0 6-4 10-10 10h-6V8z" fill="${a}"/>
      <rect x="76" y="8" width="48" height="100" rx="3" fill="${b}"/>
      <path d="M64 30l14-10M62 40l16-12M138 70l-14 10M140 80l-16 12" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
      <rect x="84" y="20" width="32" height="3" rx="1.5" fill="${c}"/>`);
    case "ocarina": return S(shadow + `
      <path d="M150 52l30-14c5-2 9 6 4 9l-26 16z" fill="${a}"/>
      <ellipse cx="96" cy="66" rx="64" ry="38" fill="${a}"/>
      <ellipse cx="80" cy="50" rx="40" ry="14" fill="#fff" opacity=".18"/>
      <g fill="${c}"><circle cx="58" cy="62" r="6"/><circle cx="80" cy="74" r="6"/><circle cx="104" cy="78" r="6"/><circle cx="126" cy="72" r="6"/><circle cx="64" cy="84" r="4"/><circle cx="118" cy="56" r="4"/></g>
      <g fill="${b}"><path d="M96 44l7 12H89z"/><path d="M89 56l7 12H82z"/><path d="M103 56l7 12H96z"/></g>`);
    case "cebox": return S(shadow + `
      <path d="M40 34l20-16h120l-20 16z" fill="${a}"/><path d="M40 34l20-16h120l-20 16z" fill="#fff" opacity=".22"/>
      <path d="M160 34l20-16v74l-20 16z" fill="${a}"/><path d="M160 34l20-16v74l-20 16z" fill="#000" opacity=".25"/>
      <rect x="40" y="34" width="120" height="74" fill="${a}"/>
      <rect x="40" y="46" width="120" height="7" fill="${b}"/>
      <circle cx="100" cy="80" r="18" fill="${c}"/><circle cx="100" cy="80" r="11" fill="${b}"/>
      <path d="M44 38h30L52 104h-8z" fill="#fff" opacity=".08"/>`);
  }
  return "";
}

export const ART_TYPES = ["hybrid", "pad", "case", "mystery", "joycons", "figure", "bricks", "tower", "keyboard", "dock", "phonepad", "handheld", "ps5", "ocarina", "cebox"];
