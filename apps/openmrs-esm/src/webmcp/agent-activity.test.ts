import { afterEach, describe, expect, it } from 'vitest';

import type { ToolRuntime } from '@emr-webmcp/core';
import { TOOL_NAMES } from '@emr-webmcp/core';

import {
  clearAgentActivity,
  readAgentActivity,
  readConfirmedFollowup,
  recordConfirmedFollowup,
  withAgentActivity,
} from './agent-activity';

function stubRuntime(): ToolRuntime {
  return Object.fromEntries(
    TOOL_NAMES.map((name) => [
      name,
      async () => {
        if (name === 'find_unlatched_abnormal_results') {
          return [{ patient: { display: 'Ada Lovelace (1000)' } }];
        }
        return { draftId: 'draft-1' };
      },
    ]),
  ) as unknown as ToolRuntime;
}

afterEach(() => {
  clearAgentActivity();
});

describe('agent activity', () => {
  it('records hunt results on the real runtime wrapper', async () => {
    const runtime = withAgentActivity(stubRuntime());
    await runtime.find_unlatched_abnormal_results({ limit: 20 }, new AbortController().signal);
    expect(readAgentActivity()).toEqual({
      tool: 'find_unlatched_abnormal_results',
      phase: 'done',
      lines: ['1 unlatched abnormal labs', '• Ada Lovelace'],
    });
  });

  it('records a staged draft without treating it as a chart write', async () => {
    const runtime = withAgentActivity(stubRuntime());
    await runtime.stage_followup_task(
      { patient: { display: 'Ada Lovelace' } },
      new AbortController().signal,
    );
    expect(readAgentActivity()).toEqual({
      tool: 'stage_followup_task',
      phase: 'done',
      lines: ['Draft staged. Confirm follow-up is the only chart write.'],
    });
  });

  it('does not write hunt results after the session is cleared', async () => {
    let finish!: (value: unknown) => void;
    const runtime = withAgentActivity(
      Object.fromEntries(
        TOOL_NAMES.map((name) => [
          name,
          async () => {
            if (name === 'find_unlatched_abnormal_results') {
              return new Promise((resolve) => {
                finish = resolve;
              });
            }
            return { draftId: 'draft-1' };
          },
        ]),
      ) as unknown as ToolRuntime,
    );
    const pending = runtime.find_unlatched_abnormal_results({ limit: 20 }, new AbortController().signal);
    expect(readAgentActivity()?.phase).toBe('running');
    clearAgentActivity();
    expect(readAgentActivity()).toBeNull();
    finish([{ patient: { display: 'Ada Lovelace (1000)' } }]);
    await pending;
    expect(readAgentActivity()).toBeNull();
  });

  it('keeps a confirmed follow-up notice after the doctor clicks', () => {
    recordConfirmedFollowup({ patient: 'Ada Lovelace', title: 'Review unlatched abnormal lab' });
    expect(readConfirmedFollowup()).toEqual({
      patient: 'Ada Lovelace',
      title: 'Review unlatched abnormal lab',
    });
  });
});
