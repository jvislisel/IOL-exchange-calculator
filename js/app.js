/*
 * app.js — UI wiring for the IOL exchange calculator.
 * Pure presentation layer; all math lives in holladay1.js / mr-biometry.js.
 */
import { RANGES } from "./holladay1.js";
import {
  newIolPowerForTarget,
  predictedRefractionForNewPower,
  powerTable,
  sphericalEquivalent,
  nearestStep,
  manualPowerForTarget,
  manualPredictedRefraction,
  manualPowerTable,
} from "./mr-biometry.js";

const $ = (id) => document.getElementById(id);
const els = {
  form: $("calc-form"),
  surgeon: $("surgeon"), patient: $("patient"), patientId: $("patient-id"),
  al: $("al"), k1: $("k1"), k2: $("k2"), kDerived: $("k-derived"),
  origPower: $("orig-power"), origA: $("orig-a"), newA: $("new-a"),
  mrSph: $("mr-sph"), mrCyl: $("mr-cyl"), mrSe: $("mr-se"),
  mrSphWrap: $("mr-sph-wrap"), mrCylWrap: $("mr-cyl-wrap"),
  modeSphCyl: $("mode-sphcyl"), modeSe: $("mode-se"),
  methodAuto: $("method-auto"), methodManual: $("method-manual"), methodHint: $("method-hint"),
  mCurPower: $("m-cur-power"), mB: $("m-b"),
  mP1: $("m-p1"), mC1: $("m-c1"), mP2: $("m-p2"), mC2: $("m-c2"),
  target: $("target"), targetTag: $("target-tag"),
  resultBody: $("result-body"),
  printSheet: $("print-sheet"),
  resetBtn: $("reset-btn"),
};

let seMode = "sphcyl"; // or "se"
let calcMethod = "auto"; // or "manual"
let focusedEl = null; // the input currently being edited; its flags are deferred until blur

const METHOD_HINTS = {
  auto: "Enter the biometry and A-constants; the tool computes the Holladay&nbsp;1 predictions and the recommended power. Convenient, and independently validated to better than 0.01&nbsp;D.",
  manual: "Enter the Holladay&nbsp;1 predicted refractions from your biometry printout. The tool does only the a&nbsp;&minus;&nbsp;b&nbsp;+&nbsp;c arithmetic, exactly matching the authors' spreadsheet with no reliance on a reimplemented Holladay&nbsp;1.",
};

// ---- helpers ----------------------------------------------------------------

/**
 * Parse a numeric field. Returns {value, ok, empty}.
 * A partially-typed number that is not yet parseable but is a valid prefix of one
 * (a lone sign or decimal point: "", "+", "-", ".", "+.", "-.") is treated as
 * empty/incomplete, so no "check your input" flag appears mid-typing.
 */
function num(el) {
  const raw = (el.value || "").trim().replace(",", ".");
  if (raw === "" || /^[+-]?\.?$/.test(raw)) return { value: null, ok: false, empty: true };
  const v = Number(raw);
  return { value: v, ok: Number.isFinite(v), empty: false };
}

/** Format a signed value to fixed 2 dp with an explicit + sign for positives. */
function signed(v, dp = 2) {
  const s = v.toFixed(dp);
  return v > 0 ? `+${s}` : s;
}

function rangeError(field, value) {
  const r = RANGES[field];
  if (!r) return null;
  if (value < r.min || value > r.max) {
    return `${r.label} should be between ${r.min} and ${r.max}${r.unit ? " " + r.unit : ""}.`;
  }
  return null;
}

// Typical (expected) clinical ranges. Values inside the hard RANGES limits but
// outside these are accepted but flagged for the user to double-check. These are
// UI advisories only, not part of the math engine.
const TYPICAL = {
  axialLength: { min: 20, max: 30 },
  meanK: { min: 34, max: 50 },
  aConstant: { min: 115, max: 122 },
  iolPower: { min: 0, max: 34 },
  targetRefraction: { min: -3.0, max: 1.0 },
  sphere: { min: -8, max: 8 },
  cylinder: { min: -6, max: 6 },
  manifestSE: { min: -8, max: 8 },
};

function typicalWarn(field, value) {
  const t = TYPICAL[field];
  if (!t) return null;
  return value < t.min || value > t.max ? "Outside the typical range — please verify" : null;
}

function setInvalid(el, isInvalid) {
  el.classList.toggle("invalid", isInvalid);
}

/**
 * Flag a field as invalid, deferring the visual flag and message while the field
 * is being edited (so no flag flashes mid-typing). A deferred error still blocks
 * the result (state.pending) so a bad in-progress value never produces output.
 */
function markInvalid(el, msg, errors, state) {
  if (el === focusedEl) { state.pending = true; return; }
  setInvalid(el, true);
  if (msg) errors.push(msg);
}

/** Show a typical-range warning, deferred while the field is being edited. */
function markWarn(el, msg, label, warnings) {
  if (el === focusedEl) return;
  setFieldWarn(el, msg);
  warnings.push(label);
}

/** Show or clear an inline "verify this value" warning under a field. */
function setFieldWarn(el, msg) {
  const field = el.closest(".field");
  el.classList.toggle("warn", !!msg);
  if (!field) return;
  let w = field.querySelector(".field-warn");
  if (msg) {
    if (!w) {
      w = document.createElement("div");
      w.className = "field-warn";
      field.appendChild(w);
    }
    w.innerHTML = `<span class="warn-ico" aria-hidden="true">!</span><span>${escapeHtml(msg)}</span>`;
  } else if (w) {
    w.remove();
  }
}

// ---- read + validate inputs -------------------------------------------------

/**
 * Gather inputs into a structured object with per-field validation.
 * Returns { ok, errors:[], eye, originalIol, newIol, measuredSE, target }.
 */
const ALL_INPUT_FIELDS = () => [
  els.al, els.k1, els.k2, els.origPower, els.origA, els.newA,
  els.mrSph, els.mrCyl, els.mrSe, els.target,
  els.mCurPower, els.mB, els.mP1, els.mC1, els.mP2, els.mC2,
];

const rangeUnit = (field) => (RANGES[field].unit ? " " + RANGES[field].unit : "");

/** Shared manifest-refraction parsing -> spherical equivalent (a). */
function parseMR(errors, warnings, state) {
  let measuredSE = null, seOk = false;
  if (seMode === "se") {
    const se = num(els.mrSe);
    if (!se.empty) {
      measuredSE = se.value; seOk = se.ok;
      if (!se.ok) markInvalid(els.mrSe, "Spherical equivalent must be a number.", errors, state);
      else checkField(se, els.mrSe, "manifestSE", "Spherical equivalent", errors, warnings, state);
    }
  } else {
    const sph = num(els.mrSph), cyl = num(els.mrCyl);
    if (!sph.empty || !cyl.empty) {
      if (!sph.ok && !sph.empty) markInvalid(els.mrSph, "Sphere must be a number.", errors, state);
      if (!cyl.ok && !cyl.empty) markInvalid(els.mrCyl, "Cylinder must be a number.", errors, state);
      if (!sph.empty && sph.ok && (cyl.empty || cyl.ok)) {
        measuredSE = sphericalEquivalent(sph.value, cyl.empty ? 0 : cyl.value);
        seOk = true;
      }
      // Range / typical-range checks on the values that are present.
      checkField(sph, els.mrSph, "sphere", "Sphere", errors, warnings, state);
      checkField(cyl, els.mrCyl, "cylinder", "Cylinder", errors, warnings, state);
    }
    els.mrSe.value = measuredSE == null ? "" : signed(measuredSE);
  }
  return { measuredSE, seOk };
}

/** Check one numeric field for hard-range errors and typical-range warnings. */
function checkField(f, el, field, label, errors, warnings, state) {
  if (f.empty || !f.ok) return;
  const err = rangeError(field, f.value);
  if (err) { markInvalid(el, err, errors, state); return; }
  const w = typicalWarn(field, f.value);
  if (w) markWarn(el, w, `${label} ${f.value}${rangeUnit(field)}`, warnings);
}

function readInputs() {
  const errors = [];
  const warnings = [];
  const state = { pending: false }; // a deferred (focused-field) error is pending
  ALL_INPUT_FIELDS().forEach((e) => { setInvalid(e, false); setFieldWarn(e, null); });

  const { measuredSE, seOk } = parseMR(errors, warnings, state);
  const tg = num(els.target);
  const base = { errors, warnings, state, method: calcMethod, measuredSE, target: tg.ok ? tg.value : null };

  if (calcMethod === "auto") return readAuto(base, measuredSE, seOk, tg);
  return readManual(base, measuredSE, seOk, tg);
}

function readAuto(base, measuredSE, seOk, tg) {
  const { errors, warnings, state } = base;
  const al = num(els.al), k1 = num(els.k1), k2 = num(els.k2);
  const op = num(els.origPower), oa = num(els.origA), na = num(els.newA);

  const required = [
    [al, els.al, "Axial length"], [k1, els.k1, "Keratometry K1"], [k2, els.k2, "Keratometry K2"],
    [op, els.origPower, "Original IOL power"], [oa, els.origA, "Original A-constant"],
    [na, els.newA, "New IOL A-constant"], [tg, els.target, "Target refraction"],
  ];
  const anyStarted = [al, k1, k2, op, oa, na].some((f) => !f.empty) || seOk;
  let allPresent = measuredSE !== null;
  for (const [f, el, label] of required) {
    if (f.empty) { allPresent = false; continue; }
    if (!f.ok) markInvalid(el, `${label} must be a number.`, errors, state);
  }

  checkField(al, els.al, "axialLength", "Axial length", errors, warnings, state);
  checkField(op, els.origPower, "iolPower", "Original IOL power", errors, warnings, state);
  checkField(oa, els.origA, "aConstant", "Original A-constant", errors, warnings, state);
  checkField(na, els.newA, "aConstant", "New IOL A-constant", errors, warnings, state);
  checkField(tg, els.target, "targetRefraction", "Target refraction", errors, warnings, state);
  for (const [f, el, lbl] of [[k1, els.k1, "K1"], [k2, els.k2, "K2"]]) {
    if (f.empty || !f.ok) continue;
    const err = rangeError("meanK", f.value);
    if (err) { markInvalid(el, err, errors, state); continue; }
    const w = typicalWarn("meanK", f.value);
    if (w) markWarn(el, w, `Keratometry ${lbl} ${f.value} D`, warnings);
  }

  const meanK = k1.ok && k2.ok ? (k1.value + k2.value) / 2 : null;
  const ok = anyStarted && allPresent && errors.length === 0 && !state.pending;
  return {
    ...base, ok, anyStarted, errors: [...new Set(errors)], meanK,
    eye: ok ? { axialLength: al.value, k1: k1.value, k2: k2.value } : null,
    originalIol: ok ? { power: op.value, aConstant: oa.value } : null,
    newIol: ok ? { aConstant: na.value } : null,
    raw: { al, k1, k2, op, oa, na, tg },
  };
}

function readManual(base, measuredSE, seOk, tg) {
  const { errors, warnings, state } = base;
  const cur = num(els.mCurPower); // optional (for the sheet)
  const b = num(els.mB), p1 = num(els.mP1), c1 = num(els.mC1), p2 = num(els.mP2), c2 = num(els.mC2);

  const required = [
    [b, els.mB, "Original IOL predicted SE"],
    [p1, els.mP1, "IOL power 1"], [c1, els.mC1, "Predicted SE 1"],
    [p2, els.mP2, "IOL power 2"], [c2, els.mC2, "Predicted SE 2"],
    [tg, els.target, "Target refraction"],
  ];
  const anyStarted = [cur, b, p1, c1, p2, c2].some((f) => !f.empty) || seOk;
  let allPresent = measuredSE !== null;
  for (const [f, el, label] of required) {
    if (f.empty) { allPresent = false; continue; }
    if (!f.ok) markInvalid(el, `${label} must be a number.`, errors, state);
  }

  // Ranges/warnings: powers use iolPower bounds, predictions & target use refraction bounds.
  checkField(cur, els.mCurPower, "iolPower", "Original IOL power", errors, warnings, state);
  checkField(p1, els.mP1, "iolPower", "IOL power 1", errors, warnings, state);
  checkField(p2, els.mP2, "iolPower", "IOL power 2", errors, warnings, state);
  checkField(b, els.mB, "manifestSE", "Original IOL predicted SE", errors, warnings, state);
  checkField(c1, els.mC1, "manifestSE", "Predicted SE 1", errors, warnings, state);
  checkField(c2, els.mC2, "manifestSE", "Predicted SE 2", errors, warnings, state);
  checkField(tg, els.target, "targetRefraction", "Target refraction", errors, warnings, state);

  // Two IOL powers must differ (slope) and are expected 0.5 D apart.
  if (p1.ok && p2.ok) {
    if (p1.value === p2.value) {
      markInvalid(els.mP2, "The two IOL powers must be different.", errors, state);
    } else if (Math.abs(Math.abs(p1.value - p2.value) - 0.5) > 1e-9) {
      markWarn(els.mP2, "Expected 0.5 D apart — please verify", "The two IOL powers are not 0.5 D apart", warnings);
    }
  }

  const ok = anyStarted && allPresent && errors.length === 0 && !state.pending;
  return {
    ...base, ok, anyStarted, errors: [...new Set(errors)], meanK: null,
    manual: ok ? { a: measuredSE, b: b.value, p1: p1.value, c1: c1.value, p2: p2.value, c2: c2.value, curPower: cur.ok ? cur.value : null } : null,
    raw: { cur, b, p1, c1, p2, c2, tg },
  };
}

/** Compute the unified result (both methods produce the same shape). */
function computeResult(data) {
  if (data.method === "auto") {
    const { eye, originalIol, newIol, measuredSE, target } = data;
    const { power, pe } = newIolPowerForTarget(eye, originalIol, measuredSE, newIol, target);
    const nearest = nearestStep(power, 0.5);
    const atNearestR = predictedRefractionForNewPower(eye, originalIol, measuredSE, newIol, nearest).R;
    const rows = powerTable(eye, originalIol, measuredSE, newIol, power, 0.5, 1.5);
    return { power, pe, nearest, atNearestR, rows };
  }
  const { a, b, p1, c1, p2, c2 } = data.manual;
  const { power, pe } = manualPowerForTarget(a, b, data.target, p1, c1, p2, c2);
  const nearest = nearestStep(power, 0.5);
  const atNearestR = manualPredictedRefraction(a, b, nearest, p1, c1, p2, c2);
  const rows = manualPowerTable(a, b, p1, c1, p2, c2, power, 0.5, 1.5);
  return { power, pe, nearest, atNearestR, rows };
}

// ---- rendering --------------------------------------------------------------

function refractionClass(v) {
  if (v < -0.02) return "myopic";
  if (v > 0.02) return "hyperopic";
  return "";
}

function renderEmpty() {
  const msg =
    calcMethod === "auto"
      ? "Enter the manifest refraction, biometry, and the original and new IOLs to see the recommended power."
      : "Enter the manifest refraction and the Holladay 1 predictions from your printout to see the recommended power.";
  els.resultBody.innerHTML = `<div class="result-empty">${msg}</div>`;
}

function renderErrors(errors) {
  els.resultBody.innerHTML =
    '<div class="result-empty">Complete the remaining fields to calculate.</div>' +
    (errors.length
      ? `<div class="result-blocked"><strong>Check your input:</strong><br>${errors
          .map((e) => escapeHtml(e))
          .join("<br>")}</div>`
      : "");
}

function renderResult(data) {
  const res = computeResult(data);
  const { power, pe, nearest, atNearestR, rows } = res;

  const tableRows = rows
    .map((r) => {
      const isIdeal = Math.abs(r.power - nearest) < 1e-9;
      const cls = refractionClass(r.R);
      return `<tr class="${isIdeal ? "ideal" : ""}">
        <td>${r.power.toFixed(2)} D</td>
        <td class="refr ${cls}">${signed(r.R)} D</td>
      </tr>`;
    })
    .join("");

  const warnHtml =
    data.warnings && data.warnings.length
      ? `<div class="result-warn"><span class="warn-ico" aria-hidden="true">!</span><span>Unusual values, please double-check: ${data.warnings
          .map(escapeHtml)
          .join("; ")}.</span></div>`
      : "";

  els.resultBody.innerHTML = `
    ${warnHtml}
    <div class="headline">
      <div class="num">${nearest.toFixed(1)}<span class="d">D</span></div>
      <div class="exact">
        nearest 0.5 D step<br>
        exact solution <b>${signed(power).replace("+", "")} D</b><br>
        predicts <b>${signed(atNearestR)} D</b> at ${nearest.toFixed(1)} D
      </div>
    </div>
    <div class="metrics">
      <div class="metric">
        <div class="k">Observed error, <span class="nowrap">original IOL</span></div>
        <div class="v">${signed(pe)} D</div>
      </div>
      <div class="metric">
        <div class="k">Target refraction</div>
        <div class="v">${signed(data.target)} D</div>
      </div>
    </div>
    <div class="ptable">
      <table>
        <caption>Predicted outcome by available power</caption>
        <thead><tr><th>New IOL power</th><th>Predicted SE</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div class="result-actions no-print">
      <button class="btn" type="button" id="print-btn">Print planning sheet</button>
    </div>`;

  const printBtn = $("print-btn");
  if (printBtn)
    printBtn.addEventListener("click", () => {
      buildPrintSheet(data, res);
      window.print();
    });
}

/** Build the dedicated one-page planning sheet from the current result. */
function buildPrintSheet(data, res) {
  const { measuredSE, target } = data;
  const { power, nearest, atNearestR, pe, rows } = res;
  const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const caseVal = (el) => escapeHtml((el.value || "").trim()) || "&nbsp;";

  const tableRows = rows
    .map((r) => {
      const isIdeal = Math.abs(r.power - nearest) < 1e-9;
      return `<tr class="${isIdeal ? "ideal" : ""}"><td>${r.power.toFixed(2)} D</td><td class="refr ${refractionClass(r.R)}">${signed(r.R)} D</td></tr>`;
    })
    .join("");

  // Bold the target refraction unless it is plano, so it stands out.
  const targetCell = target !== 0 ? `<strong>${signed(target)} D</strong>` : `${signed(target)} D`;

  // Method-specific input rows.
  let inputRows;
  if (data.method === "auto") {
    const { eye, originalIol, newIol, meanK } = data;
    inputRows = `
      <tr><td>Method</td><td>Computed from biometry</td></tr>
      <tr><td>Axial length</td><td>${eye.axialLength.toFixed(2)} mm</td></tr>
      <tr><td>Keratometry K1 / K2</td><td>${eye.k1.toFixed(2)} / ${eye.k2.toFixed(2)} D</td></tr>
      <tr><td>Mean K</td><td>${meanK.toFixed(2)} D</td></tr>
      <tr><td>Original IOL power</td><td>${originalIol.power.toFixed(2)} D</td></tr>
      <tr><td>Original A-constant</td><td>${originalIol.aConstant.toFixed(2)}</td></tr>
      <tr><td>MR with original IOL (SE)</td><td>${signed(measuredSE)} D</td></tr>
      <tr><td>New IOL A-constant</td><td>${newIol.aConstant.toFixed(2)}</td></tr>
      <tr><td>Target refraction</td><td>${targetCell}</td></tr>`;
  } else {
    const m = data.manual;
    inputRows = `
      <tr><td>Method</td><td>Holladay 1 from printout</td></tr>
      ${m.curPower != null ? `<tr><td>Original IOL power</td><td>${m.curPower.toFixed(2)} D</td></tr>` : ""}
      <tr><td>MR with original IOL (SE)</td><td>${signed(measuredSE)} D</td></tr>
      <tr><td>Original IOL predicted SE (b)</td><td>${signed(m.b)} D</td></tr>
      <tr><td>New IOL ${m.p1.toFixed(2)} D predicted SE (c)</td><td>${signed(m.c1)} D</td></tr>
      <tr><td>New IOL ${m.p2.toFixed(2)} D predicted SE (c)</td><td>${signed(m.c2)} D</td></tr>
      <tr><td>Target refraction</td><td>${targetCell}</td></tr>`;
  }

  els.printSheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-head">
        <div>
          <p class="title">IOL Exchange Power Calculator</p>
          <p class="subtitle">MR Biometry Formula &middot; Planning Sheet</p>
        </div>
        <div class="date">${today}</div>
      </div>

      <div class="sheet-case">
        <div><div class="c-k">Surgeon</div><div class="c-v">${caseVal(els.surgeon)}</div></div>
        <div><div class="c-k">Patient</div><div class="c-v">${caseVal(els.patient)}</div></div>
        <div><div class="c-k">Identifier</div><div class="c-v">${caseVal(els.patientId)}</div></div>
      </div>

      <div class="sheet-block">
        <h3>Recommended new IOL power</h3>
        <div class="sheet-result">
          <div class="rec-k">Nearest available power (0.5 D steps)</div>
          <div class="rec-v">${nearest.toFixed(1)} D</div>
          <div class="rec-sub">Exact solution ${signed(power).replace("+", "")} D &middot; predicts ${signed(atNearestR)} D at ${nearest.toFixed(1)} D<br>Observed error of original IOL (a &minus; b): ${signed(pe)} D &middot; target ${signed(target)} D</div>
        </div>
      </div>

      <div class="sheet-cols">
        <div class="sheet-block">
          <h3>Inputs</h3>
          <table class="sheet-table sheet-io">
            <thead><tr><th>Measurement</th><th>Value</th></tr></thead>
            <tbody>${inputRows}</tbody>
          </table>
        </div>
        <div class="sheet-block">
          <h3>Predicted outcome by available power</h3>
          <table class="sheet-table">
            <thead><tr><th>New IOL power</th><th>Predicted SE</th></tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>

      <div class="sheet-foot">
        <div class="cite-line">Cheng X, Mendes F, Fortingo K, et al. A New Intraocular Lens Power Calculation Formula for Eyes Undergoing Lens Exchange. Ophthalmology. 2026;133:700&ndash;708. doi:10.1016/j.ophtha.2026.01.017</div>
        Independent implementation, not affiliated with or endorsed by the authors. For educational and informational use only; not a medical device. All values and results must be independently verified by the treating surgeon before any surgical decision. Provided without warranty; no liability is accepted for outcomes.
      </div>
    </div>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- derived-value chips ----------------------------------------------------

function updateDerived(data) {
  const { meanK } = data;
  els.kDerived.textContent = meanK != null ? `Mean K = ${meanK.toFixed(2)} D` : "";
}

/** Color-coded flag behind the Target refraction label. */
function updateTargetTag(data) {
  const tag = els.targetTag;
  const v = data.target;
  if (v == null) { tag.className = "target-tag"; tag.textContent = ""; return; }
  const [cls, txt] = v < 0 ? ["myopic", "myopic"] : v > 0 ? ["hyperopic", "hyperopic"] : ["plano", "plano"];
  tag.className = `target-tag show ${cls}`;
  tag.textContent = txt;
}

// These always-positive fields are formatted to two decimals without a sign.
const UNSIGNED_FIELDS = new Set(["al", "k1", "k2", "orig-a", "new-a"]);

/** On blur, standardize a numeric field to two decimals (signed unless magnitude). */
function formatNumericField(el) {
  if (el.readOnly || el.disabled || el.getAttribute("inputmode") !== "decimal") return;
  const parsed = num(el);
  if (parsed.ok) el.value = UNSIGNED_FIELDS.has(el.id) ? parsed.value.toFixed(2) : signed(parsed.value);
}

function updateBarrettMap(data) {
  const { raw, measuredSE } = data;
  const set = (key, text) => {
    const el = document.querySelector(`[data-map="${key}"]`);
    if (el) el.textContent = text;
  };
  const v = (f, unit = "") => (f && !f.empty && f.ok ? `${f.value}${unit}` : "—");
  set("mr", measuredSE != null ? `${signed(measuredSE)} D (SE)` : "—");
  set("target", raw.tg.ok ? `${signed(raw.tg.value)} D` : "—");
  if (data.method === "auto") {
    set("al", v(raw.al, " mm"));
    set("k", raw.k1.ok && raw.k2.ok ? `${raw.k1.value} / ${raw.k2.value} D` : "—");
    set("origp", v(raw.op, " D"));
    set("origa", v(raw.oa));
    set("newa", v(raw.na));
  } else {
    // Manual mode does not collect biometry / A-constants; the surgeon has them
    // on the same printout they used for the Holladay predictions.
    set("al", "from printout");
    set("k", "from printout");
    set("origp", v(raw.cur, " D"));
    set("origa", "from printout");
    set("newa", "from printout");
  }
}

// ---- main recompute ---------------------------------------------------------

function recompute() {
  const data = readInputs();
  updateDerived(data);
  updateTargetTag(data);
  updateBarrettMap(data);

  if (!data.anyStarted) {
    renderEmpty();
    return;
  }
  if (data.ok) {
    try {
      renderResult(data);
    } catch (err) {
      els.resultBody.innerHTML = `<div class="result-blocked">Unable to calculate with these values. ${escapeHtml(String(err.message || err))}</div>`;
    }
  } else {
    renderErrors(data.errors);
  }
}

// ---- refraction entry mode toggle ------------------------------------------

function setSeMode(mode) {
  seMode = mode;
  const sphcyl = mode === "sphcyl";
  // Sphere/cylinder stay visible but are disabled (grayed) in SE-direct mode, so
  // it is obvious they do not need to be filled in.
  els.mrSph.disabled = !sphcyl;
  els.mrCyl.disabled = !sphcyl;
  els.mrSphWrap.classList.toggle("disabled", !sphcyl);
  els.mrCylWrap.classList.toggle("disabled", !sphcyl);
  // SE field is read-only (auto-filled) in sphere/cylinder mode, editable in SE mode.
  els.mrSe.readOnly = sphcyl;
  els.form.classList.toggle("mode-sphcyl", sphcyl);
  els.modeSphCyl.setAttribute("aria-pressed", String(sphcyl));
  els.modeSe.setAttribute("aria-pressed", String(!sphcyl));
  recompute();
}

// ---- calculation-method toggle ---------------------------------------------

function setCalcMethod(method) {
  calcMethod = method;
  const auto = method === "auto";
  els.form.classList.toggle("is-auto", auto);
  els.form.classList.toggle("is-manual", !auto);
  els.methodAuto.setAttribute("aria-pressed", String(auto));
  els.methodManual.setAttribute("aria-pressed", String(!auto));
  els.methodHint.innerHTML = METHOD_HINTS[method];
  recompute();
}

/** Clear all field values, keeping the surgeon's chosen entry modes. */
function resetAll() {
  els.form.reset();
  els.mrSe.value = "";
  setSeMode(seMode); // re-apply current modes (form.reset clears values only) and recompute
}

// ---- wire up ----------------------------------------------------------------

// ---- tabbed sections -------------------------------------------------------

const TABS = ["calc", "how", "compare"];

/** Show one tab's panel; entered data persists (panels are only hidden). */
function setTab(name) {
  for (const t of TABS) {
    const active = t === name;
    document.getElementById(`tabbtn-${t}`).setAttribute("aria-selected", String(active));
    document.getElementById(`tab-${t}`).hidden = !active;
  }
  if (name === "compare") recompute(); // ensure the Barrett map reflects current inputs
  window.scrollTo(0, 0);
}

// ---- wire up ----------------------------------------------------------------

els.form.addEventListener("input", recompute);
els.form.addEventListener("focusin", (e) => {
  if (e.target && e.target.matches("input.input")) { focusedEl = e.target; recompute(); }
});
els.form.addEventListener("focusout", (e) => {
  if (e.target && e.target.matches("input.input")) {
    formatNumericField(e.target);
    focusedEl = null;
    recompute();
  }
});
els.modeSphCyl.addEventListener("click", () => setSeMode("sphcyl"));
els.modeSe.addEventListener("click", () => setSeMode("se"));
els.methodAuto.addEventListener("click", () => setCalcMethod("auto"));
els.methodManual.addEventListener("click", () => setCalcMethod("manual"));
els.resetBtn.addEventListener("click", resetAll);

for (const t of TABS) document.getElementById(`tabbtn-${t}`).addEventListener("click", () => setTab(t));
document.querySelectorAll("[data-tab-link]").forEach((el) =>
  el.addEventListener("click", () => setTab(el.getAttribute("data-tab-link")))
);

setCalcMethod("auto"); // initialize calculation method
setSeMode("sphcyl"); // initialize refraction-entry mode and first render
