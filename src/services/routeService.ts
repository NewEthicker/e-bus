import { API_BASE_URL, USE_MOCK_DATA } from './config';
import type { BusPlan, LngLat, PassByEstimate, RuntimeBusRoute } from '../types/domain';

export function distanceMeters(from: LngLat, to: LngLat) {
  const radius = 6371000;
  const fromLat = (from[1] * Math.PI) / 180;
  const toLat = (to[1] * Math.PI) / 180;
  const deltaLat = ((to[1] - from[1]) * Math.PI) / 180;
  const deltaLng = ((to[0] - from[0]) * Math.PI) / 180;
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2;

  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingDegrees(from: LngLat, to: LngLat) {
  const fromLat = (from[1] * Math.PI) / 180;
  const toLat = (to[1] * Math.PI) / 180;
  const deltaLng = ((to[0] - from[0]) * Math.PI) / 180;
  const y = Math.sin(deltaLng) * Math.cos(toLat);
  const x = Math.cos(fromLat) * Math.sin(toLat) - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function interpolate(from: LngLat, to: LngLat, progress: number): LngLat {
  return [
    from[0] + (to[0] - from[0]) * progress,
    from[1] + (to[1] - from[1]) * progress,
  ];
}

export function makeLoopPath(path: LngLat[]) {
  if (path.length < 2) return path;
  return [...path, ...path.slice(0, -1).reverse()];
}

export function buildDistanceIndex(path: LngLat[]) {
  const cumulative = [0];

  for (let index = 1; index < path.length; index += 1) {
    cumulative.push(cumulative[index - 1] + distanceMeters(path[index - 1], path[index]));
  }

  return { cumulative, totalDistance: cumulative[cumulative.length - 1] || 1 };
}

export function buildRuntimeRoute(plan: BusPlan, routedPath: LngLat[]): RuntimeBusRoute {
  const forwardPath = routedPath.length > 1 ? routedPath : plan.waypoints;
  const forwardEndDistance = buildDistanceIndex(forwardPath).totalDistance;
  const loopPath = makeLoopPath(forwardPath);
  const { cumulative, totalDistance } = buildDistanceIndex(loopPath);

  return {
    id: plan.id,
    path: loopPath,
    cumulative,
    totalDistance,
    forwardEndDistance,
    stopDistances: [0, totalDistance * 0.34, totalDistance * 0.68],
    color: plan.color,
    speedMetersPerSecond: plan.speedMetersPerSecond,
    stopMs: plan.stopMs,
    startOffsetMs: plan.startOffsetMs,
  };
}

export function positionAlongRoute(bus: RuntimeBusRoute, distance: number) {
  const routeDistance = ((distance % bus.totalDistance) + bus.totalDistance) % bus.totalDistance;

  for (let index = 0; index < bus.path.length - 1; index += 1) {
    const startDistance = bus.cumulative[index];
    const endDistance = bus.cumulative[index + 1];

    if (routeDistance <= endDistance) {
      const segmentDistance = Math.max(1, endDistance - startDistance);
      const progress = (routeDistance - startDistance) / segmentDistance;

      return {
        position: interpolate(bus.path[index], bus.path[index + 1], progress),
        bearing: bearingDegrees(bus.path[index], bus.path[index + 1]),
        distanceAlong: routeDistance,
      };
    }
  }

  return {
    position: bus.path[0],
    bearing: bearingDegrees(bus.path[0], bus.path[1]),
    distanceAlong: 0,
  };
}

export function sliceRouteCoordinates(bus: RuntimeBusRoute, startDistance: number, endDistance: number) {
  const start = Math.max(0, Math.min(startDistance, bus.totalDistance));
  const end = Math.max(start, Math.min(endDistance, bus.totalDistance));
  const coordinates: LngLat[] = [positionAlongRoute(bus, start).position];

  for (let index = 1; index < bus.path.length - 1; index += 1) {
    const pointDistance = bus.cumulative[index];
    if (pointDistance > start && pointDistance < end) {
      coordinates.push(bus.path[index]);
    }
  }

  coordinates.push(positionAlongRoute(bus, end).position);

  return coordinates;
}

export function remainingRouteCoordinates(bus: RuntimeBusRoute, distanceAlong: number) {
  const goingToPointB = distanceAlong <= bus.forwardEndDistance;
  const destinationDistance = goingToPointB ? bus.forwardEndDistance : bus.totalDistance;
  return sliceRouteCoordinates(bus, distanceAlong, destinationDistance);
}

export function coveredRouteCoordinates(bus: RuntimeBusRoute, distanceAlong: number) {
  const goingToPointB = distanceAlong <= bus.forwardEndDistance;
  const originDistance = goingToPointB ? 0 : bus.forwardEndDistance;
  return sliceRouteCoordinates(bus, originDistance, distanceAlong);
}

export function busCycleMs(bus: RuntimeBusRoute) {
  return (bus.totalDistance / bus.speedMetersPerSecond) * 1000 + bus.stopDistances.length * bus.stopMs;
}

export function busPositionAt(bus: RuntimeBusRoute, elapsedMs: number) {
  let remaining = (elapsedMs + bus.startOffsetMs) % busCycleMs(bus);
  let currentDistance = 0;

  for (const stopDistance of bus.stopDistances) {
    const travelDistance = stopDistance - currentDistance;
    const travelMs = Math.max(0, (travelDistance / bus.speedMetersPerSecond) * 1000);

    if (remaining <= travelMs) {
      return positionAlongRoute(bus, currentDistance + (remaining / 1000) * bus.speedMetersPerSecond);
    }

    remaining -= travelMs;

    if (remaining <= bus.stopMs) {
      return positionAlongRoute(bus, stopDistance);
    }

    remaining -= bus.stopMs;
    currentDistance = stopDistance;
  }

  const finalTravelDistance = bus.totalDistance - currentDistance;
  const finalTravelMs = Math.max(0, (finalTravelDistance / bus.speedMetersPerSecond) * 1000);

  if (remaining <= finalTravelMs) {
    return positionAlongRoute(bus, currentDistance + (remaining / 1000) * bus.speedMetersPerSecond);
  }

  return positionAlongRoute(bus, 0);
}

async function fetchOsrmSegment(coords: LngLat[]): Promise<LngLat[]> {
  const coordStr = coords.map((p) => p.join(',')).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&continue_straight=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) return coords;
    const data = (await res.json()) as { routes?: Array<{ geometry?: { coordinates?: [number, number][] } }> };
    const route = data.routes?.[0]?.geometry?.coordinates;
    return route && route.length > 1 ? route.map((p) => [p[0], p[1]] as LngLat) : coords;
  } catch {
    return coords;
  }
}

export async function fetchRoadPath(plan: BusPlan): Promise<LngLat[]> {
  if (!USE_MOCK_DATA && API_BASE_URL) {
    try {
      const res = await fetch(`${API_BASE_URL}/routes/${plan.id}`);
      if (res.ok) {
        const data = (await res.json()) as { coordinates?: LngLat[] };
        if (data.coordinates && data.coordinates.length > 1) return data.coordinates;
      }
    } catch {
      // Fall back to the existing mock routing behavior below.
    }
  }

  // OSRM demo server limits waypoints. Chunk into segments of max 10 points
  // with 1 overlap so the segments connect seamlessly.
  const MAX_PER_REQUEST = 10;
  const wp = plan.waypoints;

  if (wp.length <= MAX_PER_REQUEST) {
    return fetchOsrmSegment(wp);
  }

  const allCoords: LngLat[] = [];
  for (let i = 0; i < wp.length - 1; i += MAX_PER_REQUEST - 1) {
    const chunk = wp.slice(i, i + MAX_PER_REQUEST);
    if (chunk.length < 2) break;
    const segment = await fetchOsrmSegment(chunk);
    if (allCoords.length > 0 && segment.length > 0) {
      allCoords.push(...segment.slice(1));
    } else {
      allCoords.push(...segment);
    }
  }

  return allCoords.length > 1 ? allCoords : wp;
}

function pointToLocalMeters(point: LngLat, origin: LngLat) {
  const metersPerDegreeLat = 110540;
  const metersPerDegreeLng = 111320 * Math.cos((origin[1] * Math.PI) / 180);

  return {
    x: (point[0] - origin[0]) * metersPerDegreeLng,
    y: (point[1] - origin[1]) * metersPerDegreeLat,
  };
}

export function closestDistanceAlongRoute(bus: RuntimeBusRoute, user: LngLat, startDistance: number, endDistance: number) {
  let best = {
    distanceAlong: startDistance,
    metersFromUser: Number.POSITIVE_INFINITY,
  };

  for (let index = 0; index < bus.path.length - 1; index += 1) {
    const segmentStart = bus.cumulative[index];
    const segmentEnd = bus.cumulative[index + 1];
    const clippedStart = Math.max(segmentStart, startDistance);
    const clippedEnd = Math.min(segmentEnd, endDistance);

    if (clippedEnd <= clippedStart) continue;

    const a = positionAlongRoute(bus, clippedStart).position;
    const b = positionAlongRoute(bus, clippedEnd).position;
    const aMeters = pointToLocalMeters(a, user);
    const bMeters = pointToLocalMeters(b, user);
    const vx = bMeters.x - aMeters.x;
    const vy = bMeters.y - aMeters.y;
    const segmentLengthSq = vx * vx + vy * vy;
    const projection = segmentLengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(aMeters.x * vx + aMeters.y * vy) / segmentLengthSq));
    const closestX = aMeters.x + vx * projection;
    const closestY = aMeters.y + vy * projection;
    const metersFromUser = Math.sqrt(closestX * closestX + closestY * closestY);

    if (metersFromUser < best.metersFromUser) {
      best = {
        distanceAlong: clippedStart + (clippedEnd - clippedStart) * projection,
        metersFromUser,
      };
    }
  }

  return best;
}

export function formatDuration(secondsInput: number) {
  const seconds = Math.max(0, Math.round(secondsInput));

  if (seconds < 60) return `${seconds} sec`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes} min ${remainingSeconds} sec` : `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0 ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
}

export function getPassBySeconds(user: LngLat | null, state: { distanceAlong: number; forwardEndDistance: number } | null, route: RuntimeBusRoute | null) {
  if (!user || !state || !route) return null;

  const goingToPointB = state.distanceAlong <= state.forwardEndDistance;
  const legStart = goingToPointB ? 0 : state.forwardEndDistance;
  const legEnd = goingToPointB ? state.forwardEndDistance : route.totalDistance;
  const closest = closestDistanceAlongRoute(route, user, legStart, legEnd);
  const hasPassedUser = closest.distanceAlong + 8 < state.distanceAlong;

  if (hasPassedUser) return null;

  return Math.max(0, closest.distanceAlong - state.distanceAlong) / route.speedMetersPerSecond;
}

export function getPassByEstimate(user: LngLat | null, state: { distanceAlong: number; forwardEndDistance: number } | null, route: RuntimeBusRoute | null): PassByEstimate {
  if (!user || !state || !route) {
    return { label: 'Location pending', status: 'unknown' };
  }

  const seconds = getPassBySeconds(user, state, route);

  if (seconds === null) {
    return { label: 'Bus missed', status: 'missed' };
  }

  return {
    label: formatDuration(seconds),
    status: 'ok',
  };
}