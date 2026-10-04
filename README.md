# Cyber Assurance Lab

Browser-local educational projects for explaining security, privacy and control-assurance decisions. Each application has a working decision engine, synthetic fixtures, automated tests and a documented scope; none is an enterprise security product or compliance certification.

The lab contains 25 standalone applications across five tracks. See [the project index](PROJECTS.md) for their purpose, location and measured test counts.

## Selected public demos

- [Tessera](https://dln-tessera.vercel.app): control-evidence assessment.
- [Permit Matrix](https://dln-permit-matrix.vercel.app): mock API authorization testing.
- [Petitio](https://dln-petitio.vercel.app): privacy rights workflow.

These Vercel deployments serve reviewed prebuilt static assets. They are not automatically linked to GitHub pushes; source changes require rebuilding, checking and redeploying. The demos reflect the build that was last deployed, which may predate the most recent changes in this repository.

## Run a project

Each directory under `apps/<track>/<project>` is a standalone application with its own lockfile. Use Node.js 20.19 or newer (Vite 7 requires it; every `package.json` declares `engines.node`) and the commands below from that application's directory.

```sh
npm ci
npm test
npm run build
npm run dev
```

The individual README identifies the local preview port and exact workflow. No account, API key or external target is required for the sample demonstration.

## Verify the whole lab

`tools/` holds dependency-free Node scripts that measure what the documentation claims. Run them from the repository root:

```sh
node tools/verify-all.mjs --report verify-report.json   # npm ci, vitest, build and audit for every app; JSON report with measured test totals
node tools/check-docs.mjs --report verify-report.json   # PROJECTS.md ↔ apps, README counts and ports, dangling documentation references, metadata rules
node tools/check-headers.mjs                            # every vercel.json carries the lab's canonical security headers
node tools/check-duplicates.mjs                         # copied helper files are byte-identical across apps
node tools/check-dist.mjs                               # built dist/ folders: relative assets, no inline scripts, no network or storage calls
```

`tools/README.md` documents options, exit codes and the heuristics each check uses. The GitHub Actions workflow runs the per-app install, tests, production build, dependency audit and the built-output check on Node 22 with at most four concurrent jobs, and the repository-level checks on Node 20.19 and 22. The local release evidence records its actual Node version; a configured CI workflow is not itself evidence that a remote run has passed.

## What the projects demonstrate

- **Application security:** Contract-driven authorization cases, evidence-based release gates, retest workflows, client/server trust boundaries and dependency-policy reasoning, including an offline `package-lock.json` importer.
- **Defensive analysis:** Synthetic protocol detections with tuning what-if diffs, behavioral baselines, file-integrity and DLP decisions, incident-response exercises and firewall rule analysis including partial-shadow coverage.
- **Data governance:** Access-review decisions with campaign closure and export digests, data classification with token-boundary matching, retention holds with a guarded release trail, permission paths and data-sharing reviews.
- **Control and vendor assurance:** Framework-outcome mapping with evidence forecasts, assessment packets with hash-chained history, vendor risk with lapse forecasts, evidence lineage and exception lifecycles.
- **Privacy engineering:** Consent-policy decisions, request workflows, data inventories, impact assessments and incident-notification triage with severity sensitivity.

## Evidence and limits

Every application includes `AUDIT.md`, `EVIDENCE.md` and `INTERVIEW_GUIDE.md`. Test counts refer to executed test cases, not assertion counts, coverage percentages or proof that a system is secure; browser checks are scoped to the environments and states recorded in those files.

Earlier browser and accessibility checks quoted in the per-app evidence were produced with a review harness that is not part of this repository, and some RED/GREEN logs were never committed because `*.log` files are ignored. Each `EVIDENCE.md` therefore carries an *artefact inventory* that names every referenced file that is not in the repository and says why. Captured test output under `qa/` is kept portable: machine-specific paths are replaced by the markers `<repo>` or `<original-build>`, and any capture whose text was edited after the run carries a header note saying what changed (results and counts never are). Screenshots under `qa/` show the application as it was when they were taken; where the interface changed afterwards the evidence file says so.

These are single-user simulations built with AI assistance in October 2026. The candidate should study, modify and independently explain the code before representing personal proficiency; AI-generated code does not establish that understanding.

Fixtures are fictional and imports should use synthetic data only. The applications do not connect to real identity directories, scan remote systems, delete external records or make regulatory determinations; hosting providers still receive ordinary page requests.

## Security headers

Every application ships the same `vercel.json` header set: a Content Security Policy with `default-src 'none'` (scripts, styles, fonts, images and connections limited to the app's own origin, inline styles allowed for component libraries), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`, and `Strict-Transport-Security`. `tools/check-headers.mjs` fails when any app drifts from this set.

## Fixture scanner note

Hashledger intentionally contains a private-key header wrapped around the literal text `SYNTHETIC-FIXTURE-NOT-A-REAL-KEY` for a DLP detector test. This is not a parseable key and contains no secret material; scanners may flag the header in its fixture, test and audit documentation.

## Licenses

Application code is MIT-licensed; each app includes its license and third-party notices. Fonts and dependencies retain their own licenses, and referenced standards do not imply endorsement.
