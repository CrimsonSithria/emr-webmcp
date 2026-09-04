# LabLatch demo voiceover (~90 seconds)

Read at a calm, lowered pace. Pause where marked.

---

**[0:00 – 0:06] Hook**

In a busy outpatient clinic, abnormal labs do not wait. Potassium, hemoglobin, creatinine — they land all day. The question is not whether the result exists. The question is who owns the follow-up.

**[0:06 – 0:22] Problem (manual workflow)**

OpenMRS stores the results. But the chart does not tell you which abnormal values still have no active follow-up. You open patient after patient, scroll the results table, and hunt by hand. That is slow, and easy to miss on a heavy clinic day.

**[0:22 – 0:32] Transition**

LabLatch runs inside OpenMRS on WebMCP. The agent finds unlatched abnormal results across the clinic. The clinician decides what actually enters the chart.

**[0:32 – 0:55] Agent tools**

The agent calls `find_unlatched_abnormal_results`. Nine hits — abnormal labs with no linked follow-up yet. No chart writes. Next it calls `stage_followup_task`: high priority, linked to the source observation, draft only.

**[0:55 – 1:18] Human in the loop**

In the review queue, the doctor reads the rationale and confirms once. That single confirm is the only write — a CarePlan follow-up latched to the lab. Everything before that was search and staging.

**[1:18 – 1:30] Close**

LabLatch. The agent hunts. The doctor decides.

---

## On-screen beats (for recording)

| Time | Screen |
|------|--------|
| 0:00 | Title card: LabLatch |
| 0:06 | Patient Results — varied labs across the week (not duplicate Hgb) |
| 0:22 | Transition card: unlatched = abnormal + no follow-up |
| 0:32 | emr-webmcp — agent panel showing tool calls |
| 0:55 | Review queue — draft visible |
| 1:10 | Confirm follow-up click |
| 1:18 | Outro card |
