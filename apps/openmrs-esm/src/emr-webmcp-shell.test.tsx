import { render, screen } from '@testing-library/react';
import React, { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { EmrWebmcpShell, type EmrWebmcpShellProps } from './emr-webmcp-shell';
import { clearAgentActivity, recordAgentActivity } from './webmcp/agent-activity';

const props: EmrWebmcpShellProps = {
  adapter: { id: 'openmrs' },
  session: {
    userId: 'user-1',
    privileges: new Set(['Get Patients', 'Get Observations']),
    patientId: 'patient-1',
  },
};

afterEach(() => {
  clearAgentActivity();
});

describe('EmrWebmcpShell', () => {
  it('requires adapter and session ports and mounts successfully', () => {
    expect(() => render(<EmrWebmcpShell {...props} />)).not.toThrow();
    expect(screen.getByTestId('emr-webmcp-shell')).toBeInTheDocument();
    expect(screen.getByTestId('webmcp-compat-notice')).toBeInTheDocument();
    expect(screen.getByTestId('webmcp-adapter')).toHaveTextContent('openmrs');
    expect(screen.getByTestId('agent-activity-idle')).toBeInTheDocument();
  });

  it('shows hunt results in the real agent activity panel', () => {
    render(<EmrWebmcpShell {...props} />);
    act(() => {
      recordAgentActivity({
        tool: 'find_unlatched_abnormal_results',
        phase: 'done',
        lines: ['2 unlatched abnormal labs', '• Ada Lovelace'],
      });
    });
    expect(screen.getByTestId('agent-activity-tool')).toHaveTextContent('Hunt unlatched abnormal labs');
    expect(screen.getByTestId('agent-activity-phase')).toHaveAttribute('data-phase', 'done');
    expect(screen.getByTestId('agent-activity-lines')).toHaveTextContent('2 unlatched abnormal labs');
    expect(screen.getByTestId('agent-activity-lines')).toHaveTextContent('Ada Lovelace');
  });
});
