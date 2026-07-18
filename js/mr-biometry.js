/*
 * mr-biometry.js — MR Biometry formula for IOL exchange.
 *
 * Reference: Cheng X, Mendes F, Fortingo K, Jaber JM, Chen AJ, Weikert MP,
 * Wang L, Koch DD. "A New Intraocular Lens Power Calculation Formula for Eyes
 * Undergoing Lens Exchange." Ophthalmology 2026;133:700-708.
 * doi:10.1016/j.ophtha.2026.01.017
 *
 * Formula (spherical equivalent):   R = (a - b) + c
 *   a = measured pre-exchange manifest-refraction SE with the ORIGINAL IOL
 *   b = Holladay-1 predicted refraction for the ORIGINAL IOL (its power/A-constant)
 *   c = Holladay-1 predicted refraction for the NEW IOL
 *   (a - b) = observed prediction error (PE) of the original lens, carried
 *             forward to correct the new-lens prediction.
 *
 * This module answers both directions:
 *   - predictedRefractionForNewPower: R for a chosen new IOL power
 *   - newIolPowerForTarget: the new IOL power to hit a target postoperative SE
 *
 * Independent implementation; not affiliated with or endorsed by the authors.
 */

import {
  predictedRefraction,
  iolPowerForRefraction,
} from "./holladay1.js";

/**
 * Observed prediction error of the original IOL:  PE = a - b.
 * Shared geometry (same eye) is used for both the original prediction (b) and
 * every new-IOL prediction (c).
 *
 * @param {object} eye        pre-exchange biometry: { axialLength, meanK | k1,k2 }
 * @param {object} originalIol { power, aConstant | surgeonFactor }
 * @param {number} measuredSE  a: manifest-refraction SE with the original IOL
 * @returns {number} PE (a - b) in dioptres
 */
function originalPredictionError(eye, originalIol, measuredSE) {
  const originalEye = withLens(eye, originalIol);
  const b = predictedRefraction(originalEye, originalIol.power);
  return measuredSE - b;
}

/**
 * Predicted postoperative SE (R) if a given NEW IOL power is implanted.
 *
 * @param {object} eye         pre-exchange biometry
 * @param {object} originalIol { power, aConstant | surgeonFactor }
 * @param {number} measuredSE  a
 * @param {object} newIol      { aConstant | surgeonFactor }
 * @param {number} newPower    candidate new IOL power (D)
 * @returns {{ R:number, pe:number, b:number, c:number }}
 */
function predictedRefractionForNewPower(eye, originalIol, measuredSE, newIol, newPower) {
  const pe = originalPredictionError(eye, originalIol, measuredSE);
  const c = predictedRefraction(withLens(eye, newIol), newPower);
  return { R: pe + c, pe, c };
}

/**
 * New IOL power required to achieve a target postoperative SE.
 *
 * We need R = target, with R = PE + c and c = Holladay1(newIol, power).
 * So the required Holladay-1 prediction for the new lens is c* = target - PE,
 * and the power is the Holladay-1 inverse for c*.
 *
 * @returns {{ power:number, pe:number, cTarget:number }}
 */
function newIolPowerForTarget(eye, originalIol, measuredSE, newIol, targetRefraction) {
  const pe = originalPredictionError(eye, originalIol, measuredSE);
  const cTarget = targetRefraction - pe;
  const power = iolPowerForRefraction(withLens(eye, newIol), cTarget);
  return { power, pe, cTarget };
}

/**
 * Build a power table (IOL-printout style) around the ideal power: predicted
 * postoperative SE for each available power step.
 *
 * @param {number} idealPower  exact recommended power (D)
 * @param {number} step        available power increment (D), e.g. 0.5
 * @param {number} spanD       +/- range around the ideal to tabulate (D)
 * @returns {Array<{power:number, R:number}>}
 */
function powerTable(eye, originalIol, measuredSE, newIol, idealPower, step = 0.5, spanD = 1.5) {
  const center = Math.round(idealPower / step) * step;
  const steps = Math.round(spanD / step);
  const rows = [];
  for (let i = -steps; i <= steps; i++) {
    const power = round2(center + i * step);
    const { R } = predictedRefractionForNewPower(eye, originalIol, measuredSE, newIol, power);
    rows.push({ power, R });
  }
  return rows;
}

// ---- helpers ----------------------------------------------------------------

/** Merge the eye biometry with a lens's constant into one Holladay-1 eye spec. */
function withLens(eye, lens) {
  const spec = {
    axialLength: eye.axialLength,
  };
  if (eye.meanK != null) spec.meanK = eye.meanK;
  if (eye.k1 != null) spec.k1 = eye.k1;
  if (eye.k2 != null) spec.k2 = eye.k2;
  if (lens.surgeonFactor != null) spec.surgeonFactor = lens.surgeonFactor;
  else spec.aConstant = lens.aConstant;
  return spec;
}

/** Spherical equivalent from sphere and cylinder. */
function sphericalEquivalent(sphere, cylinder) {
  return sphere + cylinder / 2;
}

// ---------------------------------------------------------------------------
// Manual (biometry-printout) mode.
//
// This mirrors the authors' Excel tool exactly: the Holladay-1 predicted
// refractions b (current IOL) and c (new IOLs) are read from the surgeon's
// biometer printout rather than computed here. The tool performs only the
// validated arithmetic R = (a - b) + c, and, like the Excel, extrapolates to
// neighbouring powers using the local slope between two entered (power,
// prediction) points.
// ---------------------------------------------------------------------------

/** Linear (slope) interpolation of the Holladay prediction c at `power`, from
 *  two entered points (p1,c1) and (p2,c2). Matches the Excel's method. */
function interpolatePrediction(power, p1, c1, p2, c2) {
  const slope = (c2 - c1) / (p2 - p1);
  return c1 + slope * (power - p1);
}

/** Manual predicted refraction for a given new IOL power: R = a - b + c(power). */
function manualPredictedRefraction(a, b, power, p1, c1, p2, c2) {
  return a - b + interpolatePrediction(power, p1, c1, p2, c2);
}

/** New IOL power to hit a target refraction, from two entered prediction points.
 *  Solve a - b + c(power) = target  =>  c(power) = target - (a - b). */
function manualPowerForTarget(a, b, target, p1, c1, p2, c2) {
  const slope = (c2 - c1) / (p2 - p1);
  const cTarget = target - (a - b);
  return { power: p1 + (cTarget - c1) / slope, pe: a - b, cTarget };
}

/** Power table (IOL-printout style) for manual mode. */
function manualPowerTable(a, b, p1, c1, p2, c2, idealPower, step = 0.5, spanD = 1.5) {
  const center = Math.round(idealPower / step) * step;
  const steps = Math.round(spanD / step);
  const rows = [];
  for (let i = -steps; i <= steps; i++) {
    const power = round2(center + i * step);
    rows.push({ power, R: manualPredictedRefraction(a, b, power, p1, c1, p2, c2) });
  }
  return rows;
}

/** Nearest available IOL power to `power` on a `step` grid. */
function nearestStep(power, step = 0.5) {
  return round2(Math.round(power / step) * step);
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

export {
  originalPredictionError,
  predictedRefractionForNewPower,
  newIolPowerForTarget,
  powerTable,
  sphericalEquivalent,
  nearestStep,
  interpolatePrediction,
  manualPredictedRefraction,
  manualPowerForTarget,
  manualPowerTable,
};
