# EMR WebMCP

EMR WebMCP is a reusable browser-side agent surface for existing electronic medical record systems.
It exposes narrow, permission-aware WebMCP tools over an EMR's existing web application, APIs, user
session, and native confirmation screens. The EMR remains the system of record.

The first reference implementation targets OpenMRS 3. OpenMRS core is not forked or patched; the
adapter ships as a separately packaged O3 frontend module and is added to a custom distribution.

## Initial scope

- OpenMRS 3 adapter and deployable reference distribution
- Clinic-preparation, workflow-coordination, and LabLatch safety workflows
- Human-confirmed durable writes through native O3 workspaces
- Synthetic patient and workload generation
- WebMCP, browser, contract, and load-test evidence

The reviewed architecture is defined in
[`docs/superpowers/specs/2026-08-31-emr-webmcp-design.md`](docs/superpowers/specs/2026-08-31-emr-webmcp-design.md).

No real patient data belongs in this repository or its demonstration deployment.
