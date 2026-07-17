import type { Stop } from "./route-data";
import type { GpsMetrics } from "./tracking-types";

export type StopStatus = "pending" | "done" | "absent";
export type StopDetail = { kilos: string; material: string; note: string };
export type ActivityEntry = {
  id: string;
  stopId: string;
  stopName: string;
  stopAddress?: string;
  status: "done" | "absent";
  at: number;
};
export type StoredPosition = { lat: number; lng: number; accuracy: number | null; at: number };

export type ChangeStamp = {
  at: number;
  deviceId: string;
  sequence: number;
};

export type AuditEntry = {
  id: string;
  at: number;
  deviceId: string;
  scope: "status" | "detail" | "custom-stop" | "journey" | "system";
  targetId?: string;
  action: string;
  from?: string;
  to?: string;
};

export type SyncMetadata = {
  deviceId: string;
  serverRevision: number;
  localSequence: number;
  statusClocks: Record<string, ChangeStamp>;
  detailClocks: Record<string, ChangeStamp>;
  customStopClocks: Record<string, ChangeStamp>;
  globalClocks: Record<string, ChangeStamp>;
};

export type JourneySnapshot = {
  version: 4;
  journeyId: string;
  statuses: Record<string, StopStatus>;
  details: Record<string, StopDetail>;
  customStops: Stop[];
  reverse: boolean;
  optimizedIds: string[];
  startedAt: number | null;
  completedAt: number | null;
  activity: ActivityEntry[];
  vehicle: string;
  lastPosition: StoredPosition | null;
  gpsMetrics: GpsMetrics;
  updatedAt: number;
  routeId?: string;
  sector?: string;
  driverId?: string;
  sync?: SyncMetadata;
  auditTrail?: AuditEntry[];
};
