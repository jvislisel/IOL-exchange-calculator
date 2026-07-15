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
  al: $("al"), k1: $("k1"), k2: $("k2"), kDerived: $("k-derived"),
  origPower: $("orig-power"), origA: $("orig-a"),
  mrSph: $("mr-sph"), mrCyl: $("mr-cyl"), mrSe: $("mr-se"),
  seDerived: $("se-derived"), mrSphCyl: $("mr-sphcyl"), mrSeWrap: $("mr-se-wrap"),
  modeSphCyl: $("mode-sphcyl"), modeSe: $("mode-se"),
  newA: $("new-a"), target: $("target"),
  resultBody: $("result-body"),
  barrettLink: $("barrett-link"),
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

function setInvalid(el, isInvalid) {
  el.classList.toggle("invalid", isInvalid);
}

// ---- read + validate inputs -------------------------------------------------

/**
 * Gather inputs into a structured object with per-field validation.
 * Returns { ok, errors:[], eye, originalIol, newIol, measuredSE, target }.
 */
function readInputs() {
  const errors = [];
  const clearInvalid = [els.al, els.k1, els.k2, els.origPower, els.origA, els.mrSph, els.mrCyl, els.mrSe, els.newA, els.target];
  clearInvalid.forEach((e) => setInvalid(e, false));

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
  for (const [f, el, field] of rangeChecks) {
    if (!f.empty && f.ok) {
      const err = rangeError(field, f.value);
      if (err) { errors.push(err); setInvalid(el, true); }
    }
  }
  for (const [f, el] of [[k1, els.k1], [k2, els.k2]]) {
    if (!f.empty && f.ok) {
      const err = rangeError("meanK", f.value);
      if (err) { errors.push(err); setInvalid(el, true); }
    }
  }

  const ok = anyStarted && allPresent && errors.length === 0;
  return {
    ok, anyStarted, errors: [...new Set(errors)],
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

  els.resultBody.innerHTML = `
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
  if (printBtn) printBtn.addEventListener("click", () => window.print());
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- derived-value chips ----------------------------------------------------

function updateDerived(data) {
  const { raw, meanK, measuredSE } = data;
  if (meanK != null) {
    els.kDerived.textContent = `Mean K = ${meanK.toFixed(2)} D`;
  } else {
    els.kDerived.textContent = "";
  }
  if (measuredSE != null && seMode === "sphcyl") {
    els.seDerived.innerHTML = `Spherical equivalent <b>${signed(measuredSE)} D</b>`;
  } else if (seMode === "se") {
    els.seDerived.textContent = "";
  } else {
    els.seDerived.textContent = "";
  }
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
  els.mrSphCyl.hidden = !sphcyl;
  els.mrSeWrap.hidden = sphcyl;
  els.modeSphCyl.setAttribute("aria-pressed", String(sphcyl));
  els.modeSe.setAttribute("aria-pressed", String(!sphcyl));
  recompute();
}

// ---- wire up ----------------------------------------------------------------

document.getElementById("calc-form").addEventListener("input", recompute);
els.target.addEventListener("input", recompute);
els.modeSphCyl.addEventListener("click", () => setSeMode("sphcyl"));
els.modeSe.addEventListener("click", () => setSeMode("se"));

recompute();
