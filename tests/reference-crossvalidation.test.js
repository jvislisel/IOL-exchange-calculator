/*
 * Independent cross-validation of the Holladay 1 engine.
 *
 * The reference below is ported verbatim from a separate, independently authored
 * Holladay I implementation: the El Oculista "Cálculo LIO TÓRICA usando Fórmula
 * de HOLLADAY I" calculator (Manuel Diego Valdearenas Martín), compiled from
 * Pascal to JavaScript. Source inspected at:
 *   https://oftalmologiav3.eloculista.es/calculadoras/cristalinotoricholladay/ElOculista_OCUbt.js
 * (functions FN_REFRACCION_BIOMETRIA_TORIC_HOLLADAY_I_RX / _LIO, spherical case).
 *
 * Our engine and this reference share no code. Agreement to <0.02 D across the
 * clinical input range is strong evidence the engine implements Holladay 1
 * correctly. The only intentional difference is that our engine uses the exact
 * corneal index 4/3 where the reference uses the truncated constant 0.3333;
 * this accounts for the residual sub-0.01 D differences.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { predictedRefraction, iolPowerForEmmetropia } from "../js/holladay1.js";

// --- Reference implementation (ported verbatim, spherical cornea) ------------
function refACD(AL, K, A) {
  const R = (0.3375 / K) * 1000;
  const ALXcorr = AL + 0.2;
  let AG = (12.5 * ALXcorr) / 23.45;
  if (AG > 13.5) AG = 13.5;
  const ELP = 0.56 + R - Math.sqrt(R * R - (AG * AG) / 4);
  return { R, ALXcorr, ACD: ELP + (A * 0.5663 - 65.6) };
}
function refEmmePower(AL, K, A) {
  const { R, ALXcorr, ACD } = refACD(AL, K, A);
  return (
    (1336 * ((1.336 * R) / 0.3333 - ALXcorr)) /
    ((ALXcorr - ACD) * ((1.336 * R) / 0.3333 - ACD))
  );
}
function refRefraction(AL, K, A, LIO, dV = 12) {
  const { R, ALXcorr, ACD } = refACD(AL, K, A);
  const Num =
    1336 * (1.336 * R - 0.3333 * ALXcorr) -
    LIO * (ALXcorr - ACD) * (1.336 * R - 0.3333 * ACD);
  const Den =
    1.336 * (dV * (1.336 * R - 0.3333 * ALXcorr) + ALXcorr * R) -
    0.001 * LIO * (ALXcorr - ACD) * (dV * (1.336 * R - 0.3333 * ACD) + ACD * R);
  return Num / Den;
}

const CLINICAL = { AL: [21, 22, 23, 23.5, 24, 25, 26, 27], K: [40, 42, 43.5, 45, 47], A: [118.0, 118.4, 118.7, 119.2, 119.6] };

test("plano IOL power matches independent reference across clinical range (<0.02 D)", () => {
  let maxErr = 0, worst = null;
  for (const AL of CLINICAL.AL) for (const K of CLINICAL.K) for (const A of CLINICAL.A) {
    const mine = iolPowerForEmmetropia({ axialLength: AL, meanK: K, aConstant: A });
    const ref = refEmmePower(AL, K, A);
    const e = Math.abs(mine - ref);
    if (e > maxErr) { maxErr = e; worst = { AL, K, A, mine, ref }; }
  }
  assert.ok(maxErr < 0.02, `max plano-power diff ${maxErr.toFixed(4)} D at ${JSON.stringify(worst)}`);
});

test("predicted refraction matches independent reference across clinical range (<0.02 D)", () => {
  let maxErr = 0, worst = null;
  for (const AL of CLINICAL.AL) for (const K of CLINICAL.K) for (const A of [118.4, 118.7, 119.2]) {
    for (const LIO of [14, 16, 18, 20, 21, 22, 24, 26]) {
      const ref = refRefraction(AL, K, A, LIO);
      if (Math.abs(ref) > 8) continue; // ignore non-physical refractions
      const mine = predictedRefraction({ axialLength: AL, meanK: K, aConstant: A }, LIO);
      const e = Math.abs(mine - ref);
      if (e > maxErr) { maxErr = e; worst = { AL, K, A, LIO, mine, ref }; }
    }
  }
  assert.ok(maxErr < 0.02, `max refraction diff ${maxErr.toFixed(4)} D at ${JSON.stringify(worst)}`);
});
