import type { FollowupDraft } from '@emr-webmcp/core';
import React from 'react';

import type { ConfirmationPorts } from './confirmation-controller';
import { ReviewItem } from './review-item.component';
import styles from './review.scss';

export type ReviewQueueProps = {
  drafts: FollowupDraft[];
  adapterId: string;
  ports: ConfirmationPorts | null;
};

export const ReviewQueue: React.FC<ReviewQueueProps> = ({ drafts, adapterId, ports }) => (
  <section className={styles.queue} data-testid="review-queue">
    {ports === null
      ? null
      : drafts.map((draft) => (
          <ReviewItem key={draft.draftId} draft={draft} adapterId={adapterId} ports={ports} />
        ))}
  </section>
);
