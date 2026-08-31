import type { ResultSummary, ToolResult } from '@emr-webmcp/core';

import type { FakeModelContext } from './model-context';

export type HarnessNetworkRequest = { method: string; url: string };

export type ClinicProfileName = 'default' | 'empty' | 'large';

export type ReviewHarness = {
  writeMethods(): string[];
  carePlanPosts(): HarnessNetworkRequest[];
  requests(): HarnessNetworkRequest[];
  createdCount(): number;
  navigations(): unknown[];
  toolNames(): string[];
  unregisterCount(): number;
  invoke(name: string, input: unknown): Promise<ToolResult<unknown>>;
  authenticate(userId: string): void;
  logout(): void;
  changeUser(userId: string): void;
  changeRoute(path: string): void;
  unmount(): void;
  setClinicProfile(profile: ClinicProfileName): void;
  setCapabilities(names: string[]): void;
  setPrivileges(names: string[]): void;
  setOnline(next: boolean): void;
  addResult(result: ResultSummary): void;
  removeResult(resultId: string): void;
  refreshClinic(): Promise<void>;
  clinicCounts(): { patients: number; appointments: number; results: number; shownPatients: number };
};

declare global {
  interface Window {
    __harness: ReviewHarness;
    __modelContext: FakeModelContext;
  }
}

export {};
