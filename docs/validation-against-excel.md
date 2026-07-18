# Validation against the authors' Excel tool

Source file (received privately from Dr. Koch, **not** redistributed / git-ignored):
`MR-Biometry-Formula-Tool.06.08.2026.locked.xlsx` — "MR-Biometry Formula (v. 1.0)".

## What the Excel does

The workbook (single sheet) is a data-entry form. The surgeon enters:

- `C20` current MR **sphere**, `D20` current MR **cylinder**
- `D26` = Holladay-1 predicted refraction for the **current** IOL (value **b**)
- `C27`, `C28` = two new IOL powers 0.5 D apart (lower on top)
- `D27`, `D28` = Holladay-1 predicted refractions for those new IOL powers (value **c**)

The result cells compute:

```
H22 = C20 + 0.5*D20 - D26 + D27     ' predicted refraction, new IOL at C27
H23 = C20 + 0.5*D20 - D26 + D28     ' predicted refraction, new IOL at C28
```

i.e.

```
R = sphere + 0.5*cylinder - b + c  =  (a - b) + c
```

and it extrapolates to the neighbouring ±0.5 D powers using the local slope
`(D27 - D28)` between the two entered points (`H21`, `H24`, `G21`, `G24`).

**Key point:** the Excel does *not* compute Holladay 1. It relies on the Holladay-1
predicted refractions printed by the surgeon's biometer.

## How this tool compares

- **Arithmetic:** identical. `mr-biometry.js` computes `R = (a - b) + c` with
  `a = sphere + cyl/2`. Fed the same `b`/`c`, this tool matches the Excel formula to
  **0.000 D** across dozens of test cases (see `/private` cross-check and
  `tests/manual-mode.test.js`).
- **Worked example:** the paper's example (a = +0.75, b = +0.29, new 25.0 D c = −0.31)
  gives R = +0.15 D in the Excel, in the paper, and in this tool (both modes).
- **Holladay 1:** the Excel delegates this to the biometer. This tool offers two modes:
  1. *Compute from biometry* — internal Holladay 1 (validated <0.01 D vs an independent
     implementation, `tests/reference-crossvalidation.test.js`).
  2. *Enter from printout* — mirrors the Excel exactly: the surgeon enters `b` and the two
     `(power, c)` points; the tool does only the arithmetic and the same slope extrapolation.

## Conclusion

The MR-Biometry formula as implemented here is confirmed against the authors' reference
tool. For maximum fidelity (zero dependence on a reimplemented Holladay 1), use
*Enter from printout* mode with the Holladay-1 values from the biometer that produced the
biometry.
