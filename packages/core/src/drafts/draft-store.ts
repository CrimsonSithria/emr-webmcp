import { z } from 'zod';

import type { ConfirmedFollowup, FollowupDraft } from '../contracts/dtos.js';
import { AdapterError } from '../contracts/adapter-error.js';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

const identifier = z.string().min(1).max(200).refine((value) => value.trim() !== '');
const titleText = z.string().min(1).max(200).refine((value) => value.trim() !== '');
const rationaleText = z.string().min(1).max(2000).refine((value) => value.trim() !== '');

const stageInputSchema = z.strictObject({
  patient: z.strictObject({
    id: identifier,
    display: identifier,
  }),
  title: titleText,
  rationale: rationaleText,
  priority: z.enum(['low', 'medium', 'high']),
  dueAt: z.iso.datetime().optional(),
  assignee: z
    .strictObject({
      id: identifier,
      display: identifier,
      type: z.enum(['person', 'role']),
    })
    .optional(),
  sourceReference: identifier.optional(),
});

export type DraftStoreOptions = {
  userId: string;
  now: () => Date;
  randomUUID: () => string;
};

type DraftRecord = {
  ownerUserId: string;
  stagedAtMs: number;
  draft: FollowupDraft;
};

export class DraftStore {
  private userId: string;
  private readonly now: () => Date;
  private readonly randomUUID: () => string;
  private readonly drafts = new Map<string, DraftRecord>();

  constructor(options: DraftStoreOptions) {
    this.userId = options.userId;
    this.now = options.now;
    this.randomUUID = options.randomUUID;
  }

  stage(input: ConfirmedFollowup): FollowupDraft {
    const parsed = stageInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new AdapterError('invalid-input', 'Follow-up draft input is invalid.', false);
    }

    const draftId = this.randomUUID();
    const draft = toDraft(draftId, parsed.data);
    this.drafts.set(draftId, {
      ownerUserId: this.userId,
      stagedAtMs: this.now().getTime(),
      draft,
    });
    return cloneDraft(draft);
  }

  peek(draftId: string): FollowupDraft {
    return cloneDraft(this.requireRecord(draftId).draft);
  }

  consume(draftId: string): FollowupDraft {
    const record = this.requireRecord(draftId);
    this.drafts.delete(draftId);
    return cloneDraft(record.draft);
  }

  logout(): void {
    this.drafts.clear();
  }

  userChange(nextUserId: string): void {
    this.drafts.clear();
    this.userId = nextUserId;
  }

  diagnostics(): { count: number; draftIds: string[] } {
    this.purgeExpired();
    const draftIds = [...this.drafts.keys()];
    return { count: draftIds.length, draftIds };
  }

  private requireRecord(draftId: string): DraftRecord {
    this.purgeExpired();
    const record = this.drafts.get(draftId);
    if (record === undefined || record.ownerUserId !== this.userId) {
      throw new AdapterError('not-found', 'Draft was not found.', false);
    }
    return record;
  }

  private purgeExpired(): void {
    const nowMs = this.now().getTime();
    for (const [draftId, record] of this.drafts) {
      if (nowMs - record.stagedAtMs >= THIRTY_MINUTES_MS) {
        this.drafts.delete(draftId);
      }
    }
  }
}

function toDraft(draftId: string, input: z.infer<typeof stageInputSchema>): FollowupDraft {
  const draft: FollowupDraft = {
    draftId,
    patient: input.patient,
    title: input.title,
    rationale: input.rationale,
    priority: input.priority,
  };
  if (input.dueAt !== undefined) {
    draft.dueAt = input.dueAt;
  }
  if (input.assignee !== undefined) {
    draft.assignee = input.assignee;
  }
  if (input.sourceReference !== undefined) {
    draft.sourceReference = input.sourceReference;
  }
  return draft;
}

function cloneDraft(draft: FollowupDraft): FollowupDraft {
  const copy: FollowupDraft = {
    draftId: draft.draftId,
    patient: { ...draft.patient },
    title: draft.title,
    rationale: draft.rationale,
    priority: draft.priority,
  };
  if (draft.dueAt !== undefined) {
    copy.dueAt = draft.dueAt;
  }
  if (draft.assignee !== undefined) {
    copy.assignee = { ...draft.assignee };
  }
  if (draft.sourceReference !== undefined) {
    copy.sourceReference = draft.sourceReference;
  }
  return copy;
}
