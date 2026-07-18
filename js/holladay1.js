/*
 * holladay1.js — Holladay 1 theoretical IOL power / refraction engine.
 *
 * Reference: Holladay JT, Prager TC, Chandler TY, et al. "A three-part system
 * for refining intraocular lens power calculations." J Cataract Refract Surg.
 * 1988;14:17-24.
 *
 * A pure paraxial (thin-lens vergence) model. Given ocular biometry and an IOL
 * power it predicts the spherical-equivalent spectacle refraction; inverting
 * that relationship gives the IOL power for a target refraction. Dependency-
 * free and side-effect free so the identical file runs in the browser and
 * under `node --test`.
 *
 * Lengths are millimetres; powers/refractions dioptres.
 *
 * SURGICAL-PLANNING TOOL: every constant is pinned to the Holladay 1
 * publication / standard published implementation and is exercised by
 * tests/holladay1.test.js and by numerical cross-validation against
 * independent runnable Holladay 1 calculators. Do not change a constant
 * without re-running that validation.
 */

// ---- Model constants (Holladay 1) -------------------------------------------
const N_AQUEOUS = 1.336; // index of aqueous/vitreous
const N_CORNEA = 4 / 3; // index used to convert corneal radius -> power
const KERATOMETRIC_INDEX = 1.3375; // index built into keratometer readings
const RETINAL_THICKNESS = 0.2; // mm added to axial length
const CORNEAL_HEIGHT_OFFSET = 0.56; // mm, Holladay ACD offset constant
const AG_COEFF = 12.5 / 23.45; // corneal-width scaling vs corrected axial length
const AG_MAX = 13.5; // mm cap on corneal width
const VERTEX_DISTANCE = 0.012; // m (12 mm), spectacle plane

// A-constant -> Surgeon Factor (Holladay, standardized constants):
//   SF = 0.5663 * A - 65.60
const SF_SLOPE = 0.5663;
const SF_INTERCEPT = -65.6;

// Hard input ranges. Out-of-range input must be rejected by callers.
const RANGES = Object.freeze({
  // Outer sanity bounds. These only reject clearly-impossible input (typos that
  // would produce nonsense); realistic clinical extremes are allowed and instead
  // flagged by the typical-range advisories in the UI.
  axialLength: { min: 14, max: 40, unit: "mm", label: "Axial length" },
  meanK: { min: 25, max: 65, unit: "D", label: "Keratometry (mean K)" },
  aConstant: { min: 100, max: 130, unit: "", label: "A-constant" },
  iolPower: { min: -20, max: 60, unit: "D", label: "IOL power" },
  targetRefraction: { min: -20, max: 20, unit: "D", label: "Target refraction" },
  sphere: { min: -30, max: 30, unit: "D", label: "Sphere" },
  cylinder: { min: -15, max: 15, unit: "D", label: "Cylinder" },
  manifestSE: { min: -30, max: 30, unit: "D", label: "Spherical equivalent" },
});

/** Surgeon Factor (mm) from a manufacturer A-constant. */
function surgeonFactorFromAConstant(A) {
  return SF_SLOPE * A + SF_INTERCEPT;
}

/** Mean corneal radius of curvature (mm) from mean keratometry (D). */
function cornealRadiusFromK(meanK) {
  return ((KERATOMETRIC_INDEX - 1) * 1000) / meanK; // = 337.5 / K
}

/**
 * Effective lens position (mm behind the cornea) per Holladay 1.
 * @param {number} r      mean corneal radius (mm)
 * @param {number} alMod  retinal-thickness-corrected axial length (mm)
 * @param {number} sf     surgeon factor (mm)
 */
function effectiveLensPosition(r, alMod, sf) {
  let ag = AG_COEFF * alMod;
  if (ag > AG_MAX) ag = AG_MAX;
  // The corneal-height sagitta is only real when the corneal width does not
  // exceed the corneal diameter (ag <= 2r). For pathologically steep + long
  // eyes clamp ag just under 2r so the geometry stays defined.
  const agLimit = 2 * r * 0.999;
  if (ag > agLimit) ag = agLimit;
  const anatomicACD = CORNEAL_HEIGHT_OFFSET + r - Math.sqrt(r * r - (ag * ag) / 4);
  return anatomicACD + sf;
}

/**
 * Predicted spherical-equivalent spectacle refraction (D) for a given IOL power.
 *
 * Vergence trace: object at infinity -> cornea -> aqueous -> IOL -> vitreous ->
 * retina. Solve for the corneal-plane object vergence (far point) that images
 * on the retina, then refer it to the spectacle plane.
 */
function predictedRefraction(eye, iolPower) {
  const { r, alMod, elp } = resolveGeometry(eye);
  const n = N_AQUEOUS * 1000; // reduced-vergence numerator (index x mm->m)
  const Kc = ((N_CORNEA - 1) * 1000) / r; // corneal power (D)

  const W = n / (alMod - elp) - iolPower; // reduced vergence at IOL, before the IOL
  const distCorneaToImage = n / W + elp; // cornea->pre-IOL image distance (mm)
  const L = n / distCorneaToImage - Kc; // corneal-plane refraction in air (D)

  return L / (1 + VERTEX_DISTANCE * L); // refer to spectacle plane
}

/**
 * IOL power (D) that yields a target spectacle refraction (closed-form inverse
 * of predictedRefraction; the model is monotonic and analytically invertible).
 */
function iolPowerForRefraction(eye, targetRefraction) {
  const { r, alMod, elp } = resolveGeometry(eye);
  const n = N_AQUEOUS * 1000;
  const Kc = ((N_CORNEA - 1) * 1000) / r;

  const L = targetRefraction / (1 - VERTEX_DISTANCE * targetRefraction); // corneal plane
  const distCorneaToImage = n / (L + Kc);
  const W = n / (distCorneaToImage - elp); // reduced vergence at IOL, before the IOL
  return n / (alMod - elp) - W;
}

/** Convenience: IOL power for emmetropia (plano). */
function iolPowerForEmmetropia(eye) {
  return iolPowerForRefraction(eye, 0);
}

// ---- internals --------------------------------------------------------------

/** Resolve shared geometry (radius, corrected AL, ELP) from an eye spec. */
function resolveGeometry(eye) {
  const meanK = resolveMeanK(eye);
  const r = cornealRadiusFromK(meanK);
  const alMod = eye.axialLength + RETINAL_THICKNESS;
  const sf =
    eye.surgeonFactor != null
      ? eye.surgeonFactor
      : surgeonFactorFromAConstant(eye.aConstant);
  const elp = effectiveLensPosition(r, alMod, sf);
  return { r, alMod, elp, sf, meanK };
}

/** Accept either meanK, or K1/K2 to average. */
function resolveMeanK(eye) {
  if (eye.meanK != null) return eye.meanK;
  if (eye.k1 != null && eye.k2 != null) return (eye.k1 + eye.k2) / 2;
  throw new Error("Eye specification requires meanK or both k1 and k2.");
}

const HOLLADAY1_CONSTANTS = Object.freeze({
  N_AQUEOUS,
  N_CORNEA,
  KERATOMETRIC_INDEX,
  RETINAL_THICKNESS,
  CORNEAL_HEIGHT_OFFSET,
  AG_COEFF,
  AG_MAX,
  VERTEX_DISTANCE,
  SF_SLOPE,
  SF_INTERCEPT,
});

export {
  surgeonFactorFromAConstant,
  cornealRadiusFromK,
  effectiveLensPosition,
  predictedRefraction,
  iolPowerForRefraction,
  iolPowerForEmmetropia,
  resolveGeometry,
  resolveMeanK,
  RANGES,
  HOLLADAY1_CONSTANTS,
};
