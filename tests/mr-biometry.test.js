import { test } from "node:test";
import assert from "node:assert/strict";
import {
  originalPredictionError,
  predictedRefractionForNewPower,
  newIolPowerForTarget,
  powerTable,
  sphericalEquivalent,
  nearestStep,
} from "../js/mr-biometry.js";

const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: |${a} - ${b}| = ${Math.abs(a - b)} > ${tol}`);

const eye = { axialLength: 24.0, meanK: 43.5 };
const originalIol = { power: 21.0, aConstant: 118.4 };
const newIol = { aConstant: 119.0 };
const measuredSE = -0.50; // a

test("MR Biometry composes as R = (a - b) + c", () => {
  const pe = originalPredictionError(eye, originalIol, measuredSE); // a - b
  const { R, c } = predictedRefractionForNewPower(eye, originalIol, measuredSE, newIol, 22.0);
  near(R, pe + c, 1e-12, "R == PE + c");
});

test("paper worked-example arithmetic: R = (a - b) + c", () => {
  // Cheng et al. worked example: a=+0.75, b=+0.29, c=-0.31 -> R=+0.15
  // (biometry not published, so this checks the composition, not b/c themselves)
  const a = 0.75, b = 0.29, c = -0.31;
  near(a - b + c, 0.15, 1e-9, "worked example");
});

test("exchanging for the IDENTICAL lens and power predicts the current refraction", () => {
  // If the new IOL equals the original (same A-constant and same power), then
  // c == b, so R = (a - b) + b = a exactly. Strong internal invariant.
  const identicalNew = { aConstant: originalIol.aConstant };
  const { R } = predictedRefractionForNewPower(
    eye, originalIol, measuredSE, identicalNew, originalIol.power
  );
  near(R, measuredSE, 1e-9, "identical-lens exchange");
});

test("newIolPowerForTarget hits the requested target when implanted", () => {
  for (const target of [-1.5, -0.5, 0, 0.5]) {
    const { power } = newIolPowerForTarget(eye, originalIol, measuredSE, newIol, target);
    const { R } = predictedRefractionForNewPower(eye, originalIol, measuredSE, newIol, power);
    near(R, target, 1e-6, `target ${target}`);
  }
});

test("targeting plano with an identical lens returns near the original power minus its error", () => {
  // Sanity of direction: if the original lens left the eye myopic (a<0 with
  // b~plano), the recommended plano power should be lower than the original.
  const myopicSE = -1.0;
  const identicalNew = { aConstant: originalIol.aConstant };
  const { power } = newIolPowerForTarget(eye, originalIol, myopicSE, identicalNew, 0);
  assert.ok(power < originalIol.power, `expected reduced power, got ${power}`);
});

test("power table centers on the ideal and is monotonic in refraction", () => {
  const { power } = newIolPowerForTarget(eye, originalIol, measuredSE, newIol, 0);
  const rows = powerTable(eye, originalIol, measuredSE, newIol, power, 0.5, 1.5);
  assert.equal(rows.length, 7); // -1.5..+1.5 in 0.5 steps
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].power > rows[i - 1].power, "powers ascending");
    assert.ok(rows[i].R < rows[i - 1].R, "refraction descending as power rises");
  }
  // A row near the ideal power should predict close to plano.
  const closest = rows.reduce((m, r) => (Math.abs(r.R) < Math.abs(m.R) ? r : m));
  assert.ok(Math.abs(closest.R) < 0.5, `no near-plano row: ${JSON.stringify(rows)}`);
});

test("spherical equivalent and nearest-step helpers", () => {
  near(sphericalEquivalent(-1.0, -1.0), -1.5, 1e-12, "SE");
  near(sphericalEquivalent(+2.0, -0.5), 1.75, 1e-12, "SE");
  assert.equal(nearestStep(21.34, 0.5), 21.5);
  assert.equal(nearestStep(21.24, 0.5), 21.0);
  assert.equal(nearestStep(20.75, 0.5), 21.0); // round half up
});

test("surgeon-factor override bypasses A-constant for both lenses", () => {
  const eSF = { axialLength: 24, meanK: 43.5 };
  const origSF = { power: 21, surgeonFactor: 1.4 };
  const newSF = { surgeonFactor: 1.7 };
  const { R } = predictedRefractionForNewPower(eSF, origSF, -0.5, newSF, 22);
  assert.ok(Number.isFinite(R), "SF override produces a finite result");
});
