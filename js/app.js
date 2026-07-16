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
} from "./mr-biometry.js";

const $ = (id) => document.getElementById(id);
const els = {
  form: $("calc-form"),
  surgeon: $("surgeon"), patient: $("patient"), patientId: $("patient-id"),
  al: $("al"), k1: $("k1"), k2: $("k2"), kDerived: $("k-derived"),
  origPower: $("orig-power"), origA: $("orig-a"),
  mrSph: $("mr-sph"), mrCyl: $("mr-cyl"), mrSe: $("mr-se"),
  mrSphWrap: $("mr-sph-wrap"), mrCylWrap: $("mr-cyl-wrap"),
  modeSphCyl: $("mode-sphcyl"), modeSe: $("mode-se"),
  newA: $("new-a"), target: $("target"),
  resultBody: $("result-body"),
  printSheet: $("print-sheet"),
  resetBtn: $("reset-btn"),
};

let seMode = "sphcyl"; // or "se"

// ---- helpers ----------------------------------------------------------------

/** Parse a numeric field. Returns {value, ok, empty}. */
function num(el) {
  const raw = (el.value || "").trim();
  if (raw === "") return { value: null, ok: false, empty: true };
  const v = Number(raw.replace(",", "."));
  return { value: v, ok: Number.isFinite(v), empty: false };
}

/** Format a signed refraction / power to fixed 2 dp with an explicit + sign. */
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
  axialLength: { min: 20.5, max: 27.0 },
  meanK: { min: 38, max: 48 },
  aConstant: { min: 115, max: 122 },
  iolPower: { min: 6, max: 34 },
  targetRefraction: { min: -3.0, max: 1.0 },
};

function typicalWarn(field, value) {
  const t = TYPICAL[field];
  if (!t) return null;
  return value < t.min || value > t.max ? "Outside the typical range — please verify" : null;
}

function setInvalid(el, isInvalid) {
  el.classList.toggle("invalid", isInvalid);
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
function readInputs() {
  const errors = [];
  const warnings = [];
  const allFields = [els.al, els.k1, els.k2, els.origPower, els.origA, els.mrSph, els.mrCyl, els.mrSe, els.newA, els.target];
  allFields.forEach((e) => { setInvalid(e, false); setFieldWarn(e, null); });

  // Axial length
  const al = num(els.al);
  // Keratometry
  const k1 = num(els.k1), k2 = num(els.k2);
  // Original IOL
  const op = num(els.origPower), oa = num(els.origA);
  // New IOL + target
  const na = num(els.newA), tg = num(els.target);

  // Manifest refraction -> SE
  let measuredSE = null, seOk = false;
  if (seMode === "se") {
    const se = num(els.mrSe);
    if (!se.empty) { measuredSE = se.value; seOk = se.ok; if (!se.ok) { errors.push("Spherical equivalent must be a number."); setInvalid(els.mrSe, true); } }
  } else {
    const sph = num(els.mrSph), cyl = num(els.mrCyl);
    if (!sph.empty || !cyl.empty) {
      const sv = sph.empty ? 0 : sph.value;
      const cv = cyl.empty ? 0 : cyl.value;
      if ((!sph.empty && !sph.ok) || (!cyl.empty && !cyl.ok)) {
        errors.push("Sphere and cylinder must be numbers.");
        if (!sph.ok && !sph.empty) setInvalid(els.mrSph, true);
        if (!cyl.ok && !cyl.empty) setInvalid(els.mrCyl, true);
      } else if (sph.empty) {
        errors.push("Enter the sphere of the manifest refraction.");
      } else {
        measuredSE = sphericalEquivalent(sv, cv);
        seOk = true;
      }
    }
    // Reflect the computed SE into the read-only SE field for display.
    els.mrSe.value = measuredSE == null ? "" : signed(measuredSE);
  }

  // Required-field presence (only complain once user has started).
  const required = [
    [al, els.al, "axialLength", "Axial length"],
    [k1, els.k1, "meanK", "Keratometry K1"],
    [k2, els.k2, "meanK", "Keratometry K2"],
    [op, els.origPower, "iolPower", "Original IOL power"],
    [oa, els.origA, "aConstant", "Original A-constant"],
    [na, els.newA, "aConstant", "New IOL A-constant"],
    [tg, els.target, "targetRefraction", "Target refraction"],
  ];

  const anyStarted =
    [al, k1, k2, op, oa, na].some((f) => !f.empty) || seOk;

  let allPresent = true;
  for (const [f, el, , label] of required) {
    if (f.empty) { allPresent = false; continue; }
    if (!f.ok) { errors.push(`${label} must be a number.`); setInvalid(el, true); }
  }
  if (measuredSE === null) allPresent = false;

  // Range checks on present, numeric fields.
  const meanK = k1.ok && k2.ok ? (k1.value + k2.value) / 2 : null;
  const rangeChecks = [
    [al, els.al, "axialLength"],
    [op, els.origPower, "iolPower"],
    [oa, els.origA, "aConstant"],
    [na, els.newA, "aConstant"],
    [tg, els.target, "targetRefraction"],
  ];
  const unit = (field) => (RANGES[field].unit ? " " + RANGES[field].unit : "");
  for (const [f, el, field] of rangeChecks) {
    if (f.empty || !f.ok) continue;
    const err = rangeError(field, f.value);
    if (err) { errors.push(err); setInvalid(el, true); continue; }
    if (typicalWarn(field, f.value)) {
      setFieldWarn(el, typicalWarn(field, f.value));
      warnings.push(`${RANGES[field].label} ${f.value}${unit(field)}`);
    }
  }
  for (const [f, el, lbl] of [[k1, els.k1, "K1"], [k2, els.k2, "K2"]]) {
    if (f.empty || !f.ok) continue;
    const err = rangeError("meanK", f.value);
    if (err) { errors.push(err); setInvalid(el, true); continue; }
    if (typicalWarn("meanK", f.value)) {
      setFieldWarn(el, typicalWarn("meanK", f.value));
      warnings.push(`Keratometry ${lbl} ${f.value} D`);
    }
  }

  const ok = anyStarted && allPresent && errors.length === 0;
  return {
    ok, anyStarted, errors: [...new Set(errors)], warnings,
    meanK,
    eye: ok ? { axialLength: al.value, k1: k1.value, k2: k2.value } : null,
    originalIol: ok ? { power: op.value, aConstant: oa.value } : null,
    newIol: ok ? { aConstant: na.value } : null,
    measuredSE,
    target: tg.ok ? tg.value : null,
    raw: { al, k1, k2, op, oa, na, tg },
  };
}

// ---- rendering --------------------------------------------------------------

function refractionClass(v) {
  if (v < -0.02) return "myopic";
  if (v > 0.02) return "hyperopic";
  return "";
}

function renderEmpty() {
  els.resultBody.innerHTML =
    '<div class="result-empty">Enter the biometry, the original IOL, and the manifest refraction to see the recommended power.</div>';
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
  const { eye, originalIol, newIol, measuredSE, target } = data;
  const { power, pe } = newIolPowerForTarget(eye, originalIol, measuredSE, newIol, target);
  const nearest = nearestStep(power, 0.5);
  const atNearest = predictedRefractionForNewPower(eye, originalIol, measuredSE, newIol, nearest);
  const rows = powerTable(eye, originalIol, measuredSE, newIol, power, 0.5, 1.5);

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
        predicts <b>${signed(atNearest.R)} D</b> at ${nearest.toFixed(1)} D
      </div>
    </div>
    <div class="metrics">
      <div class="metric">
        <div class="k">Observed error, original IOL</div>
        <div class="v">${signed(pe)} D</div>
      </div>
      <div class="metric">
        <div class="k">Target refraction</div>
        <div class="v">${signed(target)} D</div>
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
      buildPrintSheet(data, { power, nearest, atNearest, pe, rows });
      window.print();
    });
}

/** Build the dedicated one-page planning sheet from the current result. */
function buildPrintSheet(data, res) {
  const { eye, originalIol, newIol, measuredSE, target, meanK } = data;
  const { power, nearest, atNearest, pe, rows } = res;
  const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const caseVal = (el) => escapeHtml((el.value || "").trim()) || "&nbsp;";

  const tableRows = rows
    .map((r) => {
      const isIdeal = Math.abs(r.power - nearest) < 1e-9;
      return `<tr class="${isIdeal ? "ideal" : ""}"><td>${r.power.toFixed(2)} D</td><td>${signed(r.R)} D</td></tr>`;
    })
    .join("");

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
          <div class="rec-sub">Exact solution ${signed(power).replace("+", "")} D &middot; predicts ${signed(atNearest.R)} D at ${nearest.toFixed(1)} D<br>Observed error of original IOL (a &minus; b): ${signed(pe)} D &middot; target ${signed(target)} D</div>
        </div>
      </div>

      <div class="sheet-cols">
        <div class="sheet-block">
          <h3>Inputs</h3>
          <table class="sheet-table sheet-io">
            <thead><tr><th>Measurement</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td>Axial length</td><td>${eye.axialLength.toFixed(2)} mm</td></tr>
              <tr><td>Keratometry K1 / K2</td><td>${eye.k1.toFixed(2)} / ${eye.k2.toFixed(2)} D</td></tr>
              <tr><td>Mean K</td><td>${meanK.toFixed(2)} D</td></tr>
              <tr><td>Original IOL power</td><td>${originalIol.power.toFixed(2)} D</td></tr>
              <tr><td>Original A-constant</td><td>${originalIol.aConstant.toFixed(2)}</td></tr>
              <tr><td>MR with original IOL (SE)</td><td>${signed(measuredSE)} D</td></tr>
              <tr><td>New IOL A-constant</td><td>${newIol.aConstant.toFixed(2)}</td></tr>
              <tr><td>Target refraction</td><td>${signed(target)} D</td></tr>
            </tbody>
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

function updateBarrettMap(data) {
  const { raw, meanK, measuredSE } = data;
  const set = (key, text) => {
    const el = document.querySelector(`[data-map="${key}"]`);
    if (el) el.textContent = text;
  };
  const v = (f, unit = "") => (f && !f.empty && f.ok ? `${f.value}${unit}` : "—");
  set("al", v(raw.al, " mm"));
  set("k", raw.k1.ok && raw.k2.ok ? `${raw.k1.value} / ${raw.k2.value} D` : "—");
  set("origp", v(raw.op, " D"));
  set("origa", v(raw.oa));
  set("mr", measuredSE != null ? `${signed(measuredSE)} D (SE)` : "—");
  set("newa", v(raw.na));
  set("target", raw.tg.ok ? `${signed(raw.tg.value)} D` : "—");
}

// ---- main recompute ---------------------------------------------------------

function recompute() {
  const data = readInputs();
  updateDerived(data);
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

/** Clear every field and return to the default sphere/cylinder entry mode. */
function resetAll() {
  els.form.reset();
  els.mrSe.value = "";
  setSeMode("sphcyl");
}

// ---- wire up ----------------------------------------------------------------

els.form.addEventListener("input", recompute);
els.modeSphCyl.addEventListener("click", () => setSeMode("sphcyl"));
els.modeSe.addEventListener("click", () => setSeMode("se"));
els.resetBtn.addEventListener("click", resetAll);

setSeMode("sphcyl"); // initialize refraction-entry mode and first render
