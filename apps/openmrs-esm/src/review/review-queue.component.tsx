import type { FollowupDraft } from '@emr-webmcp/core';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { readConfirmedFollowup } from '../webmcp/agent-activity';
import type { ConfirmationPorts } from './confirmation-controller';
import { ReviewItem } from './review-item.component';
import styles from './review.scss';

export type ReviewQueueProps = {
  drafts: FollowupDraft[];
  adapterId: string;
  ports: ConfirmationPorts | null;
};

export const ReviewQueue: React.FC<ReviewQueueProps> = ({ drafts, adapterId, ports }) => {
  const { t } = useTranslation();
  const confirmed = readConfirmedFollowup();

  return (
    <section className={styles.queue} data-testid="review-queue">
      <h2 className={styles.queueHeading}>{t('reviewQueueTitle', 'Review queue')}</h2>
      {confirmed !== null && drafts.length === 0 ? (
        <p className={styles.confirmed} data-testid="confirmed-followup">
          {t(
            'confirmedFollowup',
            'Follow-up confirmed for {{patient}}. That draft is now a chart task.',
          ).replaceAll('{{patient}}', confirmed.patient)}
        </p>
      ) : null}
      {drafts.length === 0 ? (
        <p className={styles.empty} data-testid="review-queue-empty">
          {t(
            'emptyQueue',
            'Nothing to confirm yet. When an agent stages a follow-up, the draft appears here.',
          )}
        </p>
      ) : ports === null ? null : (
        drafts.map((draft) => (
          <ReviewItem key={draft.draftId} draft={draft} adapterId={adapterId} ports={ports} />
        ))
      )}
    </section>
  );
};
