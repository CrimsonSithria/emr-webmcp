import { Button, Tag } from '@carbon/react';
import type { FollowupDraft, ToolErrorCode } from '@emr-webmcp/core';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getOrCreateConfirmationController,
  type ConfirmationPorts,
  type ConfirmationSnapshot,
  type DisabledReason,
} from './confirmation-controller';
import { subscribeReviewWorkspace } from './review-workspace';
import styles from './review.scss';

export type ReviewItemProps = {
  draft: FollowupDraft;
  adapterId: string;
  ports: ConfirmationPorts;
};

export const ReviewItem: React.FC<ReviewItemProps> = ({ draft, adapterId, ports }) => {
  const { t } = useTranslation();
  const controller = getOrCreateConfirmationController(draft.draftId, ports);
  const [snapshot, setSnapshot] = useState<ConfirmationSnapshot>(controller.snapshot);
  const reasonId = `confirm-reason-${draft.draftId}`;
  const reasonText = confirmationReasonText(t, snapshot);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    void controller.validate(draft.draftId);
    return unsubscribe;
  }, [controller, draft.draftId]);

  useEffect(() => {
    const refresh = (): void => {
      void controller.validate(draft.draftId);
    };
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    const unsubscribeWorkspace = subscribeReviewWorkspace(refresh);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      unsubscribeWorkspace();
    };
  }, [controller, draft.draftId]);

  const disabled =
    snapshot.disabledReason !== null ||
    (snapshot.phase !== 'ready' && snapshot.phase !== 'failed');

  return (
    <article className={styles.item} data-testid="review-item" data-draft-id={draft.draftId}>
      <p className={styles.itemEyebrow}>{t('reviewItemEyebrow', 'Staged by the agent — not in the chart yet')}</p>
      <p className={styles.field} data-testid="review-item-patient">
        {t('reviewItemPatient', 'Patient')}: {draft.patient.display} ({draft.patient.id})
      </p>
      <p className={styles.field} data-testid="review-item-source">
        {t('reviewItemSource', 'Source')}: {draft.sourceReference ?? t('noSourceEvidence', 'No source evidence')}
      </p>
      <p className={styles.field} data-testid="review-item-title">
        {t('reviewItemTitle', 'Proposed follow-up')}: {draft.title}
      </p>
      <p className={styles.field} data-testid="review-item-rationale">
        {t('reviewItemRationale', 'Why')}: {draft.rationale}
      </p>
      <p className={styles.field} data-testid="review-item-assignee">
        {t('reviewItemAssignee', 'Assignee')}: {draft.assignee?.display ?? t('unassigned', 'Unassigned')}
      </p>
      <p className={styles.field} data-testid="review-item-priority">
        {t('reviewItemPriority', 'Priority')}: {draft.priority}
      </p>
      <p className={styles.field} data-testid="review-item-due-at">
        {t('reviewItemDue', 'Due')}: {draft.dueAt ?? t('noDueDate', 'No due date')}
      </p>
      <p className={styles.field} data-testid="review-item-provenance">
        emr-webmcp / {adapterId}
      </p>
      <div className={styles.actions}>
        <Tag type={snapshot.phase === 'succeeded' ? 'green' : 'gray'}>{snapshot.phase}</Tag>
        <Button
          kind="primary"
          size="sm"
          disabled={disabled}
          data-testid="confirm-followup"
          data-disabled-reason={snapshot.disabledReason ?? undefined}
          data-confirmation-state={snapshot.phase}
          data-error-code={snapshot.error ?? undefined}
          aria-describedby={reasonText === null ? undefined : reasonId}
          onClick={() => {
            void controller.confirm(draft.draftId);
          }}
        >
          {t('confirmFollowup', 'Confirm follow-up')}
        </Button>
      </div>
      {reasonText !== null && (
        <p className={styles.reason} id={reasonId} data-testid="confirm-reason">
          {reasonText}
        </p>
      )}
    </article>
  );
};

function confirmationReasonText(
  t: (key: string, defaultValue: string) => string,
  snapshot: ConfirmationSnapshot,
): string | null {
  if (snapshot.disabledReason !== null) {
    return t(disabledReasonKey(snapshot.disabledReason), disabledReasonDefault(snapshot.disabledReason));
  }
  if (snapshot.phase === 'failed' && snapshot.error !== null) {
    return t(errorReasonKey(snapshot.error), errorReasonDefault(snapshot.error));
  }
  return null;
}

function disabledReasonKey(reason: DisabledReason): string {
  switch (reason) {
    case 'stale-source':
      return 'disabledStaleSource';
    case 'patient-mismatch':
      return 'disabledPatientMismatch';
    case 'lost-privilege':
      return 'disabledLostPrivilege';
    case 'duplicate-active':
      return 'disabledDuplicateActive';
    case 'offline':
      return 'disabledOffline';
  }
}

function disabledReasonDefault(reason: DisabledReason): string {
  switch (reason) {
    case 'stale-source':
      return 'The source result is no longer available.';
    case 'patient-mismatch':
      return 'The source result belongs to a different patient.';
    case 'lost-privilege':
      return 'You no longer have permission to confirm follow-ups.';
    case 'duplicate-active':
      return 'An active follow-up already exists for this source.';
    case 'offline':
      return 'You are offline. Confirmation is unavailable.';
  }
}

function errorReasonKey(code: ToolErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'failedUnauthorized';
    case 'unsupported':
      return 'failedUnsupported';
    case 'not-found':
      return 'failedNotFound';
    case 'invalid-input':
      return 'failedInvalidInput';
    case 'conflict':
      return 'failedConflict';
    case 'upstream':
      return 'failedUpstream';
  }
}

function errorReasonDefault(code: ToolErrorCode): string {
  switch (code) {
    case 'unauthorized':
      return 'Confirmation was refused because you are not authorized.';
    case 'unsupported':
      return 'Confirmation is not supported.';
    case 'not-found':
      return 'The draft or source could not be found.';
    case 'invalid-input':
      return 'The follow-up could not be confirmed because the input is invalid.';
    case 'conflict':
      return 'An active follow-up already exists for this source.';
    case 'upstream':
      return 'Confirmation failed because the server could not be reached. You can try again.';
  }
}
