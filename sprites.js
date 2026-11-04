// Claude Crew sprites: original pixel-art mini Claudes, 24x24 grid, drawn as SVG rects.
// Each part is a <g> the stylesheet animates (transform/opacity only).
(function (root) {
  const C = {
    clay: "#D97757", clayHi: "#E8956F", clayLo: "#B65C3F", ink: "#1B1612", shade: "rgba(0,0,0,.28)",
    white: "#F7F2EA", steel: "#A7B0B9", steelLo: "#6F7882", wood: "#8A5A3B", woodLo: "#6A4129",
  };
  const r = (x, y, w, h, f) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>`;

  // Base body, shared by all eight.
  const body = [
    r(5, 9, 14, 8, C.clay), r(6, 9, 12, 1, C.clayHi), r(5, 16, 14, 1, C.clayLo),
    r(5, 9, 1, 1, "transparent"),
  ].join("");
  const legs = [r(6, 17, 1, 2, C.clayLo), r(8, 17, 1, 2, C.clayLo), r(15, 17, 1, 2, C.clayLo), r(17, 17, 1, 2, C.clayLo)].join("");
  const armL = r(3, 12, 2, 2, C.clay);
  const armR = r(19, 12, 2, 2, C.clay);
  const eyes = r(8, 11, 1, 2, C.ink) + r(15, 11, 1, 2, C.ink);
  const sleepEyes = r(7, 12, 3, 1, C.ink) + r(14, 12, 3, 1, C.ink);

  // Outfits. hat = on the head, tool = in the right hand (rotates), toolL = left hand, deco = on the body, fx = effects.
  const V = [
    { id: "forge", name: "Forge", role: "Builder", accent: "#E9B44C",
      keys: /build|app|make|create|code|feature|implement|setup|install|scaffold|repo/i,
      hat: r(6, 6, 12, 3, "#F2C14E") + r(4, 8, 16, 1, "#C99A2E") + r(11, 5, 2, 1, "#F2C14E") + r(7, 6, 10, 1, "#F8D77E"),
      tool: r(21, 9, 1, 5, C.wood) + r(20, 7, 3, 2, C.steel) + r(20, 8, 3, 1, C.steelLo),
      fx: r(23, 6, 1, 1, "#F8D77E") + r(22, 4, 1, 1, "#F2C14E") + r(19, 5, 1, 1, "#F8D77E") },
    { id: "scout", name: "Scout", role: "Researcher", accent: "#5FB3A8",
      keys: /research|learn|find|look|read|review|audit|check|explore|search|why|how|what/i,
      deco: r(7, 10, 3, 1, "#2F6F66") + r(7, 13, 3, 1, "#2F6F66") + r(7, 10, 1, 4, "#2F6F66") + r(9, 10, 1, 4, "#2F6F66")
          + r(14, 10, 3, 1, "#2F6F66") + r(14, 13, 3, 1, "#2F6F66") + r(14, 10, 1, 4, "#2F6F66") + r(16, 10, 1, 4, "#2F6F66")
          + r(10, 11, 4, 1, "#2F6F66"),
      hat: r(5, 9, 14, 1, "#2F6F66") + r(10, 7, 4, 2, "#2F6F66") + r(11, 7, 2, 1, "#E6FFF9"),
      toolL: r(2, 13, 1, 3, C.wood) + r(0, 9, 4, 1, C.steelLo) + r(0, 12, 4, 1, C.steelLo) + r(0, 9, 1, 4, C.steelLo) + r(3, 9, 1, 4, C.steelLo) + r(1, 10, 2, 2, "#BFE7E1") },
    { id: "muse", name: "Muse", role: "Designer", accent: "#E07A8F",
      keys: /design|ui|ux|look|style|theme|logo|brand|color|icon|font|graphic|image|art|draw/i,
      hat: r(5, 7, 11, 2, "#C44D58") + r(6, 6, 8, 1, "#C44D58") + r(10, 5, 1, 1, "#C44D58") + r(6, 7, 8, 1, "#D96B75"),
      tool: r(21, 8, 1, 6, C.wood) + r(21, 6, 1, 2, "#E07A8F") + r(20, 5, 3, 1, "#E07A8F"),
      fx: r(22, 2, 1, 1, "#E07A8F") + r(19, 3, 1, 1, "#F2C14E") + r(23, 4, 1, 1, "#5FB3A8") },
    { id: "reel", name: "Reel", role: "Director", accent: "#9C88D9",
      keys: /video|reel|film|edit|clip|music|audio|voice|record|caption|tiktok|youtube|shoot|content/i,
      hat: r(6, 6, 12, 1, "#3A3540") + r(5, 7, 1, 2, "#3A3540") + r(18, 7, 1, 2, "#3A3540")
         + r(3, 9, 3, 4, "#3A3540") + r(18, 9, 3, 4, "#3A3540") + r(4, 10, 1, 2, "#9C88D9") + r(19, 10, 1, 2, "#9C88D9"),
      toolL: r(0, 12, 4, 4, "#26222B") + r(0, 13, 4, 1, C.white) + r(1, 15, 2, 1, C.white),
      clap: r(0, 10, 4, 2, "#26222B") + r(0, 10, 1, 1, C.white) + r(2, 10, 1, 1, C.white) + r(1, 11, 1, 1, C.white) + r(3, 11, 1, 1, C.white) },
    { id: "patch", name: "Patch", role: "Fixer", accent: "#7FB069",
      keys: /fix|bug|debug|error|broke|broken|crash|repair|issue|fail|wrong|patch|test/i,
      hat: r(6, 6, 12, 3, "#5E9E5A") + r(7, 6, 10, 1, "#7FB069") + r(1, 8, 6, 1, "#47804A") + r(11, 5, 2, 1, "#47804A"),
      tool: r(21, 9, 1, 5, C.steel) + r(20, 6, 1, 2, C.steel) + r(22, 6, 1, 2, C.steel) + r(20, 8, 3, 1, C.steelLo) + r(21, 14, 1, 1, C.steelLo),
      deco: r(12, 14, 4, 1, "#E9CFA6") + r(13, 13, 2, 3, "#E9CFA6") },
    { id: "quill", name: "Quill", role: "Writer", accent: "#D9C9A3",
      keys: /write|doc|note|plan|copy|script|caption|email|letter|readme|guide|summary|memo|blog|post/i,
      hat: r(6, 6, 12, 3, "#E3D3B0") + r(6, 8, 12, 1, "#C8B68E") + r(8, 6, 1, 2, "#C8B68E") + r(11, 6, 1, 2, "#C8B68E") + r(14, 6, 1, 2, "#C8B68E") + r(11, 4, 2, 2, "#F7F2EA"),
      tool: r(21, 12, 1, 2, C.ink) + r(21, 5, 1, 7, "#F7F2EA") + r(22, 4, 1, 6, "#E3D3B0") + r(20, 6, 1, 4, "#E3D3B0"),
      fx: r(22, 13, 1, 1, "#D9C9A3") + r(23, 12, 1, 1, "#D9C9A3") },
    { id: "rune", name: "Rune", role: "Wizard", accent: "#6C93F0",
      keys: /skill|automat|agent|workflow|mcp|prompt|config|schedul|trigger|hook|mod|claude|ai/i,
      hat: r(4, 8, 16, 1, "#3B5BC0") + r(6, 6, 12, 2, "#4B6FD8") + r(8, 4, 8, 2, "#4B6FD8") + r(10, 2, 5, 2, "#4B6FD8") + r(13, 0, 3, 2, "#4B6FD8") + r(10, 5, 1, 1, "#F2C14E") + r(14, 3, 1, 1, "#F2C14E"),
      tool: r(21, 8, 1, 6, C.woodLo) + r(20, 6, 3, 1, "#F8D77E") + r(21, 5, 1, 3, "#F8D77E"),
      fx: r(23, 3, 1, 1, "#F8D77E") + r(18, 2, 1, 1, "#9DB7F5") + r(22, 1, 1, 1, "#9DB7F5") },
    { id: "comet", name: "Comet", role: "Shipper", accent: "#6FC3DF",
      keys: /deploy|ship|release|publish|launch|live|push|domain|host|pages|vercel|cloudflare|store|upload/i,
      deco: r(5, 9, 14, 1, "#3A3540") + r(7, 8, 3, 3, "#3A3540") + r(14, 8, 3, 3, "#3A3540") + r(8, 9, 1, 1, "#BDEAF7") + r(15, 9, 1, 1, "#BDEAF7"),
      scarf: r(5, 15, 14, 1, "#E0584A") + r(1, 14, 4, 1, "#E0584A") + r(0, 15, 3, 1, "#C2463A"),
      fx: r(7, 19, 2, 2, "#F2C14E") + r(15, 19, 2, 2, "#F2C14E") + r(7, 21, 2, 1, "#E0584A") + r(15, 21, 2, 1, "#E0584A") },
  ];

  // Pick a variant for a task: keyword match, then first free one, cycling past eight.
  function assign(items) {
    const used = new Set(), out = {};
    items.forEach((it, i) => {
      let v = V.find(v => !used.has(v.id) && v.keys.test(it.title || ""));
      if (!v) v = V.find(v => !used.has(v.id));
      if (!v) v = V[i % V.length];
      used.add(v.id); if (used.size >= V.length) used.clear();
      out[it.id] = v.id;
    });
    return out;
  }

  function svg(id, state, opts) {
    const v = V.find(x => x.id === id) || V[0];
    const o = opts || {};
    const sleeping = state === "done";
    const g = (cls, inner) => inner ? `<g class="p-${cls}">${inner}</g>` : "";
    return `<svg class="sprite s-${v.id} st-${state || "idle"}" viewBox="-1 -6 26 30" ${o.size ? `width="${o.size}" height="${o.size}"` : ""} shape-rendering="crispEdges" aria-hidden="true">`
      + `<g class="p-shadow"><rect x="5" y="19" width="14" height="1" fill="${C.shade}"/></g>`
      + g("fx", v.fx)
      + `<g class="p-bob">`
      + g("legs", legs)
      + g("scarf", v.scarf)
      + g("body", body)
      + g("deco", v.deco)
      + (sleeping ? g("eyes-closed", sleepEyes) : g("eyes", eyes))
      + g("armL", armL)
      + g("toolL", v.toolL)
      + g("clap", v.clap)
      + `<g class="p-armR">${armR}${v.tool || ""}</g>`
      + g("hat", v.hat)
      + `</g>`
      + `<g class="p-alert" opacity="0">${r(19, -5, 5, 7, C.white)}${r(18, -4, 7, 5, C.white)}${r(21, -4, 1, 3, C.ink)}${r(21, 0, 1, 1, C.ink)}${r(19, 2, 1, 1, C.white)}</g>`
      + `<g class="p-zz" opacity="0">${r(19, 2, 4, 1, "#D8CFC3")}${r(21, 3, 1, 1, "#D8CFC3")}${r(20, 4, 1, 1, "#D8CFC3")}${r(19, 5, 4, 1, "#D8CFC3")}${r(22, -3, 3, 1, "#D8CFC3")}${r(23, -2, 1, 1, "#D8CFC3")}${r(22, -1, 3, 1, "#D8CFC3")}</g>`
      + `</svg>`;
  }

  root.CrewSprites = { V, assign, svg, C };
})(typeof window !== "undefined" ? window : globalThis);
