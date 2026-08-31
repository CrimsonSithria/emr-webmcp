import {
  AdapterError,
  type ConfirmedFollowup,
  type FollowupDraft,
  type FollowupSummary,
  type ResultSummary,
} from '@emr-webmcp/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  createConfirmationController,
  type ConfirmationPorts,
} from './confirmation-controller';
import { ReviewQueue } from './review-queue.component';

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

describe('ReviewQueue', () => {
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
    expect(controller.snapshot()).toEqual({ phase: 'ready', disabledReason: null });

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
    controller.confirm(DRAFT.draftId);
    expect(createFollowup).toHaveBeenCalledTimes(1);
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
    expect(failing.snapshot().phase).toBe('failed');
    expect(peek.mock.results.at(-1)?.value).toMatchObject({ draftId: DRAFT.draftId });
  });

  it('does not consume the draft when createFollowup fails', async () => {
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

    expect(controller.snapshot().phase).toBe('failed');
    expect(consume).not.toHaveBeenCalled();
    expect(peek).toHaveBeenCalled();
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
});

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
}

function toConfirmed(input: ConfirmedFollowup | undefined): ConfirmedFollowup | undefined {
  return input;
}
