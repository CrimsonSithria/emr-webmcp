export type RestRef = {
  uuid?: string;
  display?: string;
  name?: string;
};

export type RestPatient = {
  uuid?: string;
  display?: string;
  person?: { display?: string };
};

export type RestAppointment = {
  uuid?: string;
  startDateTime?: string | number;
  status?: string;
  patient?: {
    uuid?: string;
    name?: string;
    display?: string;
    identifier?: string;
  };
  service?: {
    uuid?: string;
    name?: string;
  };
};

export type RestProvider = {
  uuid?: string;
  display?: string;
  person?: { display?: string };
};

export type RestRole = {
  uuid?: string;
  display?: string;
  name?: string;
};

export function restResults<T>(data: unknown): T[] {
  if (Array.isArray(data)) {
    return data as T[];
  }
  if (data !== null && typeof data === 'object' && 'results' in data) {
    const results = (data as { results?: unknown }).results;
    if (Array.isArray(results)) {
      return results as T[];
    }
  }
  return [];
}
