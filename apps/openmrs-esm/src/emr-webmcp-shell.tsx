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

export const EmrWebmcpShell: React.FC<EmrWebmcpShellProps> = () => (
  <div className={styles.container} data-testid="emr-webmcp-shell">
    <Layer>
      <Tile className={styles.tile} />
    </Layer>
  </div>
);
