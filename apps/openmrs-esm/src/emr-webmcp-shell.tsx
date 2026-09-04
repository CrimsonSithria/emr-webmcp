import React from 'react';
import { Layer, Tile } from '@carbon/react';
import { useTranslation } from 'react-i18next';
import type { EmrAdapter } from '@emr-webmcp/core';
import styles from './emr-webmcp.scss';
import { agentActivityTitle, useAgentActivity } from './webmcp/agent-activity';
import { hasDocumentModelContext } from './webmcp/document-model-context';

export type SessionPort = {
  userId: string | null;
  privileges: ReadonlySet<string>;
  patientId: string | null;
};

export type EmrWebmcpShellProps = {
  adapter: Pick<EmrAdapter, 'id'>;
  session: SessionPort;
};

export const EmrWebmcpShell: React.FC<EmrWebmcpShellProps> = ({ adapter }) => {
  const { t } = useTranslation();
  const hostReady = hasDocumentModelContext();
  const { activity } = useAgentActivity();

  return (
    <div className={styles.container} data-testid="emr-webmcp-shell">
      <Layer>
        <Tile className={styles.tile}>
          <h1 className={styles.heading}>{t('pageTitle', 'LabLatch')}</h1>
          <p className={styles.content}>
            {t('pageSubtitle', 'The agent hunts unlatched labs. You confirm the only chart write.')}
          </p>
          {hostReady ? (
            <p className={styles.content} data-testid="webmcp-host-ready">
              {t(
                'webmcpHostReady',
                'This page registered tools with the browser. An agent can hunt here; drafts appear in the queue below.',
              )}
            </p>
          ) : (
            <p className={styles.content} data-testid="webmcp-compat-notice">
              {t(
                'webmcpUnavailable',
                'This browser does not expose WebMCP. Open this page in Chrome with the WebMCP flag to let an agent call tools. The review queue below still works.',
              )}
            </p>
          )}
          <p className={styles.content} data-testid="webmcp-adapter">
            {`${t('adapterLabel', 'Adapter')}: ${adapter.id}`}
          </p>
          <section className={styles.activity} data-testid="agent-activity">
            <h2 className={styles.activityHeading}>{t('agentActivityTitle', 'Agent activity')}</h2>
            {activity === null ? (
              <p className={styles.activityIdle} data-testid="agent-activity-idle">
                {t('agentActivityIdle', 'Waiting for an agent tool call on this page.')}
              </p>
            ) : (
              <>
                <p className={styles.activityTitle} data-testid="agent-activity-tool">
                  {agentActivityTitle(activity.tool)}
                </p>
                <p className={styles.activityPhase} data-testid="agent-activity-phase" data-phase={activity.phase}>
                  {activityPhaseLabel(t, activity.phase)}
                </p>
                <ul className={styles.activityLines} data-testid="agent-activity-lines">
                  {activity.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </Tile>
      </Layer>
    </div>
  );
};

function activityPhaseLabel(
  t: (key: string, defaultValue: string) => string,
  phase: 'running' | 'done' | 'failed',
): string {
  if (phase === 'running') {
    return t('agentActivityWorking', 'Working');
  }
  if (phase === 'failed') {
    return t('agentActivityFailed', 'Failed');
  }
  return t('agentActivityDone', 'Done');
}
