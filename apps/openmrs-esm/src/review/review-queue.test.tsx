import {
  AdapterError,
  DraftStore,
  type ConfirmedFollowup,
  type EmrAdapter,
  type FollowupDraft,
  type FollowupSummary,
  type ResultSummary,
} from '@emr-webmcp/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { USE_PRIVILEGE } from '../openmrs/adapter-factory';
import { clearAgentActivity, recordConfirmedFollowup } from '../webmcp/agent-activity';
import {
  createConfirmationController,
  resetConfirmationControllers,
  type ConfirmationPorts,
} from './confirmation-controller';
import { ReviewQueue } from './review-queue.component';
import {
  bindReviewWorkspace,
  notifyReviewWorkspace,
  useReviewWorkspace,
} from './review-workspace';

const DRAFT: FollowupDraft = {
  draftId: 'draft-ada-1',
  patient: { id: 'patient-1', display: 'Ada Lovelace' },
  title: 'Follow up potassium',
  rationale: 'Repeat the BMP in clinic after the high potassium result.',
  priority: 'high',
  dueAt: '2026-09-01T09:00:00.000Z',
  assignee: { id: 'person-dr-chen', display: 'Dr. Chen', type: 'person' },
  sourceReference: 'Observation/obs-1',
};

const SOURCE: ResultSummary = {
  id: 'obs-1',
  patient: { id: 'patient-1', display: 'Ada Lovelace' },
  name: 'Potassium',
  observedAt: '2026-08-31T04:00:00.000Z',
  interpretation: 'high',
  sourceReference: 'Observation/obs-1',
};

const CREATED: FollowupSummary = {
  id: 'task-1',
  patient: DRAFT.patient,
  title: DRAFT.title,
  status: 'not-started',
  priority: 'high',
  sourceReference: DRAFT.sourceReference,
};

const DISABLED_COPY: Record<string, string> = {
  'stale-source': 'The source result is no longer available.',
  'patient-mismatch': 'The source result belongs to a different patient.',
  'lost-privilege': 'You no longer have permission to confirm follow-ups.',
  'duplicate-active': 'An active follow-up already exists for this source.',
  offline: 'You are offline. Confirmation is unavailable.',
};

let unbindWorkspace: (() => void) | null = null;

afterEach(() => {
  unbindWorkspace?.();
  unbindWorkspace = null;
  resetConfirmationControllers();
  clearAgentActivity();
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

describe('ReviewQueue', () => {
  it('explains an empty queue instead of rendering a blank section', () => {
    render(<ReviewQueue drafts={[]} adapterId="openmrs" ports={stubPorts()} />);
    expect(screen.getByTestId('review-queue-empty')).toHaveTextContent('Nothing to confirm yet');
    expect(screen.queryByTestId('review-item')).not.toBeInTheDocument();
    expect(screen.queryByTestId('confirmed-followup')).not.toBeInTheDocument();
  });

  it('keeps a confirmed notice after the last draft leaves the queue', () => {
    recordConfirmedFollowup({ patient: 'Ada Lovelace', title: 'Follow up potassium' });
    render(<ReviewQueue drafts={[]} adapterId="openmrs" ports={stubPorts()} />);
    expect(screen.getByTestId('confirmed-followup')).toHaveTextContent('Follow-up confirmed for Ada Lovelace');
    expect(screen.getByTestId('review-queue-empty')).toBeInTheDocument();
  });

  it('shows patient identity, source evidence, proposal, assignee, priority, due date, and provenance', async () => {
    renderQueue();

    expect(screen.getByTestId('review-item-patient')).toHaveTextContent('Ada Lovelace');
    expect(screen.getByTestId('review-item-patient')).toHaveTextContent('patient-1');
    expect(screen.getByTestId('review-item-source')).toHaveTextContent('Observation/obs-1');
    expect(screen.getByTestId('review-item-title')).toHaveTextContent('Follow up potassium');
    expect(screen.getByTestId('review-item-rationale')).toHaveTextContent(
      'Repeat the BMP in clinic after the high potassium result.',
    );
    expect(screen.getByTestId('review-item-assignee')).toHaveTextContent('Dr. Chen');
    expect(screen.getByTestId('review-item-priority')).toHaveTextContent('high');
    expect(screen.getByTestId('review-item-due-at')).toHaveTextContent('2026-09-01T09:00:00.000Z');
    expect(screen.getByTestId('review-item-provenance')).toHaveTextContent('emr-webmcp');
    expect(screen.getByTestId('review-item-provenance')).toHaveTextContent('openmrs');

    await waitFor(() => {
      expect(confirmButton()).toBeEnabled();
    });
  });

  it('disables confirmation for stale-source when the result is no longer retrievable', async () => {
    renderQueue({
      getResult: () => Promise.reject(new AdapterError('not-found', 'Result was not found.', false)),
    });

    await expectDisabled('stale-source');
  });

  it('disables confirmation for patient-mismatch when the source belongs to another patient', async () => {
    renderQueue({
      getResult: () =>
        Promise.resolve({
          ...SOURCE,
          patient: { id: 'patient-3', display: 'Grace Hopper' },
        }),
    });

    await expectDisabled('patient-mismatch');
  });

  it('disables confirmation for lost-privilege when the session cannot create follow-ups', async () => {
    renderQueue({
      isAuthenticated: () => false,
      hasUsePrivilege: () => false,
    });

    await expectDisabled('lost-privilege');
  });

  it('disables confirmation for duplicate-active when an active follow-up is already correlated', async () => {
    renderQueue({
      listFollowups: () =>
        Promise.resolve([
          {
            ...CREATED,
            status: 'in-progress',
          },
        ]),
    });

    await expectDisabled('duplicate-active');
  });

  it('disables confirmation for offline when navigator is offline', async () => {
    renderQueue({ isOnline: () => false });

    await expectDisabled('offline');
  });

  it('shows a localized disable reason and describes the Confirm button', async () => {
    renderQueue({ isOnline: () => false });

    await expectDisabled('offline');
    expect(confirmButton()).toHaveAttribute('aria-describedby', 'confirm-reason-draft-ada-1');
  });
});

describe('confirmation controller', () => {
  it('walks idle -> validating -> ready -> committing -> succeeded and consumes only after success', async () => {
    const consume = vi.fn(() => DRAFT);
    const createFollowup = vi.fn(() => Promise.resolve(CREATED));
    const controller = createConfirmationController(
      stubPorts({
        consume,
        createFollowup,
      }),
    );

    expect(controller.snapshot().phase).toBe('idle');
    const validated = controller.validate(DRAFT.draftId);
    expect(controller.snapshot().phase).toBe('validating');
    await validated;
    expect(controller.snapshot()).toEqual({ phase: 'ready', disabledReason: null, error: null });

    const committed = controller.confirm(DRAFT.draftId);
    expect(controller.snapshot().phase).toBe('committing');
    expect(consume).not.toHaveBeenCalled();
    await committed;

    expect(controller.snapshot().phase).toBe('succeeded');
    expect(createFollowup).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(createFollowup.mock.invocationCallOrder[0]).toBeLessThan(consume.mock.invocationCallOrder[0] ?? 0);
  });

  it('ignores clicks while validating or committing and leaves the draft peekable on failure', async () => {
    let finishCreate!: (result: FollowupSummary) => void;
    const consume = vi.fn(() => DRAFT);
    const createFollowup = vi.fn(
      () =>
        new Promise<FollowupSummary>((resolve) => {
          finishCreate = resolve;
        }),
    );
    const controller = createConfirmationController(
      stubPorts({
        consume,
        createFollowup,
      }),
    );

    const firstValidate = controller.validate(DRAFT.draftId);
    controller.validate(DRAFT.draftId);
    controller.confirm(DRAFT.draftId);
    await firstValidate;
    expect(controller.snapshot().phase).toBe('ready');
    expect(createFollowup).not.toHaveBeenCalled();

    const firstConfirm = controller.confirm(DRAFT.draftId);
    expect(controller.snapshot().phase).toBe('committing');
    controller.confirm(DRAFT.draftId);
    await waitFor(() => {
      expect(createFollowup).toHaveBeenCalledTimes(1);
    });
    finishCreate(CREATED);
    await firstConfirm;
    expect(controller.snapshot().phase).toBe('succeeded');
    expect(consume).toHaveBeenCalledTimes(1);

    const peek = vi.fn(() => DRAFT);
    const failing = createConfirmationController(
      stubPorts({
        peek,
        consume,
        createFollowup: () => Promise.reject(new AdapterError('upstream', 'Upstream request failed', true)),
      }),
    );
    await failing.validate(DRAFT.draftId);
    await failing.confirm(DRAFT.draftId);
    expect(failing.snapshot()).toEqual({ phase: 'failed', disabledReason: null, error: 'upstream' });
    expect(peek.mock.results.at(-1)?.value).toMatchObject({ draftId: DRAFT.draftId });
  });

  it('does not consume the draft when createFollowup fails and records the typed error', async () => {
    const consume = vi.fn(() => DRAFT);
    const peek = vi.fn(() => DRAFT);
    const controller = createConfirmationController(
      stubPorts({
        peek,
        consume,
        createFollowup: () => Promise.reject(new AdapterError('conflict', 'An active follow-up already exists.', false)),
      }),
    );

    await controller.validate(DRAFT.draftId);
    await controller.confirm(DRAFT.draftId);

    expect(controller.snapshot()).toEqual({ phase: 'failed', disabledReason: null, error: 'conflict' });
    expect(consume).not.toHaveBeenCalled();
    expect(peek).toHaveBeenCalled();
  });

  it('retries from failed by re-validating, mapping conflict to duplicate-active', async () => {
    const consume = vi.fn(() => DRAFT);
    const createFollowup = vi.fn(() =>
      Promise.reject(new AdapterError('conflict', 'An active follow-up already exists.', false)),
    );
    const followups: FollowupSummary[] = [];
    const controller = createConfirmationController(
      stubPorts({
        consume,
        createFollowup,
        listFollowups: () => Promise.resolve([...followups]),
      }),
    );

    await controller.validate(DRAFT.draftId);
    await controller.confirm(DRAFT.draftId);
    expect(controller.snapshot()).toEqual({ phase: 'failed', disabledReason: null, error: 'conflict' });

    followups.push({ ...CREATED, status: 'not-started' });
    await controller.confirm(DRAFT.draftId);

    expect(controller.snapshot()).toEqual({
      phase: 'idle',
      disabledReason: 'duplicate-active',
      error: null,
    });
    expect(createFollowup).toHaveBeenCalledTimes(1);
    expect(consume).not.toHaveBeenCalled();
  });

  it('retries a transient failure from failed and succeeds on the second confirm', async () => {
    const consume = vi.fn(() => DRAFT);
    const createFollowup = vi
      .fn()
      .mockRejectedValueOnce(new AdapterError('upstream', 'Upstream request failed', true))
      .mockResolvedValueOnce(CREATED);
    const controller = createConfirmationController(
      stubPorts({
        consume,
        createFollowup,
      }),
    );

    await controller.validate(DRAFT.draftId);
    await controller.confirm(DRAFT.draftId);
    expect(controller.snapshot().error).toBe('upstream');

    await controller.confirm(DRAFT.draftId);
    expect(controller.snapshot()).toEqual({ phase: 'succeeded', disabledReason: null, error: null });
    expect(createFollowup).toHaveBeenCalledTimes(2);
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it('never stays in validating when peek throws', async () => {
    const controller = createConfirmationController(
      stubPorts({
        peek: () => {
          throw new AdapterError('not-found', 'Draft was not found.', false);
        },
      }),
    );

    await controller.validate(DRAFT.draftId);
    expect(controller.snapshot()).toEqual({ phase: 'failed', disabledReason: null, error: 'not-found' });
  });

  it('re-checks disabled reasons before committing', async () => {
    let online = true;
    const createFollowup = vi.fn(() => Promise.resolve(CREATED));
    const controller = createConfirmationController(
      stubPorts({
        createFollowup,
        isOnline: () => online,
      }),
    );

    await controller.validate(DRAFT.draftId);
    expect(controller.snapshot().phase).toBe('ready');
    online = false;

    await controller.confirm(DRAFT.draftId);
    expect(controller.snapshot()).toEqual({ phase: 'idle', disabledReason: 'offline', error: null });
    expect(createFollowup).not.toHaveBeenCalled();
  });

  it('surfaces getResult upstream as a typed failure instead of stale-source', async () => {
    const controller = createConfirmationController(
      stubPorts({
        getResult: () => Promise.reject(new AdapterError('upstream', 'Upstream request failed', true)),
      }),
    );

    await controller.validate(DRAFT.draftId);
    expect(controller.snapshot()).toEqual({ phase: 'failed', disabledReason: null, error: 'upstream' });
  });

  it('surfaces listFollowups failure as a typed failure instead of enabling confirm', async () => {
    const controller = createConfirmationController(
      stubPorts({
        listFollowups: () => Promise.reject(new AdapterError('upstream', 'Upstream request failed', true)),
      }),
    );

    await controller.validate(DRAFT.draftId);
    expect(controller.snapshot()).toEqual({ phase: 'failed', disabledReason: null, error: 'upstream' });
  });
});

describe('visible confirmation', () => {
  it('posts exactly once from a visible click and ignores a second click', async () => {
    let finishCreate!: (result: FollowupSummary) => void;
    const consume = vi.fn(() => DRAFT);
    const createFollowup = vi.fn(
      () =>
        new Promise<FollowupSummary>((resolve) => {
          finishCreate = resolve;
        }),
    );
    renderQueue({ consume, createFollowup });
    await waitFor(() => {
      expect(confirmButton()).toBeEnabled();
    });

    const user = userEvent.setup();
    await user.click(confirmButton());
    await user.click(confirmButton());
    expect(createFollowup).toHaveBeenCalledTimes(1);
    expect(consume).not.toHaveBeenCalled();

    finishCreate(CREATED);
    await waitFor(() => {
      expect(confirmButton()).toHaveAttribute('data-confirmation-state', 'succeeded');
    });
    expect(consume).toHaveBeenCalledTimes(1);
    const posted = createFollowup.mock.calls[0] as unknown as [ConfirmedFollowup] | undefined;
    expect(toConfirmed(posted?.[0])).toMatchObject({
      patient: DRAFT.patient,
      title: DRAFT.title,
      sourceReference: DRAFT.sourceReference,
    });
  });

  it('shows a localized failure reason after a refused confirm', async () => {
    renderQueue({
      createFollowup: () => Promise.reject(new AdapterError('upstream', 'Upstream request failed', true)),
    });
    await waitFor(() => {
      expect(confirmButton()).toBeEnabled();
    });

    await userEvent.setup().click(confirmButton());
    await waitFor(() => {
      expect(confirmButton()).toHaveAttribute('data-confirmation-state', 'failed');
    });
    expect(screen.getByTestId('confirm-reason')).toHaveTextContent(
      'Confirmation failed because the server could not be reached. You can try again.',
    );
    expect(confirmButton()).toHaveAttribute('aria-describedby', 'confirm-reason-draft-ada-1');
  });

  it('enables confirm after upstream failure and retries on second click', async () => {
    const createFollowup = vi
      .fn()
      .mockRejectedValueOnce(new AdapterError('upstream', 'Upstream request failed', true))
      .mockResolvedValueOnce(CREATED);
    renderQueue({ createFollowup });
    await waitFor(() => {
      expect(confirmButton()).toBeEnabled();
    });

    const user = userEvent.setup();
    await user.click(confirmButton());
    await waitFor(() => {
      expect(confirmButton()).toHaveAttribute('data-confirmation-state', 'failed');
    });
    expect(confirmButton()).toBeEnabled();

    await user.click(confirmButton());
    await waitFor(() => {
      expect(confirmButton()).toHaveAttribute('data-confirmation-state', 'succeeded');
    });
    expect(createFollowup).toHaveBeenCalledTimes(2);
  });

  it('re-validates when the browser goes offline after mount', async () => {
    let online = true;
    renderQueue({ isOnline: () => online });
    await waitFor(() => {
      expect(confirmButton()).toBeEnabled();
    });

    online = false;
    window.dispatchEvent(new Event('offline'));
    await expectDisabled('offline');
  });
});

describe('review workspace controller lifetime', () => {
  it('keeps a committing controller across notifyReviewWorkspace and posts once', async () => {
    let finishCreate!: (result: FollowupSummary) => void;
    const createFollowup = vi.fn(
      () =>
        new Promise<FollowupSummary>((resolve) => {
          finishCreate = resolve;
        }),
    );
    const unbind = bindWorkspace({ createFollowup });
    render(<BoundQueue />);
    await waitFor(() => {
      expect(confirmButton()).toBeEnabled();
    });

    await userEvent.setup().click(confirmButton());
    expect(createFollowup).toHaveBeenCalledTimes(1);

    notifyReviewWorkspace();
    await waitFor(() => {
      expect(confirmButton()).toHaveAttribute('data-confirmation-state', 'committing');
    });
    expect(confirmButton()).toBeDisabled();

    await userEvent.setup().click(confirmButton());
    expect(createFollowup).toHaveBeenCalledTimes(1);

    finishCreate(CREATED);
    await waitFor(() => {
      expect(createFollowup).toHaveBeenCalledTimes(1);
    });
    unbind();
  });

  it('shows a confirmed notice after a successful workspace confirm empties the queue', async () => {
    const unbind = bindWorkspace();
    render(<BoundQueue />);
    await waitFor(() => {
      expect(confirmButton()).toBeEnabled();
    });
    await userEvent.setup().click(confirmButton());
    await waitFor(() => {
      expect(screen.getByTestId('confirmed-followup')).toHaveTextContent('Follow-up confirmed for Ada Lovelace');
    });
    expect(screen.getByTestId('review-queue-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('review-item')).not.toBeInTheDocument();
    unbind();
  });

  it('refreshes lost-privilege when session privileges change after mount', async () => {
    let privileges: ReadonlySet<string> = new Set([USE_PRIVILEGE]);
    const unbind = bindWorkspace({
      getPrivileges: () => privileges,
    });
    render(<BoundQueue />);
    await waitFor(() => {
      expect(confirmButton()).toBeEnabled();
    });

    privileges = new Set();
    notifyReviewWorkspace();
    await expectDisabled('lost-privilege');
    unbind();
  });
});

function BoundQueue(): React.ReactElement {
  const workspace = useReviewWorkspace();
  return <ReviewQueue drafts={workspace.drafts} adapterId={workspace.adapterId} ports={workspace.ports} />;
}

function bindWorkspace(
  overrides: {
    createFollowup?: ConfirmationPorts['createFollowup'];
    getPrivileges?: () => ReadonlySet<string>;
  } = {},
): () => void {
  const store = new DraftStore({
    userId: 'user-1',
    now: () => new Date('2026-08-31T04:00:00.000Z'),
    randomUUID: () => DRAFT.draftId,
  });
  store.stage({
    patient: DRAFT.patient,
    title: DRAFT.title,
    rationale: DRAFT.rationale,
    priority: DRAFT.priority,
    dueAt: DRAFT.dueAt,
    assignee: DRAFT.assignee,
    sourceReference: DRAFT.sourceReference,
  });

  const adapter = {
    id: 'openmrs',
    getResult: () => Promise.resolve(SOURCE),
    listFollowups: () => Promise.resolve([]),
    createFollowup: overrides.createFollowup ?? (() => Promise.resolve(CREATED)),
  } as unknown as EmrAdapter;

  unbindWorkspace = bindReviewWorkspace({
    getStore: () => store,
    getAdapter: () => adapter,
    getSession: () => ({ authenticated: true, userId: 'user-1' }),
    getPrivileges: overrides.getPrivileges ?? (() => new Set([USE_PRIVILEGE])),
  });
  return unbindWorkspace;
}

function renderQueue(overrides: Partial<ConfirmationPorts> = {}) {
  const ports = stubPorts(overrides);
  return render(<ReviewQueue drafts={[DRAFT]} adapterId="openmrs" ports={ports} />);
}

function stubPorts(overrides: Partial<ConfirmationPorts> = {}): ConfirmationPorts {
  return {
    peek: () => DRAFT,
    consume: () => DRAFT,
    getResult: () => Promise.resolve(SOURCE),
    listFollowups: () => Promise.resolve([]),
    createFollowup: () => Promise.resolve(CREATED),
    isAuthenticated: () => true,
    hasUsePrivilege: () => true,
    isOnline: () => true,
    ...overrides,
  };
}

function confirmButton(): HTMLElement {
  return screen.getByTestId('confirm-followup');
}

async function expectDisabled(reason: string): Promise<void> {
  await waitFor(() => {
    expect(confirmButton()).toBeDisabled();
  });
  expect(confirmButton()).toHaveAttribute('data-disabled-reason', reason);
  expect(screen.getByTestId('confirm-reason')).toHaveTextContent(DISABLED_COPY[reason] ?? reason);
  expect(confirmButton()).toHaveAttribute('aria-describedby', 'confirm-reason-draft-ada-1');
}

function toConfirmed(input: ConfirmedFollowup | undefined): ConfirmedFollowup | undefined {
  return input;
}
