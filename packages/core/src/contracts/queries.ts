export type AppointmentQuery = {
  start: string;
  end: string;
};

export type ResultQuery = {
  limit: number;
  patientId?: string;
  cursor?: string;
};

export type FollowupQuery = {
  limit: number;
  patientId?: string;
  assigneeId?: string;
  priority?: 'low' | 'medium' | 'high';
  overdueOnly?: boolean;
  cursor?: string;
};
