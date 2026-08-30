import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmrWebmcpShell } from './emr-webmcp-shell';

describe('EmrWebmcpShell', () => {
  it('renders and receives adapter and session ports', () => {
    const privileges = new Set(['Get Patients', 'Get Observations']);

    render(
      <EmrWebmcpShell
        adapter={{ id: 'openmrs' }}
        session={{
          userId: 'user-1',
          privileges,
          patientId: 'patient-1',
        }}
      />,
    );

    expect(screen.getByTestId('emr-webmcp-shell')).toBeInTheDocument();
    expect(screen.getByTestId('adapter-id')).toHaveTextContent('openmrs');
    expect(screen.getByTestId('session-user-id')).toHaveTextContent('user-1');
    expect(screen.getByTestId('session-patient-id')).toHaveTextContent('patient-1');
    expect(screen.getByTestId('session-privileges')).toHaveTextContent('Get Patients');
    expect(screen.getByTestId('session-privileges')).toHaveTextContent('Get Observations');
  });
});
