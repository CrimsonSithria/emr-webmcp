import type { EmrCapability } from '@emr-webmcp/core';
import { openmrsFetch, usePatient, useSession } from '@openmrs/esm-framework';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmrWebmcpShell, type SessionPort } from './emr-webmcp-shell';
import styles from './emr-webmcp.scss';
import { createO3OpenmrsAdapter, privilegesFromSession, wrapOpenmrsFetch } from './openmrs/adapter-factory';
import { createDefaultCapabilityProbe } from './openmrs/capability-probe';
import { hasDocumentModelContext } from './webmcp/document-model-context';
import { useWebmcpRegistration } from './webmcp/use-webmcp-registration';

const EmrWebmcp: React.FC = () => {
  const { t } = useTranslation();
  const session = useSession();
  const { patientUuid } = usePatient();
  const authenticated = session.authenticated === true;
  const userId = session.user?.uuid ?? null;
  const privileges = useMemo(() => privilegesFromSession(authenticated), [authenticated]);
  const patientIdRef = useRef<string | null>(patientUuid ?? null);
  patientIdRef.current = patientUuid ?? null;

  const fetch = useMemo(() => wrapOpenmrsFetch(openmrsFetch), []);
  const adapter = useMemo(
    () =>
      createO3OpenmrsAdapter({
        fetch,
        getActivePatientId: () => patientIdRef.current,
      }),
    [fetch],
  );

  const [capabilities, setCapabilities] = useState<ReadonlySet<EmrCapability>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    const probe = createDefaultCapabilityProbe({
      fetch,
      isAuthenticated: () => authenticated,
    });
    void probe().then((next) => {
      if (!cancelled) {
        setCapabilities(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authenticated, fetch]);

  const [routeContext, setRouteContext] = useState(() => window.location.pathname);
  useEffect(() => {
    const sync = () => setRouteContext(window.location.pathname);
    window.addEventListener('single-spa:routing-event', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('single-spa:routing-event', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  useWebmcpRegistration({
    session: { authenticated, userId },
    privileges,
    capabilities,
    routeContext,
    adapter,
  });

  const sessionPort: SessionPort = {
    userId,
    privileges,
    patientId: patientUuid ?? null,
  };

  return (
    <>
      {!hasDocumentModelContext() && (
        <p className={styles.content} data-testid="webmcp-compat-notice">
          {t('webmcpUnavailable', 'This browser does not expose WebMCP. The module remains available.')}
        </p>
      )}
      <EmrWebmcpShell adapter={{ id: adapter.id }} session={sessionPort} />
    </>
  );
};

export default EmrWebmcp;
