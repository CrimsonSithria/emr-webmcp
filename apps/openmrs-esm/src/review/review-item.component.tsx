import { Button, Tag } from '@carbon/react';
import type { FollowupDraft } from '@emr-webmcp/core';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  createConfirmationController,
  type ConfirmationPorts,
  type ConfirmationSnapshot,
} from './confirmation-controller';
import styles from './review.scss';

export type ReviewItemProps = {
  draft: FollowupDraft;
  adapterId: string;
  ports: ConfirmationPorts;
};

export const ReviewItem: React.FC<ReviewItemProps> = ({ draft, adapterId, ports }) => {
  const { t } = useTranslation();
  const controller = useMemo(() => createConfirmationController(ports), [ports]);
  const [snapshot, setSnapshot] = useState<ConfirmationSnapshot>(controller.snapshot);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    void controller.validate(draft.draftId);
    return unsubscribe;
  }, [controller, draft.draftId]);

  const disabled = snapshot.phase !== 'ready';

  return (
    <article className={styles.item} data-testid="review-item" data-draft-id={draft.draftId}>
      <p className={styles.field} data-testid="review-item-patient">
        {draft.patient.display} ({draft.patient.id})
      </p>
      <p className={styles.field} data-testid="review-item-source">
        {draft.sourceReference ?? t('noSourceEvidence', 'No source evidence')}
      </p>
      <p className={styles.field} data-testid="review-item-title">
        {draft.title}
      </p>
      <p className={styles.field} data-testid="review-item-rationale">
        {draft.rationale}
      </p>
      <p className={styles.field} data-testid="review-item-assignee">
        {draft.assignee?.display ?? t('unassigned', 'Unassigned')}
      </p>
      <p className={styles.field} data-testid="review-item-priority">
        {draft.priority}
      </p>
      <p className={styles.field} data-testid="review-item-due-at">
        {draft.dueAt ?? t('noDueDate', 'No due date')}
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
          onClick={() => {
            void controller.confirm(draft.draftId);
          }}
        >
          {t('confirmFollowup', 'Confirm follow-up')}
        </Button>
      </div>
    </article>
  );
};
