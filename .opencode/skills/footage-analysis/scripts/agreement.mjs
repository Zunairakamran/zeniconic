#!/usr/bin/env node
/**
 * agreement.mjs — per-field agreement between hand labels and model labels.
 *
 * Usage:
 *   node agreement.mjs labels.csv
 *   node agreement.mjs labels.csv --json report.json
 *   node agreement.mjs labels.csv --tol 0.5 --no-gate
 *
 * CSV: one row per shot. Pairs of columns, hand_<field> / model_<field>:
 *   clip_id, shot_id,
 *   hand_room, model_room,
 *   hand_camera_move, model_camera_move,
 *   hand_selling_points, model_selling_points,   (;-separated)
 *   hand_defects, model_defects,                 (;-separated)
 *   hand_best_in, model_best_in,
 *   hand_best_out, model_best_out,
 *   hand_score, model_score                      (0-100)
 *
 * Node 22, no dependencies. Exit 1 when a gate fails (--no-gate to override).
 */

import { readFileSync, writeFileSync } from "node:fs";

const FIELDS = [
  { key: "room", kind: "categorical", gate: 0.8, kappaGate: 0.7 },
  { key: "camera_move", kind: "categorical", gate: 0.7, kappaGate: 0.6 },
  { key: "selling_points", kind: "list", gate: 0.6 },
  { key: "defects", kind: "list", gate: 0.55 },
  { key: "best_in", kind: "time", gate: 0.75, tol: 0.35, maeGate: 0.6 },
  { key: "best_out", kind: "time", gate: 0.75, tol: 0.35, maeGate: 0.6 },
  { key: "score", kind: "score", maeGate: 8, rhoGate: 0.8 },
];

// ---------- args ----------
const argv = process.argv.slice(2);
const opts = { csv: null, json: null, tol: 0.35, gate: true };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--json") opts.json = argv[++i];
  else if (a === "--tol") opts.tol = Number(argv[++i]);
  else if (a === "--no-gate") opts.gate = false;
  else if (a === "--help" || a === "-h") {
    process.stdout.write("usage: node agreement.mjs <labels.csv> [--json out.json] [--tol 0.35] [--no-gate]\n");
    process.exit(0);
  } else if (!a.startsWith("-")) opts.csv = a;
  else throw new Error(`unknown flag ${a}`);
}
if (!opts.csv) {
  process.stderr.write("usage: node agreement.mjs <labels.csv> [--json out.json] [--tol 0.35] [--no-gate]\n");
  process.exit(2);
}

// ---------- csv ----------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const table = parseCsv(readFileSync(opts.csv, "utf8"));
if (table.length < 2) {
  process.stderr.write(`error: ${opts.csv} has no data rows\n`);
  process.exit(2);
}
const headers = table[0].map((h) => h.trim().toLowerCase());
const rows = table.slice(1).map((cells) => {
  const o = {};
  headers.forEach((h, i) => { o[h] = (cells[i] ?? "").trim(); });
  return o;
});

// ---------- helpers ----------
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const fmt = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");
const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "n/a");

function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

function toList(raw) {
  return [...new Set(
    raw.split(/[;|]/).map((s) => s.trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean)
  )];
}

function toNum(raw) {
  if (raw === "" || raw === "-") return NaN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function cohenKappa(pairs) {
  const n = pairs.length;
  if (!n) return NaN;
  const cats = [...new Set(pairs.flatMap(([h, m]) => [h, m]))];
  const po = pairs.filter(([h, m]) => h === m).length / n;
  const ph = new Map();
  const pm = new Map();
  for (const [h, m] of pairs) {
    ph.set(h, (ph.get(h) ?? 0) + 1);
    pm.set(m, (pm.get(m) ?? 0) + 1);
  }
  let pe = 0;
  for (const c of cats) pe += ((ph.get(c) ?? 0) / n) * ((pm.get(c) ?? 0) / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

function ranks(xs) {
  const order = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = r;
    i = j + 1;
  }
  return out;
}

function spearman(xs, ys) {
  if (xs.length < 3) return NaN;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy);
}

// ---------- scoring ----------
const report = {
  input: opts.csv,
  rows: rows.length,
  tol: opts.tol,
  fields: {},
  confusion: null,
  top1: null,
  failures: [],
};

const CATEGORY_ABSTAIN = new Set(["unknown", "", "n/a"]);

for (const f of FIELDS) {
  const hk = `hand_${f.key}`;
  const mk = `model_${f.key}`;
  if (!headers.includes(hk) || !headers.includes(mk)) continue;
  const result = { kind: f.kind, gate: f.gate ?? null };

  if (f.kind === "categorical") {
    const pairs = rows
      .filter((r) => r[hk] !== "" && r[mk] !== "")
      .map((r) => [r[hk].toLowerCase(), r[mk].toLowerCase()]);
    const certain = pairs.filter(([h, m]) => !CATEGORY_ABSTAIN.has(h) && !CATEGORY_ABSTAIN.has(m));
    result.n = pairs.length;
    result.agreement = pairs.length ? pairs.filter(([h, m]) => h === m).length / pairs.length : NaN;
    result.kappa = cohenKappa(pairs);
    result.nCertain = certain.length;
    result.agreementCertain = certain.length
      ? certain.filter(([h, m]) => h === m).length / certain.length
      : NaN;
    result.kappaCertain = cohenKappa(certain);
    if (f.key === "room") {
      const rowsC = pairs;
      const labels = [...new Set(rowsC.flat())].sort();
      const matrix = Object.fromEntries(labels.map((l) => [l, Object.fromEntries(labels.map((k) => [k, 0]))]));
      for (const [h, m] of rowsC) matrix[h][m]++;
      const confused = [];
      for (const h of labels) for (const m of labels) {
        if (h !== m && matrix[h][m] > 0) confused.push({ hand: h, model: m, n: matrix[h][m], share: matrix[h][m] / rowsC.length });
      }
      confused.sort((a, b) => b.n - a.n || a.hand.localeCompare(b.hand));
      const perClass = {};
      for (const l of labels) {
        const tp = matrix[l][l];
        const fp = labels.filter((h) => h !== l).reduce((s, h) => s + matrix[h][l], 0);
        const fn = labels.filter((m) => m !== l).reduce((s, m) => s + matrix[l][m], 0);
        const p = tp + fp === 0 ? NaN : tp / (tp + fp);
        const r = tp + fn === 0 ? NaN : tp / (tp + fn);
        perClass[l] = { support: tp + fn, precision: p, recall: r, f1: !p || !r ? 0 : (2 * p * r) / (p + r) };
      }
      report.confusion = { labels, matrix, topConfused: confused.slice(0, 5), perClass };
    }
  }

  if (f.kind === "list") {
    let tp = 0, fp = 0, fn = 0, exact = 0, n = 0;
    for (const r of rows) {
      if (r[hk] === "" && r[mk] === "") continue;
      n++;
      const hand = new Set(toList(r[hk]));
      const model = new Set(toList(r[mk]));
      for (const v of model) (hand.has(v) ? tp++ : fp++);
      for (const v of hand) if (!model.has(v)) fn++;
      if (hand.size === model.size && [...hand].every((v) => model.has(v))) exact++;
    }
    const p = tp + fp === 0 ? 0 : tp / (tp + fp);
    const r = tp + fn === 0 ? 0 : tp / (tp + fn);
    result.n = n;
    result.precision = p;
    result.recall = r;
    result.f1 = p + r === 0 ? 0 : (2 * p * r) / (p + r);
    result.exactSet = n ? exact / n : NaN;
    result.agreement = result.f1;
  }

  if (f.kind === "time" || f.kind === "score") {
    const pairs = rows
      .map((r) => [toNum(r[hk]), toNum(r[mk])])
      .filter(([h, m]) => Number.isFinite(h) && Number.isFinite(m));
    const diffs = pairs.map(([h, m]) => Math.abs(h - m));
    const tol = f.kind === "time" ? opts.tol : 0;
    result.n = pairs.length;
    result.mae = mean(diffs);
    result.maxAbs = diffs.length ? Math.max(...diffs) : NaN;
    result.withinTol = diffs.length ? diffs.filter((d) => d <= tol).length / diffs.length : NaN;
    if (f.kind === "score") result.rho = spearman(pairs.map(([h]) => h), pairs.map(([, m]) => m));
    result.agreement = f.kind === "time" ? result.withinTol : 1 - clamp01(result.mae / 100);
  }

  report.fields[f.key] = result;
}

// top-1 per clip, needs clip_id + scores
if (headers.includes("clip_id")) {
  const groups = new Map();
  for (const r of rows) {
    const hs = toNum(r.hand_score);
    const ms = toNum(r.model_score);
    if (!Number.isFinite(hs) || !Number.isFinite(ms)) continue;
    const k = r.clip_id || "_";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ shot: r.shot_id, hs, ms });
  }
  let hit = 0;
  const misses = [];
  for (const [clip, list] of groups) {
    const bestHand = list.reduce((a, b) => (b.hs > a.hs ? b : a));
    const bestModel = list.reduce((a, b) => (b.ms > a.ms ? b : a));
    if (bestHand.shot === bestModel.shot) hit++;
    else misses.push({ clip, hand: bestHand.shot, model: bestModel.shot });
  }
  const n = groups.size;
  report.top1 = { clips: n, agreement: n ? hit / n : NaN, misses };
  if (n && report.top1.agreement < 0.8) report.failures.push("top1 < 0.80");
}

// ---------- gates ----------
function gateCheck(key, r) {
  const f = FIELDS.find((x) => x.key === key);
  const fails = [];
  if (f.kind === "categorical") {
    if (!(r.agreement >= f.gate)) fails.push(`exact ${fmt(r.agreement)} < ${f.gate}`);
    if (Number.isFinite(r.kappa) && !(r.kappa >= f.kappaGate)) fails.push(`kappa ${fmt(r.kappa)} < ${f.kappaGate}`);
  }
  if (f.kind === "list" && !(r.f1 >= f.gate)) fails.push(`F1 ${fmt(r.f1)} < ${f.gate}`);
  if (f.kind === "time") {
    if (!(r.withinTol >= f.gate)) fails.push(`within ±${opts.tol}s ${pct(r.withinTol)} < ${pct(f.gate)}`);
    if (!(r.mae <= f.maeGate)) fails.push(`MAE ${fmt(r.mae, 2)}s > ${f.maeGate}s`);
  }
  if (f.kind === "score") {
    if (!(r.mae <= f.maeGate)) fails.push(`MAE ${fmt(r.mae, 2)} > ${f.maeGate}`);
    if (Number.isFinite(r.rho) && !(r.rho >= f.rhoGate)) fails.push(`rho ${fmt(r.rho)} < ${f.rhoGate}`);
  }
  return fails;
}

// ---------- print ----------
const out = [];
const line = (s = "") => out.push(s);
const pad = (s, n) => String(s).padEnd(n);

const tableRows = [];
for (const [key, r] of Object.entries(report.fields)) {
  const f = FIELDS.find((x) => x.key === key);
  let scoreText;
  let gateText;
  if (f.kind === "categorical") {
    scoreText = `${fmt(r.agreement)} exact, kappa ${fmt(r.kappa)}${r.nCertain < r.n ? `, abstain-free ${fmt(r.agreementCertain)} (n=${r.nCertain})` : ""}`;
    gateText = `${f.gate} / k${f.kappaGate}`;
  } else if (f.kind === "list") {
    scoreText = `F1 ${fmt(r.f1)} (P ${fmt(r.precision)} R ${fmt(r.recall)}), exact ${pct(r.exactSet)}`;
    gateText = `F1 ${f.gate}`;
  } else if (f.kind === "time") {
    scoreText = `within ±${opts.tol}s ${pct(r.withinTol)}, MAE ${fmt(r.mae, 2)}s, max ${fmt(r.maxAbs, 2)}s`;
    gateText = `${pct(f.gate)}/${f.maeGate}s`;
  } else {
    scoreText = `MAE ${fmt(r.mae, 2)}, rho ${fmt(r.rho)}, max ${fmt(r.maxAbs, 1)}`;
    gateText = `${f.maeGate} / r${f.rhoGate}`;
  }
  const fails = gateCheck(key, r);
  if (fails.length) report.failures.push(`${key}: ${fails.join("; ")}`);
  tableRows.push([key, r.kind, String(r.n), scoreText, gateText, fails.length ? "FAIL" : "PASS"]);
}

const cw = [
  Math.max(5, ...tableRows.map((r) => r[0].length)) + 2,
  Math.max(4, ...tableRows.map((r) => r[1].length)) + 2,
  5,
  Math.max(5, ...tableRows.map((r) => r[3].length)) + 2,
  Math.max(4, ...tableRows.map((r) => r[4].length)) + 2,
];

line("Zeniconic · tag agreement");
line(`input   ${opts.csv}`);
line(`rows    ${rows.length}`);
line(`mode    strict (unknown is a label) + abstain-aware`);
line("");
line(pad("field", cw[0]) + pad("kind", cw[1]) + pad("n", cw[2]) + pad("score", cw[3]) + pad("gate", cw[4]) + "status");
line("-".repeat(cw.reduce((a, b) => a + b, 0) + 6));
for (const r of tableRows) line(pad(r[0], cw[0]) + pad(r[1], cw[1]) + pad(r[2], cw[2]) + pad(r[3], cw[3]) + pad(r[4], cw[4]) + r[5]);

if (report.confusion) {
  const { labels, matrix, topConfused, perClass } = report.confusion;
  line("");
  line("room confusion (rows = hand, columns = model, row-normalised)");
  const w = 10;
  line(`${pad("", w)}${labels.map((l) => pad(l, w)).join("")}`);
  for (const h of labels) {
    const total = labels.reduce((s, m) => s + matrix[h][m], 0) || 1;
    const cells = labels.map((m) => pad(matrix[h][m] ? `${((matrix[h][m] / total) * 100).toFixed(0)}%` : ".", w));
    line(`${pad(h, w)}${cells.join("")}`);
  }
  line("");
  line("per class".padEnd(12) + ["support", "precision", "recall", "f1"].map((s) => pad(s, 11)).join(""));
  for (const l of labels) {
    const c = perClass[l];
    line(pad(l, 12) + [c.support, fmt(c.precision, 2), fmt(c.recall, 2), fmt(c.f1, 2)].map((s) => pad(s, 11)).join(""));
  }
  if (topConfused.length) {
    line("");
    line("most confused pairs");
    for (const c of topConfused) line(`  hand=${pad(c.hand, 10)} model=${pad(c.model, 10)} ${c.n} rows (${pct(c.share)})`);
  }
}

if (report.top1) {
  line("");
  line(`top-1 per clip  ${pct(report.top1.agreement)} of ${report.top1.clips} clips`);
  for (const m of report.top1.misses.slice(0, 5)) line(`  miss ${pad(m.clip, 12)} hand=${pad(m.hand, 22)} model=${m.model}`);
}

line("");
if (report.failures.length) {
  line(`FAIL — ${report.failures.length} gate(s) missed`);
  for (const f of report.failures) line(`  ${f}`);
} else {
  line("PASS — all gates met");
}

process.stdout.write(out.join("\n") + "\n");

if (opts.json) {
  writeFileSync(opts.json, JSON.stringify({ ...report, passed: report.failures.length === 0 }, null, 2));
}

if (opts.gate && report.failures.length) process.exit(1);
