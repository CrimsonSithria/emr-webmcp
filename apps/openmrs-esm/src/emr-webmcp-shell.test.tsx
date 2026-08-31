import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmrWebmcpShell, type EmrWebmcpShellProps } from './emr-webmcp-shell';

describe('EmrWebmcpShell', () => {
  it('requires adapter and session ports and mounts successfully', () => {
    const props: EmrWebmcpShellProps = {
      adapter: { id: 'openmrs' },
      session: {
        userId: 'user-1',
        privileges: new Set(['Get Patients', 'Get Observations']),
        patientId: 'patient-1',
      },
    };

    expect(() => render(<EmrWebmcpShell {...props} />)).not.toThrow();
    expect(screen.getByTestId('emr-webmcp-shell')).toBeInTheDocument();
  });
});
