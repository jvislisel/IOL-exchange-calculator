import { test } from "node:test";
import assert from "node:assert/strict";
import {
  surgeonFactorFromAConstant,
  cornealRadiusFromK,
  predictedRefraction,
  iolPowerForRefraction,
  iolPowerForEmmetropia,
  HOLLADAY1_CONSTANTS,
} from "../js/holladay1.js";

const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: |${a} - ${b}| = ${Math.abs(a - b)} > ${tol}`);

test("surgeon factor from A-constant matches the published regression", () => {
  // SF = 0.5663*A - 65.60
  near(surgeonFactorFromAConstant(118.0), 0.5663 * 118 - 65.6, 1e-9, "SF(118)");
  near(surgeonFactorFromAConstant(118.4), 1.44992, 1e-5, "SF(118.4)");
  near(surgeonFactorFromAConstant(119.0), 1.7897, 1e-4, "SF(119.0)");
});

test("corneal radius from K uses the 1.3375 keratometric index", () => {
  near(cornealRadiusFromK(43.5), 337.5 / 43.5, 1e-9, "r(43.5)");
  near(cornealRadiusFromK(45.0), 7.5, 1e-9, "r(45.0)");
});

test("IOL power for emmetropia reproduces plano refraction (exact inverse)", () => {
  const eyes = [
    { axialLength: 23.5, meanK: 43.5, aConstant: 118.7 },
    { axialLength: 26.0, meanK: 42.0, aConstant: 118.4 },
    { axialLength: 21.0, meanK: 45.0, aConstant: 118.4 },
    { axialLength: 24.2, k1: 44.0, k2: 43.0, aConstant: 119.0 },
  ];
  for (const eye of eyes) {
    const p = iolPowerForEmmetropia(eye);
    near(predictedRefraction(eye, p), 0, 1e-9, `plano for ${JSON.stringify(eye)}`);
  }
});

test("power<->refraction inverse round-trips to machine precision", () => {
  let maxErr = 0;
  for (const AL of [20.5, 22, 23.5, 25, 27, 29]) {
    for (const K of [39, 42, 44.5, 47, 50]) {
      for (const A of [115, 118.4, 119.2, 121]) {
        const eye = { axialLength: AL, meanK: K, aConstant: A };
        for (const target of [-3, -1.25, -0.5, 0, 0.75, 1.5]) {
          const p = iolPowerForRefraction(eye, target);
          maxErr = Math.max(maxErr, Math.abs(predictedRefraction(eye, p) - target));
        }
      }
    }
  }
  assert.ok(maxErr < 1e-6, `max round-trip error ${maxErr} too large`);
});

test("refraction decreases (more myopic) as IOL power increases", () => {
  const eye = { axialLength: 23.5, meanK: 43.5, aConstant: 118.7 };
  let prev = Infinity;
  for (let p = 18; p <= 26; p += 0.5) {
    const r = predictedRefraction(eye, p);
    assert.ok(r < prev, `refraction not monotonically decreasing at ${p} D`);
    prev = r;
  }
});

test("plano IOL powers land in clinically plausible ranges", () => {
  // Regression guardrails against gross implementation error. Wide tolerances;
  // exact digits are confirmed separately against runnable reference calculators.
  const cases = [
    { eye: { axialLength: 23.5, meanK: 43.5, aConstant: 118.7 }, lo: 20, hi: 22 },
    { eye: { axialLength: 22.0, meanK: 44.0, aConstant: 118.4 }, lo: 23, hi: 26 },
    { eye: { axialLength: 26.0, meanK: 42.0, aConstant: 118.4 }, lo: 13, hi: 17 },
    { eye: { axialLength: 30.0, meanK: 43.0, aConstant: 119.0 }, lo: 0, hi: 8 },
  ];
  for (const { eye, lo, hi } of cases) {
    const p = iolPowerForEmmetropia(eye);
    assert.ok(p >= lo && p <= hi, `plano power ${p.toFixed(2)} outside [${lo},${hi}] for ${JSON.stringify(eye)}`);
  }
});

test("spectacle change per diopter of IOL is physiologically reasonable (~0.6-0.9 D)", () => {
  const eye = { axialLength: 23.5, meanK: 43.5, aConstant: 118.7 };
  const slope = predictedRefraction(eye, 22) - predictedRefraction(eye, 21);
  near(Math.abs(slope), 0.7, 0.15, "spectacle/IOL slope");
});

test("k1/k2 averaging equals mean-K entry", () => {
  const a = { axialLength: 24, k1: 44, k2: 42, aConstant: 118.4 };
  const b = { axialLength: 24, meanK: 43, aConstant: 118.4 };
  near(iolPowerForEmmetropia(a), iolPowerForEmmetropia(b), 1e-12, "k1/k2 vs meanK");
});

test("constants are pinned to the Holladay 1 publication values", () => {
  const c = HOLLADAY1_CONSTANTS;
  assert.equal(c.N_AQUEOUS, 1.336);
  assert.equal(c.KERATOMETRIC_INDEX, 1.3375);
  assert.equal(c.RETINAL_THICKNESS, 0.2);
  assert.equal(c.CORNEAL_HEIGHT_OFFSET, 0.56);
  assert.equal(c.AG_MAX, 13.5);
  assert.equal(c.VERTEX_DISTANCE, 0.012);
  assert.equal(c.SF_SLOPE, 0.5663);
  assert.equal(c.SF_INTERCEPT, -65.6);
});
