import type { ToolName, ToolRuntime } from '@emr-webmcp/core';
import { TOOL_NAMES } from '@emr-webmcp/core';
import { useEffect, useState } from 'react';

export type AgentActivityPhase = 'running' | 'done' | 'failed';

export type AgentActivity = {
  tool: ToolName;
  phase: AgentActivityPhase;
  lines: string[];
};

export type ConfirmedFollowupNotice = {
  patient: string;
  title: string;
};

const listeners = new Set<() => void>();
let activity: AgentActivity | null = null;
let confirmed: ConfirmedFollowupNotice | null = null;
let generation = 0;

export function recordAgentActivity(next: AgentActivity, epoch = generation): void {
  if (epoch !== generation) {
    return;
  }
  activity = next;
  notify();
}

export function recordConfirmedFollowup(next: ConfirmedFollowupNotice, epoch = generation): void {
  if (epoch !== generation) {
    return;
  }
  confirmed = next;
  notify();
}

export function clearAgentActivity(): void {
  generation += 1;
  activity = null;
  confirmed = null;
  notify();
}

export function readAgentActivity(): AgentActivity | null {
  return activity;
}

export function readConfirmedFollowup(): ConfirmedFollowupNotice | null {
  return confirmed;
}

export function subscribeAgentActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAgentActivity(): {
  activity: AgentActivity | null;
  confirmed: ConfirmedFollowupNotice | null;
} {
  const [, setTick] = useState(0);
  useEffect(() => subscribeAgentActivity(() => setTick((value) => value + 1)), []);
  return { activity: readAgentActivity(), confirmed: readConfirmedFollowup() };
}

export function agentActivityTitle(name: ToolName): string {
  if (name === 'find_unlatched_abnormal_results') {
    return 'Hunt unlatched abnormal labs';
  }
  if (name === 'stage_followup_task') {
    return 'Stage follow-up draft';
  }
  return name;
}

export function withAgentActivity(runtime: ToolRuntime): ToolRuntime {
  const wrapped = {} as { [Name in ToolName]: ToolRuntime[Name] };
  for (const name of TOOL_NAMES) {
    const handler = runtime[name];
    wrapped[name] = async (input, signal) => {
      const epoch = generation;
      recordAgentActivity({ tool: name, phase: 'running', lines: summarizeInput(name, input) }, epoch);
      try {
        const result = await handler(input, signal);
        if (!signal.aborted) {
          recordAgentActivity({ tool: name, phase: 'done', lines: summarizeResult(name, result) }, epoch);
        }
        return result;
      } catch (error) {
        if (!signal.aborted) {
          recordAgentActivity({ tool: name, phase: 'failed', lines: ['Call failed.'] }, epoch);
        }
        throw error;
      }
    };
  }
  return wrapped;
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function summarizeInput(name: ToolName, input: unknown): string[] {
  if (name === 'find_unlatched_abnormal_results') {
    return ['Hunting clinic-wide for abnormal labs with no follow-up'];
  }
  if (name === 'stage_followup_task') {
    const patient = asRecord(asRecord(input)?.patient)?.display;
    return typeof patient === 'string' && patient !== ''
      ? [`Drafting follow-up for ${patient} — not written to the chart yet`]
      : ['Staging a draft — not written to the chart yet'];
  }
  return [`Calling ${name}`];
}

function summarizeResult(name: ToolName, result: unknown): string[] {
  if (name === 'find_unlatched_abnormal_results' && Array.isArray(result)) {
    const names = [
      ...new Set(
        result
          .map((item) => {
            const display = asRecord(asRecord(item)?.patient)?.display;
            return typeof display === 'string' ? display.split('(')[0]?.trim() : undefined;
          })
          .filter((value): value is string => value !== undefined && value !== ''),
      ),
    ].slice(0, 5);
    return [`${String(result.length)} unlatched abnormal labs`, ...names.map((value) => `• ${value}`)];
  }
  if (name === 'stage_followup_task') {
    return ['Draft staged. Confirm follow-up is the only chart write.'];
  }
  return ['Done'];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}
