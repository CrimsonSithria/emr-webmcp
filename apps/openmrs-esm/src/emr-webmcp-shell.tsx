import React from 'react';
import { Layer, Tile } from '@carbon/react';
import type { EmrAdapter } from '@emr-webmcp/core';
import styles from './emr-webmcp.scss';

export type SessionPort = {
  userId: string | null;
  privileges: ReadonlySet<string>;
  patientId: string | null;
};

export type EmrWebmcpShellProps = {
  adapter: Pick<EmrAdapter, 'id'>;
  session: SessionPort;
};

export const EmrWebmcpShell: React.FC<EmrWebmcpShellProps> = ({ adapter, session }) => (
  <div className={styles.container} data-testid="emr-webmcp-shell">
    <Layer>
      <Tile className={styles.tile}>
        <p className={styles.content} data-testid="adapter-id">
          {adapter.id}
        </p>
        <p className={styles.content} data-testid="session-user-id">
          {session.userId ?? ''}
        </p>
        <p className={styles.content} data-testid="session-patient-id">
          {session.patientId ?? ''}
        </p>
        <ul className={styles.content} data-testid="session-privileges">
          {[...session.privileges].map((privilege) => (
            <li key={privilege}>{privilege}</li>
          ))}
        </ul>
      </Tile>
    </Layer>
  </div>
);
