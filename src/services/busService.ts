import { API_BASE_URL, USE_MOCK_DATA } from './config';
import { buildRuntimeRoute, fetchRoadPath } from './routeService';
import type { BusPlan, RuntimeBusRoute } from '../types/domain';

const MOCK_BUS_PLANS: BusPlan[] = [
  {
    id: 'bus-1-it-park-clock-tower-loop',
    // Corridor guidance; road geometry is generated in routeService.
    waypoints: [
      [78.100219, 30.373907],
      [78.099908, 30.373569],
      [78.093232, 30.36454],
      [78.088478, 30.358922],
      [78.083391, 30.35501],
      [78.080173, 30.351684],
      [78.076006, 30.347864],
      [78.07137, 30.340583],
      [78.065807, 30.331728],
      [78.066431, 30.330057],
      [78.064128, 30.324204],
      [78.064054, 30.323783],
      [78.057819, 30.32438],
      [78.051981, 30.324877],
      [78.051722, 30.324637],
      [78.051148, 30.324658],
      [78.048767, 30.322581],
      [78.045829, 30.323556],
      [78.045383, 30.323731],
      [78.042815, 30.322891],
      [78.04196, 30.324159],
    ],
    preferredRoadNames: [
      'sahastradhara',
      'raipur road',
      'eastern canal',
      'ec road',
      'survey chowk',
      'rajpur road',
      'clock tower',
    ],
    color: '#14b8a6',
    speedMetersPerSecond: 11,
    stopMs: 3600,
    startOffsetMs: 0,
  },
];

export function getMockBusPlans() {
  return MOCK_BUS_PLANS;
}

export async function getBusPlans(): Promise<BusPlan[]> {
  if (!USE_MOCK_DATA && API_BASE_URL) {
    try {
      const res = await fetch(`${API_BASE_URL}/buses`);
      if (res.ok) return (await res.json()) as BusPlan[];
    } catch {
      // Keep the app usable while backend integration is not connected.
    }
  }

  return MOCK_BUS_PLANS;
}

export async function getRuntimeBusRoutes(plans: BusPlan[] = MOCK_BUS_PLANS): Promise<RuntimeBusRoute[]> {
  const paths = await Promise.all(plans.map(fetchRoadPath));
  return plans.map((plan, index) => buildRuntimeRoute(plan, paths[index]));
}