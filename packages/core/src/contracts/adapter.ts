import type { EmrCapability, EmrNavigationTarget } from './capabilities.js';
import type {
  AssigneeSummary,
  AppointmentSummary,
  ChartBrief,
  ConfirmedFollowup,
  FollowupSummary,
  PatientRef,
  ResultSummary,
} from './dtos.js';
import type { AppointmentQuery, FollowupQuery, ResultQuery } from './queries.js';

export interface EmrAdapter {
  readonly id: string;
  getCapabilities(): Promise<ReadonlySet<EmrCapability>>;
  getActivePatient(): Promise<PatientRef | null>;
  searchPatients(query: string, limit: number): Promise<PatientRef[]>;
  listAppointments(input: AppointmentQuery): Promise<AppointmentSummary[]>;
  getChartBrief(patientId: string): Promise<ChartBrief>;
  listAbnormalResults(input: ResultQuery): Promise<ResultSummary[]>;
  getResult(resultId: string): Promise<ResultSummary>;
  listFollowups(input: FollowupQuery): Promise<FollowupSummary[]>;
  listAssignees(query: string, limit: number): Promise<AssigneeSummary[]>;
  createFollowup(input: ConfirmedFollowup): Promise<FollowupSummary>;
  navigate(target: EmrNavigationTarget): Promise<void>;
}
