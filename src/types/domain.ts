export type LngLat = [number, number];

export type BusPlan = {
  id: string;
  waypoints: LngLat[];
  preferredRoadNames: string[];
  color: string;
  speedMetersPerSecond: number;
  stopMs: number;
  startOffsetMs: number;
};

export type RuntimeBusRoute = {
  id: string;
  path: LngLat[];
  cumulative: number[];
  totalDistance: number;
  forwardEndDistance: number;
  stopDistances: number[];
  color: string;
  speedMetersPerSecond: number;
  stopMs: number;
  startOffsetMs: number;
};

export type RoutePosition = {
  position: LngLat;
  bearing: number;
  distanceAlong: number;
};

export type LiveBusState = {
  position: LngLat;
  distanceAlong: number;
  forwardEndDistance: number;
  totalDistance: number;
  isMoving: boolean;
  bearing: number;
};

export type PassByEstimate = {
  label: string;
  status: 'ok' | 'missed' | 'unknown';
};

export type LocationLoaderState = 'requesting' | 'fetching' | 'hidden';

export type LocatorIconType = 'default' | 'male' | 'female';

export type LocationTrackingCallbacks = {
  onRequestingAccess: () => void;
  onFetchingLocation: () => void;
  onLocationReady: () => void;
  onLocationUnavailable: () => void;
  onLocationUpdate?: (lngLat: LngLat) => void;
};