# EMR WebMCP

Browser WebMCP tools on a live OpenMRS 3 EMR. An agent finds unowned abnormal labs and drafts follow-ups; only a human Confirm writes the chart.

## Live demo

| | |
|---|---|
| Public HTTPS (trusted cert) | https://ottawa-desert-insert-alternative.trycloudflare.com |
| Tailscale (self-signed) | https://crimson-prime.tail304e54.ts.net |
| Path | `/openmrs/spa/emr-webmcp` |
| Username | `admin` |
| Password | see Devpost submission form |
| Chrome | `chrome://flags/#enable-webmcp-testing` → **Enabled**, or ChatGPT in-app browser (judges) |

Prefer the public HTTPS URL. The `trycloudflare.com` hostname is a quick tunnel in front of the live Prime stack; it can change if that tunnel is recreated. Do not use `localhost:18080` (stale Azure). If a local tunnel is present, use `http://127.0.0.1:18081`.

## How to run LabLatch

1. Login, open `/openmrs/spa/emr-webmcp`. The banner must say **This page registered tools with the browser. An agent can hunt here; drafts appear in the queue below.**
2. Agent or DevTools: `find_unlatched_abnormal_results` `{limit:20}`.
3. `stage_followup_task` with `patient`, `title`, `rationale`, `priority` `high`, and `sourceReference` from the result.
4. Human clicks **Confirm follow-up**.

`stage_followup_task` is draft-only. **Confirm follow-up** is the only durable write.

## Console snippet

On `/openmrs/spa/emr-webmcp` after the host-connected banner:

```js
const host = document.modelContext;
const run = async (name, input) => {
  const tool = (await host.getTools()).find((t) => t.name === name);
  const raw = await host.executeTool(tool, JSON.stringify(input));
  return typeof raw === "string" ? JSON.parse(raw) : raw;
};
const found = await run("find_unlatched_abnormal_results", { limit: 20 });
const row = found.data[0];
await run("stage_followup_task", {
  patient: row.patient,
  title: "Review unlatched abnormal lab",
  rationale: "Unowned high-risk result from LabLatch.",
  priority: "high",
  sourceReference: row.sourceReference,
});
```

Then click **Confirm follow-up** in the review queue. Do not expect the console call to write the chart.

## Tools

| Tool | Class | What it does |
|---|---|---|
| `get_active_patient` | Read | Patient on the current O3 route, or `null` |
| `search_patients` | Read | Authorized patient search (max 20) |
| `list_clinic_appointments` | Read | Appointments in a bounded window (max 7 days) |
| `get_chart_brief` | Read | Conditions, allergies, meds, recent vitals/results, open tasks |
| `find_unlatched_abnormal_results` | Read | Abnormal labs with no matching active LabLatch task |
| `get_result_context` | Read | One result plus existing follow-up context |
| `list_open_followups` | Read | Bounded open tasks |
| `list_followup_assignees` | Read | Assignable providers and roles |
| `stage_followup_task` | Draft | In-memory draft only; no EMR write |
| `open_review_queue` | Navigate | Opens the draft-review workspace |
| `open_patient_chart` | Navigate | Opens the native patient chart |
| `open_result_or_followup` | Navigate | Opens Tests dashboard or Task workspace |

## What this is

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

## License

Mozilla Public License 2.0. See [LICENSE](LICENSE).
