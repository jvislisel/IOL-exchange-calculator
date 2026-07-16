# IOL Exchange Power Calculator (MR Biometry formula)

A free, single-page web calculator that estimates the ideal replacement intraocular
lens (IOL) power for **lens exchange**, using the **MR biometry formula** published in:

> Cheng X, Mendes F, Fortingo K, Jaber JM, Chen AJ, Weikert MP, Wang L, Koch DD.
> *A New Intraocular Lens Power Calculation Formula for Eyes Undergoing Lens Exchange.*
> **Ophthalmology.** 2026;133(6):700–708. doi:[10.1016/j.ophtha.2026.01.017](https://doi.org/10.1016/j.ophtha.2026.01.017)

This is an **independent implementation**. It is not affiliated with, reviewed by, or
endorsed by the authors, Baylor College of Medicine, the American Academy of
Ophthalmology, or Elsevier.

> ⚠️ **Not a medical device.** For educational/informational use only. Every input and
> result must be independently verified by the treating surgeon. See the disclaimer on
> the page and in `index.html`.

## The formula

```
R = (a − b) + c
```

- `a` = spherical equivalent of the manifest refraction with the **original** IOL
- `b` = Holladay 1 predicted refraction for the **original** IOL and power
- `c` = Holladay 1 predicted refraction for the **new** IOL and power

`(a − b)` is the observed prediction error of the original lens, carried forward to
correct the new-lens prediction. The tool inverts the relationship to solve for the new
IOL power that lands on a chosen target refraction.

## Project layout

```
index.html          Single-page app (calculator + explanation + Barrett Rx panel + disclaimer)
css/style.css       Styles (no external fonts/CDNs; fully self-contained)
js/holladay1.js     Holladay 1 vergence engine (pure functions, no DOM)
js/mr-biometry.js   MR biometry formula on top of the engine (pure functions)
js/app.js           UI wiring, validation, rendering
tests/              Node test suite (node --test) — validation of the math
```

No build step and no runtime dependencies. The same ES modules run in the browser and
under Node.

## Running locally

Because the app uses ES modules, open it through a local web server (not `file://`):

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Tests

```bash
node --test
```

The suite includes:

- Exact analytic round-trip (power ↔ refraction) to machine precision.
- The identical-lens invariant (exchanging for the same lens/power reproduces the current refraction).
- MR biometry composition and the paper's worked example.
- **Independent cross-validation:** the Holladay 1 engine is checked against a separately
  authored Holladay 1 implementation (the El Oculista "Holladay I" calculator), agreeing
  to **< 0.01 D** across the clinical input range.

### Validation status

- ✅ Cross-validated numerically against an independent Holladay 1 implementation.
- ⏳ **Not yet** validated against the study authors' own spreadsheet tool. The paper
  states an Excel tool is available on request from the corresponding author
  (Douglas D. Koch, dkoch@bcm.edu). A draft request email is in `docs/validation-request-email.md`.
  Once obtained, validate case-by-case and record results here before relying on the tool
  clinically.

## Deploying to GitHub Pages (free, no login for visitors)

1. Create a **free** GitHub account if you do not have one (https://github.com/signup).
2. Authenticate the CLI once: `gh auth login` (choose GitHub.com → HTTPS → login via browser).
3. From this folder:
   ```bash
   gh repo create IOL-exchange-calculator --public --source=. --push
   gh api -X POST repos/:owner/IOL-exchange-calculator/pages -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/'
   ```
   (Or enable Pages in the repo's Settings → Pages → Deploy from branch → `main` / root.)
4. The site publishes at `https://<your-username>.github.io/IOL-exchange-calculator/`.

The manuscript PDF is git-ignored and is **not** published (copyright).

## Notes

- Scope: spherical equivalent only (no toric cylinder/axis), matching the paper.
- The Barrett Rx formula is proprietary and cannot be reproduced; the page links to the
  official free APACRS calculator and maps your entered values to its fields.
- This tool is not legal advice. If liability is a concern, consider having counsel review
  the on-page disclaimer.

## License

MIT (see `LICENSE`). The MIT license covers this implementation's code only, not the
underlying formula or the source manuscript.
