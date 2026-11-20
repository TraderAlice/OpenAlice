/**
 * AutoQuant Studio Frontend (v1.0)
 *
 * Modular, zero-dependency, CSP-strict (`style-src 'self'`) quantitative desk UI.
 *
 * Agent Extension Guide:
 * - Drop `.json` (`{"title", "type": "line"|"bar"|"table", ...}`), `.svg`, `.md`, or `.csv`
 *   into `runs/<run_id>/artifacts/` and Studio renders them automatically.
 * - To add a bespoke desk panel in JS, push `{ title, render(el, ctx) }` onto `CUSTOM_PANELS`,
 *   where `ctx` provides `{ project, run, detail, renderLineChart, renderBarChart, fmt, fmtMetric }`.
 */
"use strict";

const PALETTE = ["#38bdf8", "#10b981", "#f59e0b", "#a78bfa", "#f43f5e"];
const SVG_NS = "http://www.w3.org/2000/svg";
const CUSTOM_PANELS = [];

const STATE = {
  snapshot: null,
  projectId: null,
  splitFilter: "all",
  sortBy: "created_at",
  focusedRunId: null,
  comparedIds: [],
  runCache: new Map(),
  autoRefresh: true,
  briefOpen: false,
  auditOpen: false,
  timer: null,
};

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PCT_KEYS = /return|drawdown|volatility|cagr|turnover|cost|win_rate|hit_rate/i;

function fmtMetric(key, val) {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return "—";
  const n = Number(val);
  if (PCT_KEYS.test(key)) return `${(n * 100).toFixed(2)}%`;
  return /ic/i.test(key) ? n.toFixed(4) : n.toFixed(2);
}

function fmtNum(val, pct = false, digits = 2) {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return "—";
  const n = Number(val);
  return pct ? `${(n * 100).toFixed(digits)}%` : n.toFixed(digits);
}

function renderMarkdown(text) {
  if (!text || !text.trim()) return '<p class="muted">No notes recorded.</p>';
  const out = [];
  let inCode = false;
  let inList = false;
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  for (const raw of String(text).replace(/\r\n/g, "\n").split("\n")) {
    if (raw.trim().startsWith("```")) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(inCode ? "</code></pre>" : '<pre class="code-box"><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(esc(raw) + "\n"); continue; }
    const t = raw.trim();
    if (!t) { if (inList) { out.push("</ul>"); inList = false; } continue; }
    if (t.startsWith("### ")) { out.push(`<h3>${inline(t.slice(4))}</h3>`); continue; }
    if (t.startsWith("## ")) { out.push(`<h2>${inline(t.slice(3))}</h2>`); continue; }
    if (t.startsWith("# ")) { out.push(`<h1>${inline(t.slice(2))}</h1>`); continue; }
    if (t.startsWith("- ") || t.startsWith("* ")) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(t.slice(2))}</li>`);
      continue;
    }
    if (inList) { out.push("</ul>"); inList = false; }
    out.push(`<p>${inline(t)}</p>`);
  }
  if (inList) out.push("</ul>");
  if (inCode) out.push("</code></pre>");
  return out.join("");
}

function svgEl(tag, attrs = {}, text = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  if (text !== null) node.textContent = String(text);
  return node;
}

function renderLineChart(host, seriesList, opts = {}) {
  host.replaceChildren();
  const valid = (seriesList || []).filter((s) => Array.isArray(s.points) && s.points.length > 0);
  if (!valid.length) {
    host.innerHTML = '<p class="muted">No time-series points available.</p>';
    return;
  }
  const W = opts.width || 620;
  const H = opts.height || 220;
  const pad = { l: 54, r: 14, t: 12, b: 24 };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;

  let yMin = Infinity;
  let yMax = -Infinity;
  let maxLen = 0;
  let xLabels = [];
  for (const s of valid) {
    if (s.points.length > maxLen) {
      maxLen = s.points.length;
      xLabels = s.points.map((p) => p.x ?? "");
    }
    for (const p of s.points) {
      if (Number.isFinite(p.y)) { yMin = Math.min(yMin, p.y); yMax = Math.max(yMax, p.y); }
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return;
  if (opts.includeZero) { yMin = Math.min(yMin, 0); yMax = Math.max(yMax, 0); }
  if (yMin === yMax) { yMin -= 0.05; yMax += 0.05; }
  const span = yMax - yMin;
  const xAt = (i, len) => pad.l + (len <= 1 ? pw / 2 : (i / (len - 1)) * pw);
  const yAt = (v) => pad.t + ph - ((v - yMin) / span) * ph;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
  for (let g = 0; g <= 4; g++) {
    const val = yMin + (span * g) / 4;
    const y = yAt(val);
    svg.appendChild(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: "var(--grid)", "stroke-width": 1 }));
    svg.appendChild(svgEl("text", { x: pad.l - 6, y: y + 3, fill: "var(--muted)", "font-size": 10, "font-family": "var(--mono)", "text-anchor": "end" }, fmtNum(val, opts.pct, opts.digits ?? 2)));
  }
  if (xLabels.length) {
    const idxs = xLabels.length > 2 ? [0, Math.floor((xLabels.length - 1) / 2), xLabels.length - 1] : [0];
    for (const idx of idxs) {
      const anchor = idx === 0 ? "start" : idx === xLabels.length - 1 ? "end" : "middle";
      svg.appendChild(svgEl("text", { x: xAt(idx, xLabels.length), y: H - 6, fill: "var(--muted)", "font-size": 10, "font-family": "var(--mono)", "text-anchor": anchor }, String(xLabels[idx]).slice(0, 10)));
    }
  }

  valid.forEach((s, idx) => {
    const color = s.color || PALETTE[idx % PALETTE.length];
    const coords = s.points.map((p, i) => (Number.isFinite(p.y) ? `${xAt(i, s.points.length).toFixed(1)},${yAt(p.y).toFixed(1)}` : null)).filter(Boolean);
    if (!coords.length) return;
    if (opts.areaFill && valid.length === 1) {
      const base = yAt(Math.min(0, yMax)).toFixed(1);
      svg.appendChild(svgEl("polygon", { points: `${xAt(0, s.points.length).toFixed(1)},${base} ${coords.join(" ")} ${xAt(s.points.length - 1, s.points.length).toFixed(1)},${base}`, fill: color, opacity: 0.16 }));
    }
    svg.appendChild(svgEl("polyline", { fill: "none", stroke: color, "stroke-width": s.dashed ? 1.5 : 2, "stroke-dasharray": s.dashed ? "5,4" : null, points: coords.join(" ") }));
  });

  const cursor = svgEl("line", { x1: pad.l, x2: pad.l, y1: pad.t, y2: pad.t + ph, stroke: "var(--muted)", "stroke-width": 1, "stroke-dasharray": "3,3", opacity: 0 });
  svg.appendChild(cursor);
  const hit = svgEl("rect", { x: pad.l, y: pad.t, width: pw, height: ph, fill: "transparent" });
  hit.addEventListener("mousemove", (ev) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || maxLen < 1) return;
    const ratio = Math.max(0, Math.min(1, (((ev.clientX - rect.left) / rect.width) * W - pad.l) / pw));
    const idx = Math.round(ratio * (maxLen - 1));
    const cx = xAt(idx, maxLen).toFixed(1);
    cursor.setAttribute("x1", cx);
    cursor.setAttribute("x2", cx);
    cursor.setAttribute("opacity", "1");
    if (opts.onHover) {
      const parts = valid.map((s) => {
        const pt = s.points[Math.min(idx, s.points.length - 1)];
        return pt ? `${s.name}: ${fmtNum(pt.y, opts.pct, opts.digits ?? 2)}` : "";
      });
      opts.onHover(`${String(xLabels[idx] || "").slice(0, 10)} · ${parts.filter(Boolean).join(" | ")}`);
    }
  });
  hit.addEventListener("mouseleave", () => {
    cursor.setAttribute("opacity", "0");
    if (opts.onHover) opts.onHover("");
  });
  svg.appendChild(hit);
  host.appendChild(svg);
}

function renderBarChart(host, items, opts = {}) {
  host.replaceChildren();
  if (!Array.isArray(items) || !items.length) {
    host.innerHTML = '<p class="muted">No bar data available.</p>';
    return;
  }
  const W = opts.width || 360;
  const H = opts.height || 185;
  const pad = { l: 48, r: 10, t: 14, b: 26 };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;

  const vals = items.flatMap((d) => (Number.isFinite(d.value2) ? [d.value, d.value2] : [d.value])).filter(Number.isFinite);
  if (!vals.length) return;
  let yMin = Math.min(0, ...vals);
  let yMax = Math.max(0, ...vals);
  if (yMin === yMax) { yMin -= 0.01; yMax += 0.01; }
  const span = yMax - yMin;
  const yAt = (v) => pad.t + ph - ((v - yMin) / span) * ph;
  const yZero = yAt(0);

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
  for (let g = 0; g <= 3; g++) {
    const val = yMin + (span * g) / 3;
    const y = yAt(val);
    svg.appendChild(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: "var(--grid)", "stroke-width": 1 }));
    svg.appendChild(svgEl("text", { x: pad.l - 5, y: y + 3, fill: "var(--muted)", "font-size": 9.5, "font-family": "var(--mono)", "text-anchor": "end" }, fmtNum(val, opts.pct, opts.digits ?? 3)));
  }
  svg.appendChild(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: yZero, y2: yZero, stroke: "var(--border)", "stroke-width": 1.2 }));

  const slot = pw / items.length;
  items.forEach((d, i) => {
    const hasSecond = Number.isFinite(d.value2);
    const bw = Math.max(6, Math.min(34, slot * (hasSecond ? 0.34 : 0.62)));
    const xBase = pad.l + i * slot + (slot - (hasSecond ? bw * 2 + 3 : bw)) / 2;
    const drawOne = (val, x, fill) => {
      if (!Number.isFinite(val)) return;
      const y = yAt(val);
      svg.appendChild(svgEl("rect", { x: x.toFixed(1), y: Math.min(y, yZero).toFixed(1), width: bw.toFixed(1), height: Math.max(1.5, Math.abs(yZero - y)).toFixed(1), rx: 2, fill }));
    };
    drawOne(d.value, xBase, opts.neutralColor ? "#38bdf8" : d.value >= 0 ? "var(--emerald)" : "var(--rose)");
    if (hasSecond) drawOne(d.value2, xBase + bw + 3, "#a78bfa");
    svg.appendChild(svgEl("text", { x: pad.l + i * slot + slot / 2, y: H - 7, fill: "var(--muted)", "font-size": 9.5, "font-family": "var(--mono)", "text-anchor": "middle" }, String(d.label).slice(0, 8)));
  });
  host.appendChild(svg);
}

function sanitizeSvgForDataUri(raw) {
  const clean = String(raw || "")
    .replace(/<\s*(script|foreignObject|iframe|object|embed)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|foreignObject|iframe|object|embed)\b[^>]*\/?\s*>/gi, "")
    .replace(/\son[a-z0-9_]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`;
}

function renderCustomJsonArtifact(card, title, data) {
  const type = data && typeof data === "object" ? data.type : null;
  if (type === "line") {
    const host = document.createElement("div");
    host.className = "svg-host";
    const xs = data.x || data.labels || data.timestamps || [];
    let series = [];
    if (Array.isArray(data.series)) {
      series = data.series.map((s, idx) => ({
        name: s.name || `S${idx + 1}`,
        color: PALETTE[idx % PALETTE.length],
        points: Array.isArray(s.points)
          ? s.points.map((p, i) => (typeof p === "object" ? { x: p.x ?? xs[i] ?? i, y: Number(p.y ?? p.value) } : { x: xs[i] ?? i, y: Number(p) }))
          : (s.values || s.data || []).map((v, i) => ({ x: xs[i] ?? i, y: Number(v) })),
      }));
    } else if (Array.isArray(data.y) || Array.isArray(data.values)) {
      series = [{ name: title, points: (data.y || data.values).map((v, i) => ({ x: xs[i] ?? i, y: Number(v) })) }];
    } else if (Array.isArray(data.data)) {
      series = [{ name: title, points: data.data.map((r, i) => ({ x: r.x ?? r.timestamp ?? i, y: Number(r.y ?? r.value) })) }];
    }
    card.appendChild(host);
    renderLineChart(host, series, { width: 420, height: 180, pct: Boolean(data.pct) });
    return;
  }
  if (type === "bar") {
    const host = document.createElement("div");
    host.className = "svg-host";
    const src = data.bars || data.data || data.items;
    const labels = data.labels || data.x || [];
    const values = data.values || data.y || [];
    const bars = Array.isArray(src)
      ? src.map((b, i) => ({ label: b.label ?? b.x ?? b.name ?? i + 1, value: Number(b.value ?? b.y ?? 0) }))
      : labels.map((l, i) => ({ label: l, value: Number(values[i] ?? 0) }));
    card.appendChild(host);
    renderBarChart(host, bars, { width: 420, height: 180, pct: Boolean(data.pct) });
    return;
  }
  if (type === "table") {
    const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.data) ? data.data : [];
    const cols = Array.isArray(data.columns) ? data.columns : rows.length && typeof rows[0] === "object" && !Array.isArray(rows[0]) ? Object.keys(rows[0]) : [];
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    wrap.innerHTML = `<table class="quant-table"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows
      .slice(0, 60)
      .map((r) => `<tr>${(Array.isArray(r) ? r : cols.map((c) => r[c])).map((v) => `<td>${esc(v ?? "")}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>`;
    card.appendChild(wrap);
    return;
  }
  const pre = document.createElement("pre");
  pre.className = "code-box";
  pre.textContent = JSON.stringify(data, null, 2);
  card.appendChild(pre);
}

function renderArtifacts(run, detail) {
  const panel = $("artifacts-panel");
  const grid = $("artifacts-grid");
  const list = detail?.artifacts || [];
  if (!list.length) { panel.hidden = true; grid.replaceChildren(); return; }
  panel.hidden = false;
  $("artifacts-run-label").textContent = run.name || run.id;
  $("artifacts-count").textContent = String(list.length);
  grid.replaceChildren();

  for (const art of list) {
    const card = document.createElement("div");
    card.className = "artifact-card";
    const title = (art.data && art.data.title) || art.name || art.path;
    const head = document.createElement("div");
    head.className = "section-head";
    head.innerHTML = `<h4>${esc(title)}</h4><span class="pill">${esc(art.kind)}</span>`;
    card.appendChild(head);

    if (art.kind === "json") {
      renderCustomJsonArtifact(card, title, art.data);
    } else if (art.kind === "svg") {
      const img = document.createElement("img");
      img.className = "artifact-svg-img";
      img.alt = title;
      img.src = sanitizeSvgForDataUri(art.text);
      card.appendChild(img);
    } else if (art.kind === "markdown") {
      const md = document.createElement("div");
      md.className = "md-body";
      md.innerHTML = renderMarkdown(art.text);
      card.appendChild(md);
    } else if (art.kind === "csv") {
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      wrap.innerHTML = `<table class="quant-table"><thead><tr>${(art.columns || []).map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${(art.rows || [])
        .slice(0, 40)
        .map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`;
      card.appendChild(wrap);
    } else {
      const pre = document.createElement("pre");
      pre.className = "code-box";
      pre.textContent = art.text || `Binary artifact (${art.size_bytes || 0} bytes)`;
      card.appendChild(pre);
    }
    grid.appendChild(card);
  }
}

async function ensureRunDetail(projectId, runId) {
  const key = `${projectId}:${runId}`;
  if (STATE.runCache.has(key)) return STATE.runCache.get(key);
  const res = await fetch(`/api/v1/runs/${encodeURIComponent(projectId)}/${encodeURIComponent(runId)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed loading run ${runId} (${res.status})`);
  const payload = await res.json();
  STATE.runCache.set(key, payload);
  return payload;
}

function activeProject() {
  const projects = STATE.snapshot?.projects || [];
  return projects.find((p) => p.id === STATE.projectId) || projects[0] || null;
}

function filteredSortedRuns(project) {
  const runs = (project?.runs || []).filter((r) => STATE.splitFilter === "all" || r.split === STATE.splitFilter);
  const key = STATE.sortBy;
  return [...runs].sort((a, b) => {
    if (key === "created_at") return `${b.created_at}:${b.id}`.localeCompare(`${a.created_at}:${a.id}`);
    const an = typeof a.metrics?.[key] === "number" ? a.metrics[key] : -Infinity;
    const bn = typeof b.metrics?.[key] === "number" ? b.metrics[key] : -Infinity;
    return bn - an;
  });
}

function renderTopBarAndAudit(project) {
  const src = STATE.snapshot?.source;
  $("workspace-name").textContent = src ? `${src.name} · Quant research desk` : "Quant research desk";
  const select = $("project-select");
  const projects = STATE.snapshot?.projects || [];
  select.hidden = projects.length === 0;
  select.innerHTML = projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${p.runs.length})</option>`).join("");
  if (project) select.value = project.id;

  const badge = $("holdout-badge");
  const splitPill = $("split-pill");
  if (!project) {
    splitPill.hidden = true;
    badge.hidden = true;
    $("audit-drawer").hidden = true;
    return;
  }
  splitPill.hidden = false;
  badge.hidden = false;
  const sp = project.splits || {};
  splitPill.textContent = sp.train_end || sp.val_end || sp.holdout_end
    ? `Train <= ${sp.train_end || "—"} | Val <= ${sp.val_end || "—"} | Holdout <= ${sp.holdout_end || "—"}`
    : "Splits: unconfigured (in_sample)";

  const audit = project.holdout_audit || { unlock_count: 0, unlocks: [] };
  const count = Number(audit.unlock_count || 0);
  badge.className = count === 0 ? "holdout-badge is-untouched" : "holdout-badge is-unlocked";
  badge.textContent = count === 0 ? "Holdout Untouched" : `Holdout Unlocked ${count}×`;
  badge.setAttribute("aria-expanded", String(STATE.auditOpen));
  $("audit-drawer").hidden = !STATE.auditOpen;
  if (STATE.auditOpen) {
    const unlocks = audit.unlocks || [];
    $("audit-table-wrap").innerHTML = unlocks.length
      ? `<table class="quant-table"><thead><tr><th>Unlocked At</th><th>Run ID</th><th>Code SHA-256</th><th>Git Commit</th><th>Dirty</th></tr></thead><tbody>${unlocks
          .map((u) => `<tr><td>${esc(u.unlocked_at || "—")}</td><td><code>${esc(u.run_id || "—")}</code></td><td><code>${esc(String(u.code_sha256 || "—").slice(0, 16))}</code></td><td><code>${esc(String(u.git_commit || "—").slice(0, 12))}</code></td><td>${u.git_dirty ? "dirty" : "clean"}</td></tr>`)
          .join("")}</tbody></table>`
      : '<p class="muted">Holdout has not been unlocked in this project.</p>';
  }
}

function renderBriefAndKpis(project) {
  $("project-title").textContent = project.name;
  $("project-desc").textContent = project.description || project.root_dir;
  const valSharpes = project.runs.filter((r) => r.split === "val" && typeof r.metrics?.sharpe === "number").map((r) => r.metrics.sharpe);
  const bestVal = valSharpes.length ? Math.max(...valSharpes).toFixed(2) : "—";
  const unlocks = project.holdout_audit?.unlock_count ?? 0;
  $("kpi-strip").innerHTML = [
    ["Runs", project.runs.length],
    ["Datasets", project.datasets.length],
    ["Best Val Sharpe", bestVal],
    ["Holdout Audit", unlocks === 0 ? "0× (Clean)" : `${unlocks}× Unlocked`],
  ].map(([k, v]) => `<div class="kpi-chip"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");

  $("brief-panel").hidden = !STATE.briefOpen;
  $("brief-toggle-btn").setAttribute("aria-expanded", String(STATE.briefOpen));
  if (STATE.briefOpen) {
    $("research-md").innerHTML = renderMarkdown(project.research_markdown || "_No research.md written yet._");
    const ds = project.datasets || [];
    $("datasets-wrap").innerHTML = ds.length
      ? `<table class="quant-table"><thead><tr><th>ID</th><th>Interval</th><th>Symbols</th><th>Range</th><th class="num">Rows</th></tr></thead><tbody>${ds
          .map((d) => `<tr><td><code>${esc(d.id)}</code></td><td>${esc(d.interval || "—")}</td><td>${esc(Array.isArray(d.symbols) ? d.symbols.length : "—")}</td><td>${esc(d.start || "")}..${esc(d.end || "")}</td><td class="num">${esc(d.rows ?? "—")}</td></tr>`)
          .join("")}</tbody></table>`
      : '<p class="muted">No datasets registered in data/manifest.json.</p>';
  }
}

function renderInspector(run) {
  if (!run) return;
  $("detail-kind").textContent = `${run.kind} · ${run.id}`;
  $("detail-name").textContent = run.name;
  const splitEl = $("detail-split");
  splitEl.className = `split-tag split-${run.split}`;
  splitEl.textContent = run.split;
  $("detail-notes").innerHTML = renderMarkdown([run.hypothesis ? `**Hypothesis:** ${run.hypothesis}` : "", run.notes || ""].filter(Boolean).join("\n\n"));

  const entries = Object.entries(run.metrics || {});
  $("detail-metrics").innerHTML = entries.length
    ? entries.map(([k, v]) => `<div class="metric-cell"><span>${esc(k)}</span><b>${esc(fmtMetric(k, v))}</b></div>`).join("")
    : '<p class="muted">No scalar metrics recorded.</p>';
  $("detail-params").textContent = JSON.stringify(run.parameters || {}, null, 2);

  const prov = run.provenance || {};
  const dsLabel = typeof run.dataset === "string" ? run.dataset : run.dataset?.id || JSON.stringify(run.dataset || "—");
  $("detail-provenance").innerHTML = [
    ["Created", run.created_at || "—"],
    ["Dataset", dsLabel],
    ["Code SHA", prov.code_sha256 ? String(prov.code_sha256).slice(0, 16) : "—"],
    ["Git Commit", prov.git_commit ? `${String(prov.git_commit).slice(0, 12)}${prov.git_dirty ? " (dirty)" : ""}` : "—"],
    ["Harness", prov.harness_version || "—"],
  ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
}

async function renderChartsAndFactor(project, focusedRun) {
  const overlayIds = STATE.comparedIds.length ? STATE.comparedIds : focusedRun ? [focusedRun.id] : [];
  const needIds = [...new Set([...overlayIds, ...(focusedRun ? [focusedRun.id] : [])])];
  const details = new Map();
  await Promise.all(needIds.map(async (id) => {
    try { details.set(id, await ensureRunDetail(project.id, id)); } catch (_e) { details.set(id, null); }
  }));

  const eqSeries = [];
  const ddSeries = [];
  const legendItems = [];
  overlayIds.forEach((id, idx) => {
    const det = details.get(id);
    const rows = det?.series?.equity || [];
    if (!rows.length) return;
    const label = det.run.name || id;
    const baseEq = rows.find((r) => typeof r.equity === "number" && r.equity > 0)?.equity || 1;
    const pts = rows.map((r) => ({ x: r.timestamp, y: overlayIds.length > 1 && baseEq ? r.equity / baseEq : r.equity }));
    eqSeries.push({ name: label, color: PALETTE[idx % PALETTE.length], points: pts });
    ddSeries.push({ name: label, color: PALETTE[idx % PALETTE.length], points: rows.map((r) => ({ x: r.timestamp, y: r.drawdown ?? 0 })) });
    legendItems.push(`<span class="legend-item"><i class="swatch swatch-${idx % 5}"></i>${esc(label)} (${fmtNum(pts[pts.length - 1]?.y, false, 3)})</span>`);
    if (overlayIds.length === 1 && rows.some((r) => typeof r.benchmark_equity === "number")) {
      eqSeries.push({ name: "Benchmark", color: "var(--muted)", dashed: true, points: rows.map((r) => ({ x: r.timestamp, y: r.benchmark_equity })) });
      legendItems.push('<span class="legend-item"><i class="swatch swatch-bench"></i>Benchmark (dashed)</span>');
    }
  });

  $("equity-subtitle").textContent = overlayIds.length > 1 ? `Comparing ${overlayIds.length} runs (normalized to 1.0)` : "Cumulative portfolio / long-short equity";
  $("equity-legend").innerHTML = legendItems.join("");
  renderLineChart($("equity-chart"), eqSeries, { onHover: (t) => { $("equity-readout").textContent = t; }, digits: 3 });
  renderLineChart($("drawdown-chart"), ddSeries, { pct: true, includeZero: true, areaFill: ddSeries.length === 1, onHover: (t) => { $("drawdown-readout").textContent = t; } });

  const focusedDetail = focusedRun ? details.get(focusedRun.id) : null;
  const icRows = focusedDetail?.series?.ic || [];
  const qt = focusedDetail?.series?.quantiles || null;
  const hasFactor = icRows.length > 0 || Boolean(qt);
  $("factor-panel").hidden = !hasFactor;
  if (hasFactor && focusedRun) {
    $("factor-run-label").textContent = focusedRun.name;
    const m = focusedRun.metrics || {};
    $("factor-summary").textContent = `IC Mean: ${fmtMetric("ic_mean", m.ic_mean)} · Rank IC: ${fmtMetric("rank_ic_mean", m.rank_ic_mean)} · IC IR: ${fmtMetric("ic_ir", m.ic_ir)}`;
    let cumIc = 0;
    let cumRank = 0;
    const icSeries = [];
    if (icRows.length) {
      icSeries.push({ name: "Cum IC", color: "#38bdf8", points: icRows.map((r) => ({ x: r.timestamp, y: (cumIc += r.ic || 0) })) });
      if (icRows.some((r) => typeof r.rank_ic === "number")) {
        icSeries.push({ name: "Cum Rank IC", color: "#10b981", dashed: true, points: icRows.map((r) => ({ x: r.timestamp, y: (cumRank += r.rank_ic || 0) })) });
      }
    }
    renderLineChart($("ic-chart"), icSeries, { width: 360, height: 185, includeZero: true, digits: 3 });
    renderBarChart($("quantile-chart"), (qt?.quantiles || []).map((q, i) => ({ label: `Q${q.bucket ?? q.quantile ?? i + 1}`, value: Number(q.mean_return ?? q.annual_return ?? q.return ?? 0) })), { pct: true, digits: 2 });
    renderBarChart($("decay-chart"), (qt?.decay || []).map((d) => ({ label: `${d.horizon}b`, value: Number(d.ic_mean ?? 0), value2: typeof d.rank_ic_mean === "number" ? d.rank_ic_mean : undefined })), { neutralColor: true, digits: 4 });
  }

  renderArtifacts(focusedRun, focusedDetail);
  const customHost = $("custom-panels-host");
  customHost.hidden = CUSTOM_PANELS.length === 0;
  if (CUSTOM_PANELS.length) {
    customHost.replaceChildren();
    for (const panelDef of CUSTOM_PANELS) {
      const box = document.createElement("div");
      box.className = "card";
      panelDef.render(box, { project, run: focusedRun, detail: focusedDetail, renderLineChart, renderBarChart, fmt: fmtNum, fmtNum, fmtMetric });
      customHost.appendChild(box);
    }
  }
}

async function renderAll() {
  const projects = STATE.snapshot?.projects || [];
  if (!projects.length) {
    renderTopBarAndAudit(null);
    $("empty-workspace").hidden = false;
    $("desk-main").hidden = true;
    return;
  }
  $("empty-workspace").hidden = true;
  $("desk-main").hidden = false;
  const project = activeProject();
  STATE.projectId = project.id;
  renderTopBarAndAudit(project);
  renderBriefAndKpis(project);

  if (!project.runs.length) {
    $("empty-runs").hidden = false;
    $("runs-workspace").hidden = true;
    $("qs-step-1").textContent = `import autoquant as aq\npanel = aq.load_panel("projects/${project.id}", split="val")`;
    return;
  }
  $("empty-runs").hidden = true;
  $("runs-workspace").hidden = false;

  const validIds = new Set(project.runs.map((r) => r.id));
  STATE.comparedIds = STATE.comparedIds.filter((id) => validIds.has(id)).slice(0, 5);
  const visible = filteredSortedRuns(project);
  if (!STATE.focusedRunId || !validIds.has(STATE.focusedRunId)) {
    STATE.focusedRunId = (visible[0] || project.runs[0]).id;
  }
  const focusedRun = project.runs.find((r) => r.id === STATE.focusedRunId) || project.runs[0];

  $("compare-pill").hidden = STATE.comparedIds.length === 0;
  $("clear-compare-btn").hidden = STATE.comparedIds.length === 0;
  $("compare-pill").textContent = `Comparing ${STATE.comparedIds.length}/5`;

  $("runs-tbody").innerHTML = visible.map((r) => {
    const m = r.metrics || {};
    const checked = STATE.comparedIds.includes(r.id);
    const disabled = !checked && STATE.comparedIds.length >= 5 ? "disabled" : "";
    const sh = m.sharpe ?? m.long_short_sharpe;
    return `<tr data-run-id="${esc(r.id)}" class="${r.id === focusedRun.id ? "is-focused" : ""}">
      <td class="col-chk"><input type="checkbox" data-cmp-id="${esc(r.id)}" ${checked ? "checked" : ""} ${disabled} aria-label="Compare ${esc(r.name)}"></td>
      <td><strong>${esc(r.name)}</strong></td>
      <td class="muted">${esc(r.kind)}</td>
      <td><span class="split-tag split-${esc(r.split)}">${esc(r.split)}</span></td>
      <td class="num ${typeof sh === "number" ? (sh >= 0 ? "pos" : "neg") : ""}">${esc(fmtMetric("sharpe", sh))}</td>
      <td class="num">${esc(fmtMetric("annual_return", m.annual_return))}</td>
      <td class="num neg">${esc(fmtMetric("max_drawdown", m.max_drawdown))}</td>
      <td class="num">${esc(fmtMetric("ic_mean", m.ic_mean ?? m.rank_ic_mean))}</td>
      <td class="num muted">${esc(String(r.created_at || "").slice(0, 16).replace("T", " "))}</td>
    </tr>`;
  }).join("");

  renderInspector(focusedRun);
  await renderChartsAndFactor(project, focusedRun);
}

async function refreshSnapshot() {
  try {
    const res = await fetch("/api/v1/snapshot", { cache: "no-store" });
    if (!res.ok) throw new Error(`Snapshot HTTP ${res.status}`);
    STATE.snapshot = await res.json();
    if (!STATE.projectId) STATE.projectId = STATE.snapshot.active_project_id;
    $("error-banner").hidden = true;
    $("sync-status").textContent = `Synced ${new Date().toLocaleTimeString()}`;
    await renderAll();
  } catch (err) {
    $("error-banner").hidden = false;
    $("error-banner").textContent = `Studio sync warning: ${err.message}`;
    $("sync-status").textContent = "Offline";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("project-select").addEventListener("change", (e) => { STATE.projectId = e.target.value; STATE.focusedRunId = null; STATE.comparedIds = []; renderAll(); });
  $("holdout-badge").addEventListener("click", () => { STATE.auditOpen = !STATE.auditOpen; renderTopBarAndAudit(activeProject()); });
  $("audit-close-btn").addEventListener("click", () => { STATE.auditOpen = false; renderTopBarAndAudit(activeProject()); });
  $("brief-toggle-btn").addEventListener("click", () => { STATE.briefOpen = !STATE.briefOpen; const p = activeProject(); if (p) renderBriefAndKpis(p); });
  $("refresh-btn").addEventListener("click", () => refreshSnapshot());
  $("auto-refresh-btn").addEventListener("click", (e) => { STATE.autoRefresh = !STATE.autoRefresh; e.currentTarget.setAttribute("aria-pressed", String(STATE.autoRefresh)); });
  $("split-filters").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-split]");
    if (!btn) return;
    STATE.splitFilter = btn.dataset.split;
    for (const el of $("split-filters").querySelectorAll(".filter-pill")) el.classList.toggle("is-active", el === btn);
    renderAll();
  });
  $("sort-select").addEventListener("change", (e) => { STATE.sortBy = e.target.value; renderAll(); });
  $("clear-compare-btn").addEventListener("click", () => { STATE.comparedIds = []; renderAll(); });
  $("runs-tbody").addEventListener("click", (e) => {
    const chk = e.target.closest("input[data-cmp-id]");
    if (chk) {
      e.stopPropagation();
      const id = chk.dataset.cmpId;
      STATE.comparedIds = chk.checked && STATE.comparedIds.length < 5 && !STATE.comparedIds.includes(id)
        ? [...STATE.comparedIds, id]
        : STATE.comparedIds.filter((x) => x !== id);
      renderAll();
      return;
    }
    const row = e.target.closest("tr[data-run-id]");
    if (row) { STATE.focusedRunId = row.dataset.runId; renderAll(); }
  });

  refreshSnapshot();
  STATE.timer = setInterval(() => { if (STATE.autoRefresh && !document.hidden) refreshSnapshot(); }, 5000);
});
