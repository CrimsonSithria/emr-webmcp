import React from 'react';
import { useTranslation } from 'react-i18next';

import { EmrWebmcpShell, type SessionPort } from './emr-webmcp-shell';
import styles from './emr-webmcp.scss';
import { hasDocumentModelContext } from './webmcp/document-model-context';

const placeholderSession: SessionPort = {
  userId: null,
  privileges: new Set<string>(),
  patientId: null,
};

const EmrWebmcp: React.FC = () => {
  const { t } = useTranslation();

  return (
    <>
      {!hasDocumentModelContext() && (
        <p className={styles.content} data-testid="webmcp-compat-notice">
          {t('webmcpUnavailable', 'This browser does not expose WebMCP. The module remains available.')}
        </p>
      )}
      <EmrWebmcpShell adapter={{ id: 'openmrs' }} session={placeholderSession} />
    </>
  );
};

export default EmrWebmcp;
