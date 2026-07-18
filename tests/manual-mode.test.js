import { test } from "node:test";
import assert from "node:assert/strict";
import {
  interpolatePrediction,
  manualPredictedRefraction,
  manualPowerForTarget,
  manualPowerTable,
  sphericalEquivalent,
} from "../js/mr-biometry.js";

const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: |${a} - ${b}| = ${Math.abs(a - b)} > ${tol}`);

// Reference: the authors' Excel core formula (Sheet1, cell H22/H23):
//   H = C20 + 0.5*D20 - D26 + D27  =  sphere + 0.5*cyl - b + c
const excelH = (sphere, cyl, b, c) => sphere + 0.5 * cyl - b + c;

test("manual predicted refraction equals the authors' Excel formula exactly", () => {
  // Paper worked example: a=+0.75 (0.75/0), b=+0.29, new 25.0 D c=-0.31 -> +0.15
  const a = sphericalEquivalent(0.75, 0.0);
  near(manualPredictedRefraction(a, 0.29, 25.0, 25.0, -0.31, 25.5, -0.65), 0.15, 1e-9, "paper example");

  // Match the Excel formula across arbitrary sphere/cyl/b/c
  for (const [sph, cyl, b, c] of [
    [-0.5, 0, -0.2, -0.55],
    [0.25, -0.5, 0.1, 0.4],
    [-1.25, -0.75, -0.17, -1.02],
    [1.0, -1.0, 0.3, 0.05],
  ]) {
    const a2 = sphericalEquivalent(sph, cyl);
    // Choose two prediction points whose interpolation passes through c at the
    // evaluated power, then confirm the composition matches the Excel formula.
    const p1 = 20, c1 = c - 0.34, p2 = 20.5, c2 = c; // c at power 20.5
    near(manualPredictedRefraction(a2, b, 20.5, p1, c1, p2, c2), excelH(sph, cyl, b, c), 1e-9, "excel match");
  }
});

test("interpolation reproduces the two entered points and the local slope", () => {
  const p1 = 21, c1 = 0.10, p2 = 21.5, c2 = -0.24;
  near(interpolatePrediction(21, p1, c1, p2, c2), 0.10, 1e-12, "at p1");
  near(interpolatePrediction(21.5, p1, c1, p2, c2), -0.24, 1e-12, "at p2");
  // slope per 0.5 D
  near(interpolatePrediction(22, p1, c1, p2, c2), -0.24 + (-0.24 - 0.10), 1e-12, "one step beyond");
});

test("manualPowerForTarget hits the target when its predicted power is implanted", () => {
  const a = -0.5, b = -0.2, p1 = 20.5, c1 = 0.16, p2 = 21.0, c2 = -0.18;
  for (const target of [-1.0, -0.5, 0, 0.5]) {
    const { power } = manualPowerForTarget(a, b, target, p1, c1, p2, c2);
    near(manualPredictedRefraction(a, b, power, p1, c1, p2, c2), target, 1e-9, `target ${target}`);
  }
});

test("manual power table is monotonic and centered on the ideal power", () => {
  const a = 0.0, b = 0.1, p1 = 21.0, c1 = 0.20, p2 = 21.5, c2 = -0.14;
  const { power } = manualPowerForTarget(a, b, 0, p1, c1, p2, c2);
  const rows = manualPowerTable(a, b, p1, c1, p2, c2, power, 0.5, 1.5);
  assert.equal(rows.length, 7);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].power > rows[i - 1].power, "powers ascending");
    assert.ok(rows[i].R < rows[i - 1].R, "refraction descending as power rises");
  }
  const closest = rows.reduce((m, r) => (Math.abs(r.R) < Math.abs(m.R) ? r : m));
  assert.ok(Math.abs(closest.R) < 0.5, "a near-plano row exists");
});
