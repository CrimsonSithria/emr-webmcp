import React from 'react';

import { EmrWebmcpShell, type SessionPort } from './emr-webmcp-shell';
import { ReviewQueue } from './review/review-queue.component';
import { useReviewWorkspace } from './review/review-workspace';

const placeholderSession: SessionPort = {
  userId: null,
  privileges: new Set<string>(),
  patientId: null,
};

const EmrWebmcp: React.FC = () => {
  const workspace = useReviewWorkspace();

  return (
    <>
      <EmrWebmcpShell adapter={{ id: workspace.adapterId }} session={placeholderSession} />
      <ReviewQueue drafts={workspace.drafts} adapterId={workspace.adapterId} ports={workspace.ports} />
    </>
  );
};

export default EmrWebmcp;
