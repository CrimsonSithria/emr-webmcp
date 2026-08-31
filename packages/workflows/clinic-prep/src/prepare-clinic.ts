import {
  AdapterError,
  type AppointmentSummary,
  type ChartBrief,
  type EmrAdapter,
} from '@emr-webmcp/core';

export const CLINIC_PREP_CONCURRENCY_CEILING = 5;

export type PrepareClinicInput = {
  start: string;
  end: string;
  concurrency?: number;
};

export type ClinicPrepFailure = {
  patientId: string;
  error: AdapterError;
};

export type ClinicPrepItem = {
  appointment: AppointmentSummary;
  brief: ChartBrief | null;
};

export type PrepareClinicResult = {
  items: ClinicPrepItem[];
  failures: ClinicPrepFailure[];
};

export async function prepareClinic(
  adapter: EmrAdapter,
  input: PrepareClinicInput,
): Promise<PrepareClinicResult> {
  const appointments = await adapter.listAppointments({ start: input.start, end: input.end });
  const concurrency = resolveConcurrency(input.concurrency);
  const uniquePatientIds = uniqueInOrder(appointments.map((appointment) => appointment.patient.id));
  const briefs = new Map<string, ChartBrief>();
  const failures: ClinicPrepFailure[] = [];

  await mapWithConcurrency(uniquePatientIds, concurrency, async (patientId) => {
    try {
      briefs.set(patientId, await adapter.getChartBrief(patientId));
    } catch (error) {
      if (error instanceof AdapterError) {
        failures.push({ patientId, error });
        return;
      }
      throw error;
    }
  });

  return {
    items: appointments.map((appointment) => ({
      appointment,
      brief: briefs.get(appointment.patient.id) ?? null,
    })),
    failures,
  };
}

function resolveConcurrency(requested: number | undefined): number {
  const value = requested ?? CLINIC_PREP_CONCURRENCY_CEILING;
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.min(Math.floor(value), CLINIC_PREP_CONCURRENCY_CEILING);
}

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      const item = items[index];
      if (item === undefined) {
        return;
      }
      await mapper(item, index);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  if (workerCount === 0) {
    return;
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}
