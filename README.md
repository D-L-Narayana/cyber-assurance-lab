# Cyber Assurance Lab

Browser-local educational projects for explaining security, privacy and control-assurance decisions. Each application has a working decision engine, synthetic fixtures, automated tests and a documented scope; none is an enterprise security product or compliance certification.

The lab contains 25 standalone applications across five tracks. See [the project index](PROJECTS.md) for their purpose, location and measured test counts.

## Selected public demos

- [Tessera](https://dln-tessera.vercel.app): control-evidence assessment.
- [Permit Matrix](https://dln-permit-matrix.vercel.app): mock API authorization testing.
- [Petitio](https://dln-petitio.vercel.app): privacy rights workflow.

These Vercel deployments serve reviewed prebuilt static assets. They are not automatically linked to GitHub pushes; source changes require rebuilding, checking and redeploying.

## Run a project

Each directory under `apps/<track>/<project>` is a standalone application with its own lockfile. Use a supported Node.js LTS release and the commands below from that application's directory.

```sh
npm ci
npm test
npm run build
npm run dev
```

The individual README identifies the local preview port and exact workflow. No account, API key or external target is required for the sample demonstration.

The GitHub Actions workflow inventories the independent lockfiles and runs install, tests, production build and dependency audit on Node 22, with at most four concurrent jobs. The local release evidence records its actual Node version; a configured CI workflow is not itself evidence that a remote run has passed.

## What the projects demonstrate

- **Application security:** Contract-driven authorization cases, evidence-based release gates, retest workflows, client/server trust boundaries and dependency-policy reasoning.
- **Defensive analysis:** Synthetic protocol detections, behavioral baselines, file-integrity and DLP decisions, incident-response exercises and firewall rule analysis.
- **Data governance:** Access-review decisions, data classification, retention holds, permission paths and data-sharing reviews.
- **Control and vendor assurance:** Framework-outcome mapping, assessment packets, vendor risk, evidence lineage and exception lifecycles.
- **Privacy engineering:** Consent-policy decisions, request workflows, data inventories, impact assessments and incident-notification triage.

## Evidence and limits

Every application includes `AUDIT.md`, `EVIDENCE.md` and `INTERVIEW_GUIDE.md`. Test counts refer to executed test cases, not assertion counts, coverage percentages or proof that a system is secure; browser checks are scoped to the environments and states recorded in those files.

These are single-user simulations built with AI assistance in October 2026. The candidate should study, modify and independently explain the code before representing personal proficiency; AI-generated code does not establish that understanding.

Fixtures are fictional and imports should use synthetic data only. The applications do not connect to real identity directories, scan remote systems, delete external records or make regulatory determinations; hosting providers still receive ordinary page requests.

## Fixture scanner note

Hashledger intentionally contains a private-key header wrapped around the literal text `SYNTHETIC-FIXTURE-NOT-A-REAL-KEY` for a DLP detector test. This is not a parseable key and contains no secret material; scanners may flag the header in its fixture, test and audit documentation.

## Licenses

Application code is MIT-licensed; each app includes its license and third-party notices. Fonts and dependencies retain their own licenses, and referenced standards do not imply endorsement.
