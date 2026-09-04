# Devpost paste-ready answers

Suggested project title: **EMR WebMCP — LabLatch**

## Video voiceover (~90 seconds)

Full narration script: [`docs/demo-voiceover-script.md`](../docs/demo-voiceover-script.md)

Generate cloned voiceover from your Voice Memo sample:

```bash
export ELEVENLABS_API_KEY=…   # from elevenlabs.com
node scripts/demo/generate-voiceover.mjs
# → /tmp/lablatch-voiceover-90s.mp3
```

Record screen capture (~90s, post reseed):

```bash
export OPENMRS_ORIGIN=https://ottawa-desert-insert-alternative.trycloudflare.com
export OPENMRS_USERNAME=admin OPENMRS_PASSWORD=…
bash scripts/demo/reseed-demo.sh demo          # purge old Hgb stamps, reseed varied labs
node scripts/demo/record-lablatch-v3.mjs
bash scripts/demo/combine-demo-media.sh        # → ~/Desktop/emr-webmcp-lablatch-demo.mp4
```

Upload the combined MP4 to YouTube, or read the script live while the silent capture plays.

Copy the sections below into the Devpost form. Do not invent extra features.

## Why WebMCP

WebMCP lets an agent use the same authenticated OpenMRS 3 page the clinician already has open. Tools are registered in the browser with `document.modelContext.registerTool`, so the agent shares the live session, privileges, and on-screen context. We did not add an agent-owned write API, fork OpenMRS core, or put a sidecar between the user and the chart. The EMR stays the system of record. `stage_followup_task` only stores a draft in memory. The only durable write is `createFollowup`, and that runs only after a human clicks Confirm follow-up.

## Better UX

The clinician stays in OpenMRS 3. The agent does the search-and-reconcile work that used to mean clicking through charts: find unowned abnormal labs, pull result context, and stage a follow-up with a source reference. The review queue shows patient, source, title, rationale, assignee, and priority on the same page. Confirm follow-up is a visible button, not a hidden tool. If the clinician does not click it, the chart does not change. Logout, user change, or tab close drops the drafts.

## What people and agents can do together that was hard before

Finding unowned abnormal labs used to be a manual hunt across patient charts. With LabLatch, the agent calls `find_unlatched_abnormal_results`, stages a follow-up with `stage_followup_task`, and the human reviews and confirms. People and agents share one page and one session. The agent can read, navigate, and draft. The human is the only one who writes the chart. That split was hard before because there was no in-page, permission-gated tool surface that stopped at a draft.

## How implemented

The OpenMRS 3 frontend module registers the twelve tools with `document.modelContext.registerTool`. Registration is capability- and session-gated: tools appear only when the adapter advertises the capability and the logged-in user has the required privilege (`session` for `get_active_patient`, `emr-webmcp.use` for the rest). Handlers re-check the session on every call. Drafts live in an in-memory `DraftStore` and expire on logout, user change, or tab close. `createFollowup` is adapter code, not a registered WebMCP tool. It is called only from the Confirm follow-up click in the review queue.

## Testing instructions for judges

1. In Chrome, set `chrome://flags/#enable-webmcp-testing` to Enabled, or use the ChatGPT in-app browser.
2. Open the public HTTPS demo: https://ottawa-desert-insert-alternative.trycloudflare.com/openmrs/spa/emr-webmcp. Username `admin`. Password is on the Devpost submission form. Fallback (self-signed, tailnet): https://crimson-prime.tail304e54.ts.net/openmrs/spa/emr-webmcp. Do not use `localhost:18080`. If you are on the local tunnel, use `http://127.0.0.1:18081`.
3. After login, the banner must say "This page registered tools with the browser. An agent can hunt here; drafts appear in the queue below."
4. In the agent or DevTools console, run `find_unlatched_abnormal_results` with `{limit:20}`.
5. Call `stage_followup_task` with `patient`, `title`, `rationale`, `priority` `high`, and `sourceReference` from that result.
6. Click Confirm follow-up. That click is the only durable chart write.

Console pattern:

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

Then click Confirm follow-up.

## What this is not

This demo does not claim a Codex sidebar or a stable custom hostname. The public URL is a Cloudflare quick tunnel in front of the live Prime stack and can change if that tunnel is recreated. Data is synthetic. License is MPL-2.0 at the repo root.
