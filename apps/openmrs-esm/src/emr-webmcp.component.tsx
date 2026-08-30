import React from 'react';
import { EmrWebmcpShell, type SessionPort } from './emr-webmcp-shell';

const placeholderSession: SessionPort = {
  userId: null,
  privileges: new Set<string>(),
  patientId: null,
};

const EmrWebmcp: React.FC = () => (
  <EmrWebmcpShell adapter={{ id: 'openmrs' }} session={placeholderSession} />
);

export default EmrWebmcp;
