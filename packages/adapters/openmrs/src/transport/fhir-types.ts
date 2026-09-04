export type FhirCoding = {
  system?: string;
  code?: string;
  display?: string;
};

export type FhirCodeableConcept = {
  text?: string;
  coding?: FhirCoding[];
};

export type FhirQuantity = {
  value?: number;
  unit?: string;
  code?: string;
};

export type FhirReference = {
  reference?: string;
  display?: string;
  type?: string;
};

export type FhirExtension = {
  url?: string;
  valueCode?: string;
  valueString?: string;
};

export type FhirObservation = {
  resourceType?: string;
  id?: string;
  code?: FhirCodeableConcept;
  subject?: FhirReference;
  effectiveDateTime?: string;
  issued?: string;
  valueQuantity?: FhirQuantity;
  valueString?: string;
  valueCodeableConcept?: FhirCodeableConcept;
  interpretation?: FhirCodeableConcept[];
  referenceRange?: Array<{
    low?: FhirQuantity;
    high?: FhirQuantity;
    text?: string;
  }>;
  category?: FhirCodeableConcept[];
};

export type FhirCondition = {
  resourceType?: string;
  id?: string;
  code?: FhirCodeableConcept;
  subject?: FhirReference;
};

export type FhirAllergyIntolerance = {
  resourceType?: string;
  id?: string;
  code?: FhirCodeableConcept;
  patient?: FhirReference;
};

export type FhirMedicationRequest = {
  resourceType?: string;
  id?: string;
  subject?: FhirReference;
  medicationCodeableConcept?: FhirCodeableConcept;
  medicationReference?: FhirReference;
};

export type FhirCarePlanActivityDetail = {
  status?: string;
  description?: string;
  scheduledString?: string;
  scheduledPeriod?: { start?: string; end?: string };
  performer?: FhirReference[];
  reasonCode?: FhirCodeableConcept[];
};

export type FhirCarePlan = {
  resourceType?: string;
  id?: string;
  status?: string;
  intent?: string;
  title?: string;
  description?: string;
  subject?: FhirReference;
  period?: { start?: string; end?: string };
  activity?: Array<{ detail?: FhirCarePlanActivityDetail }>;
  extension?: FhirExtension[];
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function bundleResources<T>(data: unknown): T[] {
  if (Array.isArray(data)) {
    return data as T[];
  }
  if (!isRecord(data) || !Array.isArray(data.entry)) {
    return [];
  }

  const resources: T[] = [];
  for (const item of data.entry) {
    if (isRecord(item) && item.resource !== undefined) {
      resources.push(item.resource as T);
    }
  }
  return resources;
}

export function readNextLink(data: unknown): string | undefined {
  if (!isRecord(data)) {
    return undefined;
  }

  const links = data.link ?? data.links;
  if (!Array.isArray(links)) {
    return undefined;
  }

  for (const link of links) {
    if (!isRecord(link)) {
      continue;
    }
    const rel = link.rel ?? link.relation;
    if (rel !== 'next') {
      continue;
    }
    const href = link.url ?? link.uri;
    if (typeof href === 'string' && href !== '') {
      return toRequestPath(href);
    }
  }
  return undefined;
}

const OPENMRS_WEBAPP_PREFIX = '/openmrs';

export function toRequestPath(url: string): string {
  const path = url.startsWith('/') ? url : parseAbsolutePath(url);
  if (path === undefined) {
    return url;
  }
  return stripOpenmrsWebapp(path);
}

function parseAbsolutePath(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return undefined;
  }
}

/**
 * `openmrsFetch` prepends `window.openmrsBase` (`/openmrs`). REST/FHIR next
 * links are already rooted there, so following them raw becomes
 * `/openmrs/openmrs/ws/...` and 404s the whole collect().
 */
function stripOpenmrsWebapp(path: string): string {
  if (path === OPENMRS_WEBAPP_PREFIX) {
    return '/';
  }
  if (path.startsWith(`${OPENMRS_WEBAPP_PREFIX}/`)) {
    return path.slice(OPENMRS_WEBAPP_PREFIX.length);
  }
  return path;
}

export function referenceId(reference: string | undefined): string {
  if (reference === undefined || reference === '') {
    return '';
  }
  const slash = reference.lastIndexOf('/');
  return slash === -1 ? reference : reference.slice(slash + 1);
}

export function codeableDisplay(concept: FhirCodeableConcept | undefined): string | undefined {
  if (concept === undefined) {
    return undefined;
  }
  if (typeof concept.text === 'string' && concept.text !== '') {
    return concept.text;
  }
  const coding = concept.coding?.[0];
  if (typeof coding?.display === 'string' && coding.display !== '') {
    return coding.display;
  }
  if (typeof coding?.code === 'string' && coding.code !== '') {
    return coding.code;
  }
  return undefined;
}
