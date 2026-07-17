export type TrackingActivity = {
  id: string;
  stopId: string;
  label: string;
  status: "done" | "absent";
  at: number;
  kilos: number;
};

export type GpsMetrics = {
  actualKm: number;
  movingMinutes: number;
  stoppedMinutes: number;
};

export const EMPTY_GPS_METRICS: GpsMetrics = {
  actualKm: 0,
  movingMinutes: 0,
  stoppedMinutes: 0,
};
