import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map, type Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getMockBusPlans, getRuntimeBusRoutes } from './services/busService';
import { watchUserLocation } from './services/locationService';
import {
  buildRuntimeRoute,
  busPositionAt,
  coveredRouteCoordinates,
  getPassByEstimate,
  getPassBySeconds,
  remainingRouteCoordinates,
} from './services/routeService';
import type {
  LiveBusState,
  LngLat,
  LocatorIconType,
  LocationLoaderState,
  LocationTrackingCallbacks,
  PassByEstimate,
  RuntimeBusRoute,
} from './types/domain';

const DEHRADUN: [number, number] = [78.0322, 30.3165];
const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const THEME_STORAGE_KEY = 'doon-smart-city-default-theme';
const LOCATOR_ICON_STORAGE_KEY = 'doon-smart-city-locator-icon';

const BUS_ICON_URL = 'https://cdn-icons-png.flaticon.com/512/14703/14703667.png';
const ROUTE_ICON_URL = 'https://cdn-icons-png.flaticon.com/512/220/220243.png';
const GEAR_ICON_URL = 'https://cdn-icons-png.flaticon.com/512/1790/1790042.png';
const SEARCH_ICON_URL = 'https://cdn-icons-png.flaticon.com/512/3434/3434958.png';

function getUserLocationSvg(type: LocatorIconType) {
  const shirtColor = type === 'female' ? '#F472B6' : type === 'male' ? '#60A5FA' : '#5CD6B0';

  return `
    <svg width="32" height="32" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:block">
      <circle cx="256" cy="72" r="55" fill="#F2A98B"/>
      <path d="M148 200C148 170 172 146 202 146H310C340 146 364 170 364 200V295C364 325 340 349 310 349H202C172 349 148 325 148 295V200Z" fill="${shirtColor}"/>
      <path d="M172 200C172 184 185 171 201 171H311C327 171 340 184 340 200V250L256 265L172 250V200Z" fill="${shirtColor}"/>
      <path d="M148 245L170 350H342L364 245C320 265 200 265 148 245Z" fill="${shirtColor}"/>
      <path d="M195 335H317L307 465C305 484 289 498 270 498H242C223 498 207 484 205 465L195 335Z" fill="#A8A8A8"/>
      <path d="M235 335H277L270 498H242L235 335Z" fill="#9A9A9A"/>
    </svg>
  `;
}

function createBusElement(onClick?: () => void) {
  const element = document.createElement('div');
  element.className = 'moving-bus-marker';
  element.style.width = '48px';
  element.style.height = '48px';
  element.style.cursor = 'pointer';
  element.style.willChange = 'transform';
  element.innerHTML = `
    <img src="${BUS_ICON_URL}" alt="" draggable="false" style="display:block;width:48px;height:48px;object-fit:contain;pointer-events:none;" />
  `;
  if (onClick) element.addEventListener('click', onClick);
  return element;
}

function createUserLocationElement(onClick?: () => void, type: LocatorIconType = 'default') {
  const element = document.createElement('div');
  element.className = 'user-location-marker';
  element.style.width = '32px';
  element.style.height = '32px';
  element.style.cursor = 'pointer';
  element.style.willChange = 'transform';
  element.style.filter = 'drop-shadow(0 6px 12px rgba(15, 23, 42, .22))';
  element.innerHTML = getUserLocationSvg(type);

  if (onClick) {
    element.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
  }

  return element;
}

function busRouteSourceId(busId: string) {
  return `${busId}-remaining-route-source`;
}

function busRouteLayerId(busId: string) {
  return `${busId}-remaining-route-layer`;
}

function busRouteCasingLayerId(busId: string) {
  return `${busId}-remaining-route-casing-layer`;
}

function busRouteCoveredSourceId(busId: string) {
  return `${busId}-covered-route-source`;
}

function busRouteCoveredLayerId(busId: string) {
  return `${busId}-covered-route-layer`;
}

function ensureBusRouteLayer(map: Map, bus: RuntimeBusRoute) {
  if (!map.isStyleLoaded()) return;

  const sourceId = busRouteSourceId(bus.id);
  const layerId = busRouteLayerId(bus.id);
  const casingLayerId = busRouteCasingLayerId(bus.id);
  const coveredSourceId = busRouteCoveredSourceId(bus.id);
  const coveredLayerId = busRouteCoveredLayerId(bus.id);

  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [] },
      },
    });
  }

  if (!map.getSource(coveredSourceId)) {
    map.addSource(coveredSourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [] },
      },
    });
  }

  if (!map.getLayer(coveredLayerId)) {
    map.addLayer({
      id: coveredLayerId,
      type: 'line',
      source: coveredSourceId,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#9ca3af',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.8, 14, 6, 17, 9.5],
        'line-opacity': 0.72,
      },
    });
  }

  if (!map.getLayer(casingLayerId)) {
    map.addLayer({
      id: casingLayerId,
      type: 'line',
      source: sourceId,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#0f172a',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 9.5, 17, 14],
        'line-opacity': 0,
      },
    });
  }

  if (!map.getLayer(layerId)) {
    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': bus.color,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4.2, 14, 6.5, 17, 10],
        'line-opacity': 0.94,
      },
    });
  }
}

function updateBusRouteLayer(map: Map, bus: RuntimeBusRoute, distanceAlong: number) {
  if (!map.isStyleLoaded()) return;

  ensureBusRouteLayer(map, bus);
  const source = map.getSource(busRouteSourceId(bus.id)) as maplibregl.GeoJSONSource | undefined;
  const coveredSource = map.getSource(busRouteCoveredSourceId(bus.id)) as maplibregl.GeoJSONSource | undefined;
  coveredSource?.setData({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: coveredRouteCoordinates(bus, distanceAlong),
    },
  });
  source?.setData({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: remainingRouteCoordinates(bus, distanceAlong),
    },
  });
}

function removeBusRouteLayers(map: Map) {
  getMockBusPlans().forEach((bus) => {
    const coveredLayerId = busRouteCoveredLayerId(bus.id);
    const coveredSourceId = busRouteCoveredSourceId(bus.id);
    const casingLayerId = busRouteCasingLayerId(bus.id);
    const layerId = busRouteLayerId(bus.id);
    const sourceId = busRouteSourceId(bus.id);
    if (map.getLayer(coveredLayerId)) map.removeLayer(coveredLayerId);
    if (map.getLayer(casingLayerId)) map.removeLayer(casingLayerId);
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(coveredSourceId)) map.removeSource(coveredSourceId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  });
}

function startBusSimulation(
  map: Map,
  livePositionsRef?: { current: LngLat[] },
  routesVisibleRef?: { current: boolean },
  liveStateRef?: { current: LiveBusState[] },
  liveRoutesRef?: { current: RuntimeBusRoute[] },
  onBusClick?: (busIndex: number) => void,
  userAlertsRef?: { current: Array<{ busIdx: number; etaOffset: number; passByLabel: string; lastUpdate: number }> },
  userLngLatRef?: { current: LngLat | null },
  darkRef?: { current: boolean }
) {
  const startTime = performance.now();
  const busPlans = getMockBusPlans();
  
  // Create markers
  const markers: Marker[] = busPlans.map((bus, i) =>
    new maplibregl.Marker({
      element: createBusElement(() => onBusClick?.(i)),
      anchor: 'center',
    })
      .setLngLat(bus.waypoints[0])
      .addTo(map)
  );

  // Create separate alert cards attached to map container, not markers (to avoid rotation)
  const alertCards: HTMLDivElement[] = busPlans.map(() => {
    const card = document.createElement('div');
    card.className = 'bus-alert-card';
    card.style.display = 'none';
    map.getContainer().appendChild(card);
    return card;
  });

  let runtimeRoutes = busPlans.map((plan) => buildRuntimeRoute(plan, plan.waypoints));
  let disposed = false;
  let lastAlertUpdate = 0;

  getRuntimeBusRoutes(busPlans).then((routes) => {
    if (disposed) return;
    runtimeRoutes = routes;
    if (liveRoutesRef) liveRoutesRef.current = runtimeRoutes;
  });

  let frameId = 0;

  const animate = (now: number) => {
    const elapsed = now - startTime;
    const livePositions: LngLat[] = [];
    const liveStates: LiveBusState[] = [];
    const alerts = userAlertsRef?.current || [];

    runtimeRoutes.forEach((bus, index) => {
      const { position, bearing, distanceAlong } = busPositionAt(bus, elapsed);
      markers[index].setLngLat(position);
      markers[index].setRotation(bearing - 135);
      livePositions.push(position);

      liveStates.push({
        position,
        distanceAlong,
        forwardEndDistance: bus.forwardEndDistance,
        totalDistance: bus.totalDistance,
        isMoving: true,
        bearing,
      });

      if (routesVisibleRef?.current) {
        updateBusRouteLayer(map, bus, distanceAlong);
      }

      for (const sd of bus.stopDistances) {
        if (Math.abs(distanceAlong - sd) < 2) {
          liveStates[liveStates.length - 1].isMoving = false;
          break;
        }
      }

      // Handle Alert Card (Separate overlay, positioned via projection)
      const activeAlert = alerts.find((a) => a.busIdx === index);
      const card = alertCards[index];
      
      if (activeAlert && map.isStyleLoaded()) {
        card.style.display = 'block';

        const estimate = getPassByEstimate(
          userLngLatRef?.current || null,
          liveStates[index],
          bus
        );
        const timeLabel = estimate.status === 'missed' ? 'Missed' : estimate.label;
        const statusText = liveStates[index].isMoving ? 'Moving' : 'Stopped';
        const dotColor = liveStates[index].isMoving ? 'bg-emerald-400' : 'bg-amber-400';
        const isDark = darkRef?.current ?? false;
        card.style.backgroundColor = isDark ? 'rgb(35,33,33)' : '#ffffff';
        card.style.border = isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(15,23,42,0.08)';

        const isVisibleOnPage = !document.querySelector('section.opacity-100'); // Check if any full-screen screen is open

        if (now - lastAlertUpdate > 1000) {
          card.innerHTML = `
            <div class="alert-time ${isDark ? 'text-teal-300' : 'text-teal-700'}">${timeLabel}</div>
            <div class="alert-status">
              <span class="h-1.5 w-1.5 rounded-full ${dotColor}"></span>
              <span class="${isDark ? 'text-slate-300' : 'text-slate-600'}">${statusText}</span>
            </div>
            <div class="alert-updated ${isDark ? 'text-slate-400' : 'text-slate-500'}">Updated just now</div>
          `;
        }

        const point = map.project(position);
        const container = map.getContainer();
        const cardWidth = 128;
        const cardHeight = 72;
        const verticalOffset = 110; // Increased by ~25%
        const x = Math.max(8, Math.min(point.x - cardWidth / 2, container.clientWidth - cardWidth - 8));
        const y = Math.max(8, Math.min(point.y - verticalOffset, container.clientHeight - cardHeight - 8));
        card.style.transform = `translate(${x}px, ${y}px)`;
        card.style.opacity = isVisibleOnPage ? '1' : '0';
        card.style.display = isVisibleOnPage ? 'block' : 'none';
      } else if (card) {
        card.style.display = 'none';
      }
    });

    if (now - lastAlertUpdate > 1000) lastAlertUpdate = now;

    if (livePositionsRef) livePositionsRef.current = livePositions;
    if (liveStateRef) liveStateRef.current = liveStates;
    if (liveRoutesRef) liveRoutesRef.current = runtimeRoutes;

    frameId = window.requestAnimationFrame(animate);
  };

  frameId = window.requestAnimationFrame(animate);

  return () => {
    disposed = true;
    window.cancelAnimationFrame(frameId);
    markers.forEach((marker) => marker.remove());
    alertCards.forEach((card) => card.remove());
  };
}

function startUserLocationTracking(
  map: Map,
  callbacks: LocationTrackingCallbacks,
  onMarkerClick?: () => void,
  onFirstLocation?: () => void,
  locatorType: LocatorIconType = 'default',
  onMarkerElement?: (element: HTMLDivElement) => void
) {
  let marker: Marker | null = null;
  let hasFittedBounds = false;
  let isFirstFix = true;

  const stopWatching = watchUserLocation({
    onRequestingAccess: callbacks.onRequestingAccess,
    onFetchingLocation: callbacks.onFetchingLocation,
    onLocationReady: callbacks.onLocationReady,
    onLocationUnavailable: () => {
      if (isFirstFix) {
        isFirstFix = false;
        callbacks.onLocationUnavailable();
      }
    },
    onLocationUpdate: (lngLat) => {
      callbacks.onLocationUpdate?.(lngLat);

      // Only trigger loader on the very first location fix
      if (isFirstFix) {
        callbacks.onFetchingLocation();
      }

      if (!marker) {
        const markerElement = createUserLocationElement(onMarkerClick, locatorType);
        onMarkerElement?.(markerElement);
        marker = new maplibregl.Marker({
          element: markerElement,
          anchor: 'bottom',
        })
          .setLngLat(lngLat)
          .addTo(map);

        // First location fix — fit bounds to show user + all buses
        if (!hasFittedBounds) {
          hasFittedBounds = true;

          // Call the provided first-location handler (which triggers fitHomeView)
          onFirstLocation?.();

          // First fix complete - hide loader permanently
          isFirstFix = false;
          callbacks.onLocationReady();
        }
      } else {
        // Subsequent updates - silent, no loader
        marker.setLngLat(lngLat);
      }
    },
  });

  return () => {
    stopWatching();
    marker?.remove();
  };
}

function styleDarkMap(map: Map) {
  const layers = (map.getStyle().layers ?? []) as Array<Record<string, any>>;
  const ROAD_GRAY = 'rgb(90,91,91)';

  layers.forEach((layer) => {
    const id = String(layer.id ?? '').toLowerCase();
    const sourceLayer = String(layer['source-layer'] ?? '').toLowerCase();

    // Background
    if (layer.type === 'background') {
      try { map.setPaintProperty(layer.id, 'background-color', 'rgb(38,38,38)'); } catch {}
      return;
    }

    // Water
    if (sourceLayer.includes('water') || id.includes('water')) {
      try { map.setPaintProperty(layer.id, 'fill-color', 'rgb(32,32,34)'); } catch {}
      try { map.setPaintProperty(layer.id, 'line-color', 'rgb(32,32,34)'); } catch {}
      return;
    }

    // Buildings
    if (sourceLayer.includes('building') || id.includes('building')) {
      try { map.setPaintProperty(layer.id, 'fill-color', 'rgb(28,28,28)'); } catch {}
      try { map.setPaintProperty(layer.id, 'fill-outline-color', 'rgb(45,45,45)'); } catch {}
      return;
    }

    // Landuse / parks
    if (sourceLayer.includes('landuse') || sourceLayer.includes('landcover') || id.includes('park')) {
      try { map.setPaintProperty(layer.id, 'fill-color', 'rgb(34,34,34)'); } catch {}
      return;
    }

    const isRoadLayer =
      sourceLayer.includes('transportation') ||
      id.includes('road') ||
      id.includes('highway') ||
      id.includes('street') ||
      id.includes('bridge') ||
      id.includes('tunnel');

    // Road lines → medium gray
    if (layer.type === 'line' && isRoadLayer) {
      try {
        map.setPaintProperty(layer.id, 'line-color', ROAD_GRAY);
        map.setPaintProperty(layer.id, 'line-opacity', 0.82);
      } catch {}
      return;
    }

    // Road labels → white
    if (layer.type === 'symbol' && isRoadLayer) {
      try {
        map.setPaintProperty(layer.id, 'text-color', '#e2e8f0');
        map.setPaintProperty(layer.id, 'text-halo-color', 'rgb(38,38,38)');
        map.setPaintProperty(layer.id, 'text-halo-width', 1.4);
        map.setPaintProperty(layer.id, 'text-opacity', 0.95);
      } catch {}
      return;
    }

    // Place / city labels
    if (layer.type === 'symbol' && (id.includes('place') || id.includes('city') || id.includes('state'))) {
      try {
        map.setPaintProperty(layer.id, 'text-color', '#f1f5f9');
        map.setPaintProperty(layer.id, 'text-halo-color', 'rgb(38,38,38)');
        map.setPaintProperty(layer.id, 'text-halo-width', 1.6);
      } catch {}
      return;
    }
  });
}

function styleNaturalMapFeatures(map: Map, dark: boolean) {
  const layers = (map.getStyle().layers ?? []) as Array<Record<string, any>>;
  const waterColor = '#b8e8ff';
  const parkColor = dark ? 'rgb(34,34,34)' : '#d8f5d2';

  layers.forEach((layer) => {
    const id = String(layer.id ?? '').toLowerCase();
    const sourceLayer = String(layer['source-layer'] ?? '').toLowerCase();
    const isWater = sourceLayer.includes('water') || id.includes('water') || id.includes('river');
    const isGreenArea =
      sourceLayer.includes('park') ||
      sourceLayer.includes('landuse') ||
      sourceLayer.includes('landcover') ||
      id.includes('park') ||
      id.includes('green') ||
      id.includes('wood') ||
      id.includes('forest') ||
      id.includes('grass');

    if (isWater) {
      if (dark) return;
      try { map.setPaintProperty(layer.id, 'fill-color', waterColor); } catch {}
      try { map.setPaintProperty(layer.id, 'line-color', waterColor); } catch {}
      try { map.setPaintProperty(layer.id, 'fill-opacity', 0.82); } catch {}
      try { map.setPaintProperty(layer.id, 'line-opacity', 0.86); } catch {}
      return;
    }

    if (isGreenArea) {
      try { map.setPaintProperty(layer.id, 'fill-color', parkColor); } catch {}
      try { map.setPaintProperty(layer.id, 'line-color', parkColor); } catch {}
      try { map.setPaintProperty(layer.id, 'fill-opacity', dark ? 0.38 : 0.75); } catch {}
    }
  });
}

export default function App() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const userLngLatRef = useRef<LngLat | null>(null);
  const liveBusPositionsRef = useRef<LngLat[]>([]);
  const liveRoutesRef = useRef<RuntimeBusRoute[]>([]);
  const routesVisibleRef = useRef(false);
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark';
  });
  const [locationLoader, setLocationLoader] = useState<LocationLoaderState>('requesting');
  const [tilesLoading, setTilesLoading] = useState(true);
  const [routesVisible, setRoutesVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDestination, setSelectedDestination] = useState<string | null>(null);
  const [searchTick, setSearchTick] = useState(0);
  const [copiedBusNumber, setCopiedBusNumber] = useState(false);
  const [selectedLocator, setSelectedLocator] = useState<LocatorIconType>(() => {
    if (typeof window === 'undefined') return 'default';
    const saved = window.localStorage.getItem(LOCATOR_ICON_STORAGE_KEY);
    return saved === 'female' ? saved : 'default';
  });
  const [popupTick, setPopupTick] = useState(0);
  const liveStateRef = useRef<LiveBusState[]>([]);
  const [selectedBus, setSelectedBus] = useState<number | null>(null);
  const [busPopupClosing, setBusPopupClosing] = useState(false);
  const miniMapContainerRef = useRef<HTMLDivElement | null>(null);
  const miniMapRef = useRef<Map | null>(null);
  const miniMapCoveredRouteSourceRef = useRef<maplibregl.GeoJSONSource | null>(null);
  const miniMapRemainingRouteSourceRef = useRef<maplibregl.GeoJSONSource | null>(null);
  const darkRef = useRef(dark);
  const userPopupRef = useRef<maplibregl.Popup | null>(null);
  const userPopupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userPopupBubbleRef = useRef<HTMLDivElement | null>(null);
  const userPopupTailRef = useRef<HTMLDivElement | null>(null);
  const busPopupCloseTimerRef = useRef<number | null>(null);
  const fitHomeViewRef = useRef<(() => void) | null>(null);
  const selectedLocatorRef = useRef<LocatorIconType>(selectedLocator);
  const userMarkerElementRef = useRef<HTMLDivElement | null>(null);
  const copyResetTimerRef = useRef<number | null>(null);

  // Alert Feature State
  const [activeAlert, setActiveAlert] = useState<{ busIdx: number; step: 'select' | 'confirmed' } | null>(null);
  const [userAlerts, setUserAlerts] = useState<Array<{ busIdx: number; etaOffset: number; passByLabel: string; lastUpdate: number }>>([]);
  const userAlertsRef = useRef(userAlerts);
  userAlertsRef.current = userAlerts;

  darkRef.current = dark;
  selectedLocatorRef.current = selectedLocator;

  const openBusPopup = (busIndex: number) => {
    if (busPopupCloseTimerRef.current) window.clearTimeout(busPopupCloseTimerRef.current);
    setBusPopupClosing(false);
    setSettingsOpen(false);
    setSearchOpen(false);
    setAlertOpen(false);
    setActiveAlert(null);
    setSelectedBus(busIndex);
  };

  const closeBusPopup = () => {
    if (selectedBus === null || busPopupClosing) return;
    setBusPopupClosing(true);
    busPopupCloseTimerRef.current = window.setTimeout(() => {
      setSelectedBus(null);
      setBusPopupClosing(false);
    }, 180);
  };

  const createAlert = (busIdx: number, offset: number, label: string) => {
    // Enforce single alert per bus: replace existing or add new
    setUserAlerts((prev) => {
      const filtered = prev.filter((a) => a.busIdx !== busIdx);
      return [...filtered, { busIdx, etaOffset: offset, passByLabel: label, lastUpdate: Date.now() }];
    });
    fitBusAndUserView(busIdx);
    setActiveAlert({ busIdx, step: 'confirmed' });
  };

   const deleteAlert = (index: number) => {
     setUserAlerts((prev) => prev.filter((_, i) => i !== index));
   };

   const fitBusAndUserView = (busIdx: number) => {
    const map = mapRef.current;
    const state = liveStateRef.current[busIdx];
    if (!map || !state) return;

    const points: LngLat[] = [state.position];
    if (userLngLatRef.current) points.push(userLngLatRef.current);

    if (points.length === 1) {
      map.flyTo({ center: state.position, zoom: 14.5, duration: 700 });
      return;
    }

    const bounds = new maplibregl.LngLatBounds(points[0], points[0]);
    points.forEach((pt) => bounds.extend(pt));
    map.fitBounds(bounds, {
      padding: { top: 150, bottom: 80, left: 60, right: 60 },
      maxZoom: 15,
      duration: 800,
    });
  };

  const handleCardClick = (idx: number) => {
    fitBusAndUserView(idx);
    setSearchOpen(false);
  };

  const trackBusClick = (busIdx: number) => {
    fitBusAndUserView(busIdx);
    setActiveAlert(null);
    setSearchOpen(false);
  };

  const setPreferredTheme = (mode: 'light' | 'dark') => {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    setDark(mode === 'dark');
  };

  const selectLocatorIcon = (type: LocatorIconType) => {
    window.localStorage.setItem(LOCATOR_ICON_STORAGE_KEY, type);
    selectedLocatorRef.current = type;
    setSelectedLocator(type);
    if (userMarkerElementRef.current) {
      userMarkerElementRef.current.innerHTML = getUserLocationSvg(type);
    }
  };

  const copyBusNumber = () => {
    navigator.clipboard?.writeText('UK07BE9907');
    setCopiedBusNumber(true);
    if (copyResetTimerRef.current) window.clearTimeout(copyResetTimerRef.current);
    copyResetTimerRef.current = window.setTimeout(() => setCopiedBusNumber(false), 1200);
  };

  const applyUserPopupTheme = () => {
    const bubble = userPopupBubbleRef.current;
    const tail = userPopupTailRef.current;
    if (!bubble || !tail) return;

    const isDark = darkRef.current;
    const bgColor = isDark ? 'rgb(45,43,43)' : '#ffffff';
    const textColor = isDark ? '#e2e8f0' : '#334155';
    const borderRgb = '226,227,227';
    const borderColor = isDark ? `rgba(${borderRgb},0.31)` : `rgba(${borderRgb},0.80)`;
    const shadowColor = isDark ? 'rgba(0,0,0,0.28)' : 'rgba(15,23,42,0.10)';

    bubble.style.background = bgColor;
    bubble.style.color = textColor;
    bubble.style.border = `1.6px solid ${borderColor}`;
    bubble.style.borderRadius = '10px';
    bubble.style.boxShadow = `0 2px 8px ${shadowColor}`;

    tail.style.background = bgColor;
    tail.style.border = `1.6px solid ${borderColor}`;
    tail.style.boxShadow = `0 2px 6px ${shadowColor}`;
  };


  const fitHomeView = () => {
    const map = mapRef.current;
    if (!map) return;

    const allPoints: LngLat[] = [];

    // Always include user location if available
    if (userLngLatRef.current) allPoints.push(userLngLatRef.current);

    // Use the LIVE current bus positions instead of static waypoints
    // This makes the view dynamically reflect where buses actually are right now
    if (liveBusPositionsRef.current.length > 0) {
      liveBusPositionsRef.current.forEach((pos) => allPoints.push(pos));
    } else {
      // Fallback to waypoints if buses haven't started moving yet
      getMockBusPlans().forEach((bus) => {
        bus.waypoints.forEach((wp) => allPoints.push(wp));
      });
    }

    if (allPoints.length === 0) return;

    // If only one point (e.g. only user, no buses yet), center on it
    if (allPoints.length === 1) {
      map.flyTo({
        center: allPoints[0],
        zoom: 15,
        duration: 1000,
      });
      return;
    }

    const bounds = new maplibregl.LngLatBounds(allPoints[0], allPoints[0]);
    allPoints.forEach((pt) => bounds.extend(pt));

    map.fitBounds(bounds, {
      padding: { top: userAlerts.length > 0 ? 150 : 90, bottom: 60, left: 50, right: 50 },
      maxZoom: 15,
      duration: 1000,
    });
  };

  fitHomeViewRef.current = fitHomeView;

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Boost MapLibre tile loading concurrency globally (more parallel requests).
    // Default is 16; bumping it makes zoom-out fetch many tiles in parallel.
    if (typeof maplibregl.setMaxParallelImageRequests === 'function') {
      maplibregl.setMaxParallelImageRequests(48);
    }
    if (typeof maplibregl.prewarm === 'function') {
      maplibregl.prewarm();
    }

    routesVisibleRef.current = routesVisible;

    mapRef.current = new maplibregl.Map({
      container: mapContainerRef.current,
      style: LIGHT_STYLE,
      center: DEHRADUN,
      zoom: 13.6,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
      // Performance + smoother zoom-out tile rendering:
      fadeDuration: 80,            // shorter cross-fade so tiles appear faster
      maxTileCacheSize: 600,       // keep many tiles cached so zoom-out reuses them
      refreshExpiredTiles: false,  // don't re-fetch tiles that already work
      trackResize: true,
    });

    // Aggressively keep showing parent/lower-zoom tiles while new ones load —
    // this prevents the white blank gaps when zooming out quickly.
    mapRef.current.once('load', () => {
      const map = mapRef.current;
      if (!map) return;

      const style = map.getStyle();
      Object.entries(style.sources ?? {}).forEach(([sourceId, source]) => {
        const rasterOrVector = (source as any).type === 'raster' || (source as any).type === 'vector';
        if (!rasterOrVector) return;
        const internalSource = (map as any).style?.sourceCaches?.[sourceId]?._source;
        if (internalSource) {
          internalSource.minzoom = 0;
        }
      });
    });

    // Track tile-loading state cheaply and only show it for major zoom-out changes.
    let tileLoadingTimer: number | null = null;
    let isInitialLoad = true;
    let zoomStartValue = mapRef.current.getZoom();
    let isMajorZoomOut = false;

    const setLoading = (loading: boolean) => {
      if (tileLoadingTimer) window.clearTimeout(tileLoadingTimer);
      
      // Only show loader if loading takes longer than 450ms, it is not the
      // initial load, and the user made a meaningful zoom-out gesture.
      if (loading) {
        tileLoadingTimer = window.setTimeout(() => {
          if (!isInitialLoad && isMajorZoomOut) setTilesLoading(true);
        }, 450);
      } else {
        isInitialLoad = false;
        isMajorZoomOut = false;
        setTilesLoading(false);
      }
    };

    mapRef.current.on('zoomstart', () => {
      if (!mapRef.current) return;
      zoomStartValue = mapRef.current.getZoom();
      isMajorZoomOut = false;
    });

    mapRef.current.on('zoom', () => {
      if (!mapRef.current) return;
      const currentZoom = mapRef.current.getZoom();
      isMajorZoomOut = zoomStartValue - currentZoom >= 1.25;
    });

    mapRef.current.on('dataloading', () => setLoading(true));
    mapRef.current.on('idle', () => setLoading(false));
    mapRef.current.on('data', (event: any) => {
      if (event?.dataType === 'source' && event?.isSourceLoaded) setLoading(false);
    });

    const stopBusSimulation = startBusSimulation(
      mapRef.current,
      liveBusPositionsRef,
      routesVisibleRef,
      liveStateRef,
      liveRoutesRef,
      openBusPopup,
      userAlertsRef,
      userLngLatRef
    );
    const closeUserPopup = () => {
      if (userPopupTimerRef.current) {
        clearTimeout(userPopupTimerRef.current);
        userPopupTimerRef.current = null;
      }
      if (userPopupRef.current) {
        userPopupRef.current.remove();
        userPopupRef.current = null;
      }
      userPopupBubbleRef.current = null;
      userPopupTailRef.current = null;
    };

    const showUserMessage = () => {
      if (!mapRef.current || !userLngLatRef.current) return;
      if (userPopupRef.current) {
        closeUserPopup();
        return;
      }

      const wrapperEl = document.createElement('div');
      wrapperEl.className = 'flex flex-col items-center pointer-events-auto cursor-pointer';

      const bubbleEl = document.createElement('div');
      bubbleEl.className = 'msg-animate';
      bubbleEl.style.padding = '5px 12px';
      bubbleEl.style.borderRadius = '10px';
      bubbleEl.style.fontSize = '11px';
      bubbleEl.style.fontWeight = '500';
      bubbleEl.style.whiteSpace = 'nowrap';
      bubbleEl.style.letterSpacing = '0.01em';
      bubbleEl.textContent = 'I am Here';

      // Tail = small rotated square for a clean bordered arrow
      const tailWrapEl = document.createElement('div');
      tailWrapEl.style.position = 'relative';
      tailWrapEl.style.width = '13px';
      tailWrapEl.style.height = '8px';
      tailWrapEl.style.marginTop = '-2px';
      tailWrapEl.style.overflow = 'hidden';

      const tailEl = document.createElement('div');
      tailEl.style.position = 'absolute';
      tailEl.style.left = '50%';
      tailEl.style.top = '-3px';
      tailEl.style.width = '9px';
      tailEl.style.height = '9px';
      tailEl.style.transform = 'translateX(-50%) rotate(45deg)';
      tailEl.style.transformOrigin = 'center';
      tailEl.style.borderRadius = '2px';

      tailWrapEl.appendChild(tailEl);

      wrapperEl.appendChild(bubbleEl);
      wrapperEl.appendChild(tailWrapEl);

      userPopupBubbleRef.current = bubbleEl;
      userPopupTailRef.current = tailEl;
      applyUserPopupTheme();

      userPopupRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'user-msg-popup',
        anchor: 'bottom',
        offset: [0, -40]
      })
        .setLngLat(userLngLatRef.current)
        .setDOMContent(wrapperEl)
        .addTo(mapRef.current!);

      wrapperEl.addEventListener('click', (e) => {
        e.stopPropagation();
        closeUserPopup();
      });

      userPopupTimerRef.current = setTimeout(() => {
        closeUserPopup();
      }, 4000);
    };

    // Close popup on map click anywhere else
    mapRef.current.on('click', () => {
      closeUserPopup();
    });

    // Close search/settings panels when tapping the map
    mapRef.current.on('click', () => {
      setSearchOpen(false);
      setSettingsOpen(false);
      setAlertOpen(false);
    });

    const stopUserLocationTracking = startUserLocationTracking(mapRef.current, {
      onRequestingAccess: () => setLocationLoader('requesting'),
      onFetchingLocation: () => setLocationLoader('fetching'),
      onLocationReady: () => setLocationLoader('hidden'),
      onLocationUnavailable: () => setLocationLoader('hidden'),
      onLocationUpdate: (lngLat) => {
        userLngLatRef.current = lngLat;
      },
    }, showUserMessage, () => {
      // First location fix → pan like the Locate button
      fitHomeViewRef.current?.();
    }, selectedLocatorRef.current, (element) => {
      userMarkerElementRef.current = element;
    });

    // Match the initial camera framing to the Locate button behavior.
    const initialFitTimer = window.setTimeout(() => {
      fitHomeView();
    }, 800);

    return () => {
      window.clearTimeout(initialFitTimer);
      if (busPopupCloseTimerRef.current) window.clearTimeout(busPopupCloseTimerRef.current);
      if (copyResetTimerRef.current) window.clearTimeout(copyResetTimerRef.current);
      closeUserPopup();
      stopBusSimulation();
      stopUserLocationTracking();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleStyleLoad = () => {
      if (dark) styleDarkMap(map);
      styleNaturalMapFeatures(map, dark);
      // Route layers are destroyed by setStyle; the animation loop's
      // ensureBusRouteLayer will re-create them on the next frame
      // if routesVisible is true. No manual action needed here.
    };

    map.once('style.load', handleStyleLoad);
    map.setStyle(dark ? DARK_STYLE : LIGHT_STYLE, { diff: false });

    return () => {
      map.off('style.load', handleStyleLoad);
    };
  }, [dark]);

  useEffect(() => {
    applyUserPopupTheme();
  }, [dark]);

  useEffect(() => {
    routesVisibleRef.current = routesVisible;

    if (!routesVisible && mapRef.current) {
      removeBusRouteLayers(mapRef.current);
    }
  }, [routesVisible]);

  // Mini map for bus detail card
  useEffect(() => {
    if (selectedBus === null) {
      miniMapRef.current?.remove();
      miniMapRef.current = null;
      return;
    }

    const timer = setTimeout(() => {
      if (!miniMapContainerRef.current) return;
      const pos = liveStateRef.current[selectedBus]?.position ?? DEHRADUN;

      miniMapRef.current = new maplibregl.Map({
        container: miniMapContainerRef.current,
        style: dark ? DARK_STYLE : LIGHT_STYLE,
        center: pos,
        zoom: 14.2, // Zoomed out ~30% from 15.5
        attributionControl: false,
        interactive: false,
      });

      miniMapRef.current.once('style.load', () => {
        if (!miniMapRef.current) return;
        if (dark) styleDarkMap(miniMapRef.current);

        // Force resize to ensure tiles render correctly after popup animation
        setTimeout(() => miniMapRef.current?.resize(), 100);

        // Add separate mini-map sources so covered and remaining paths can differ.
        miniMapRef.current.addSource('mini-route-covered-source', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
        });

        miniMapRef.current.addSource('mini-route-remaining-source', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
        });

        // Covered route (grey)
        miniMapRef.current.addLayer({
          id: 'mini-route-covered',
          type: 'line',
          source: 'mini-route-covered-source',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#9ca3af', 'line-width': 4, 'line-opacity': 0.7 },
        });

        // Remaining route (colored)
        miniMapRef.current.addLayer({
          id: 'mini-route-remaining',
          type: 'line',
          source: 'mini-route-remaining-source',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#14b8a6', 'line-width': 4, 'line-opacity': 0.9 },
        });

        miniMapCoveredRouteSourceRef.current = miniMapRef.current.getSource('mini-route-covered-source') as maplibregl.GeoJSONSource;
        miniMapRemainingRouteSourceRef.current = miniMapRef.current.getSource('mini-route-remaining-source') as maplibregl.GeoJSONSource;
      });
    }, 80);

    return () => {
      clearTimeout(timer);
      miniMapRef.current?.remove();
      miniMapRef.current = null;
      miniMapCoveredRouteSourceRef.current = null;
      miniMapRemainingRouteSourceRef.current = null;
    };
  }, [selectedBus, dark]);

  // Keep mini map centered on the bus in real-time
  useEffect(() => {
    if (selectedBus === null) return;
    let frameId = 0;
    let busMarker: maplibregl.Marker | null = null;

    const track = () => {
      const state = liveStateRef.current[selectedBus];
      const route = liveRoutesRef.current[selectedBus];
      if (state && route && miniMapRef.current) {
        miniMapRef.current.setCenter(state.position);

        // Update mini-map route overlay: grey covered path + teal remaining path.
        if (miniMapCoveredRouteSourceRef.current) {
          miniMapCoveredRouteSourceRef.current.setData({
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: coveredRouteCoordinates(route, state.distanceAlong) },
          });
        }

        if (miniMapRemainingRouteSourceRef.current) {
          miniMapRemainingRouteSourceRef.current.setData({
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: remainingRouteCoordinates(route, state.distanceAlong) },
          });
        }

        // Update or create bus marker with rotation
        if (!busMarker) {
          const busMarkerEl = document.createElement('div');
          busMarkerEl.style.width = '36px';
          busMarkerEl.style.height = '36px';
          busMarkerEl.innerHTML = `<img src="${BUS_ICON_URL}" style="width:100%;height:100%;object-fit:contain;" />`;
          busMarker = new maplibregl.Marker({ element: busMarkerEl, anchor: 'center', rotationAlignment: 'map' })
            .setLngLat(state.position)
            .setRotation(state.bearing - 135)
            .addTo(miniMapRef.current!);
        } else {
          busMarker.setLngLat(state.position);
          busMarker.setRotation(state.bearing - 135);
        }
      }
      frameId = requestAnimationFrame(track);
    };
    frameId = requestAnimationFrame(track);
    return () => {
      cancelAnimationFrame(frameId);
      busMarker?.remove();
      busMarker = null;
    };
  }, [selectedBus, dark]);

  useEffect(() => {
    if (selectedBus === null) return;

    const timer = window.setInterval(() => {
      setPopupTick((value) => value + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [selectedBus]);

  // Update search results in real-time every second while search is open
  useEffect(() => {
    if (!searchOpen) return;

    const timer = window.setInterval(() => {
      setSearchTick((value) => value + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [searchOpen]);

  const busState = selectedBus !== null ? liveStateRef.current[selectedBus] : null;
  const busRoute = selectedBus !== null ? liveRoutesRef.current[selectedBus] ?? null : null;
  const busGoingForward = busState ? busState.distanceAlong <= busState.forwardEndDistance : true;
  const passByEstimate: PassByEstimate = popupTick >= 0 ? getPassByEstimate(userLngLatRef.current, busState, busRoute) : { label: 'Location pending', status: 'unknown' };

  return (
    <div className={`relative h-screen w-screen overflow-hidden transition-colors duration-500 ${dark ? 'bg-[rgb(27,26,26)]' : 'bg-[#f8fafc]'}`}>
      {/* Map View */}
      <div 
        ref={mapContainerRef} 
        className={`h-full w-full transition-opacity duration-500 ${tilesLoading ? 'opacity-70' : 'opacity-100'} ${settingsOpen || searchOpen || alertOpen ? 'pointer-events-none' : ''}`}
      />

      {/* Settings Screen */}
      <section
        className={`absolute inset-0 z-10 flex flex-col px-5 pb-24 pt-8 transition-all duration-500 ease-out
          ${settingsOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0'}
          ${dark ? 'bg-[rgb(27,26,26)] text-white' : 'bg-[#f8fafc] text-slate-900'}`}
      >
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        </div>

        <div className={`divide-y ${dark ? 'divide-white/10' : 'divide-slate-200'}`}>
          <div className="flex items-center justify-between py-4 px-1">
            <div>
              <div className="font-semibold">Appearance</div>
              <div className={`text-sm ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Light or dark mode</div>
            </div>
            <button
              type="button"
              onClick={() => setPreferredTheme(dark ? 'light' : 'dark')}
              className={`relative inline-flex h-8 w-[58px] items-center rounded-full transition-colors ${dark ? 'bg-white/10' : 'bg-slate-200'}`}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              <span className={`flex h-7 w-7 items-center justify-center rounded-full shadow-sm transition-transform ${dark ? 'translate-x-[30px] bg-[rgb(27,26,26)]' : 'translate-x-0 bg-white'}`}>
                {dark ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                  </svg>
                )}
              </span>
            </button>
          </div>

          <div className="flex items-center justify-between py-4 px-1">
            <div>
              <div className="font-semibold">Locator icon</div>
              <div className={`text-sm ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Your map marker</div>
            </div>
            <div className="flex gap-2.5">
              {(['default', 'female'] as LocatorIconType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => selectLocatorIcon(type)}
                  className={`flex h-11 w-11 items-center justify-center rounded-xl border transition-all duration-150 ${
                    selectedLocator === type
                      ? dark
                        ? 'border-white/25 bg-white/10 shadow-sm'
                        : 'border-slate-300 bg-slate-100 shadow-sm'
                      : dark
                        ? 'border-white/10 bg-white/[0.04] hover:bg-white/[0.07]'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                  aria-label={`Use ${type} locator icon`}
                >
                  <span
                    className="h-7 w-7 flex items-center justify-center"
                    dangerouslySetInnerHTML={{ __html: getUserLocationSvg(type).replace('width="32" height="32"', 'width="28" height="28"') }}
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Alert Screen */}
      <section
        className={`absolute inset-0 z-10 flex flex-col px-5 pb-24 pt-8 transition-all duration-500 ease-out
          ${alertOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0'}
          ${dark ? 'bg-[rgb(27,26,26)] text-white' : 'bg-[#f8fafc] text-slate-900'}`}
      >
        <div className="mb-5 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Alerts</h2>
            <p className={`mt-1 text-sm ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Active notifications</p>
          </div>
        </div>

        {userAlerts.length > 0 ? (
          <div className="flex-1 overflow-y-auto -mx-5 px-5 space-y-3 pb-4">
            {userAlerts.map((alert, idx) => {
              const state = liveStateRef.current[alert.busIdx];
              const route = liveRoutesRef.current[alert.busIdx];
              const estimate = state && route ? getPassByEstimate(userLngLatRef.current, state, route) : { label: 'Waiting', status: 'unknown' };

              return (
                <div
                  key={idx}
                  className={`relative p-4 rounded-2xl border ${dark ? 'bg-white/[0.04] border-white/8' : 'bg-white border-slate-100 shadow-sm'}`}
                >
                  <button
                    onClick={() => deleteAlert(idx)}
                    className={`absolute top-3 right-3 p-1.5 rounded-lg transition-colors ${dark ? 'text-slate-600 hover:text-rose-400 hover:bg-white/5' : 'text-slate-300 hover:text-rose-500 hover:bg-slate-50'}`}
                    aria-label="Delete alert"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>

                  <div className="flex items-center gap-3 mb-3 pr-8">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${dark ? 'bg-teal-500/15' : 'bg-teal-50'}`}>
                      <img src={BUS_ICON_URL} alt="" className="h-6 w-6 object-contain" />
                    </div>
                    <div>
                      <div className="font-bold text-[15px]">UK07BE9907</div>
                      <div className={`text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                        {state?.distanceAlong <= state?.forwardEndDistance ? 'IT Park → Clock Tower' : 'Clock Tower → IT Park'}
                      </div>
                    </div>
                  </div>

                  <div className={`flex items-center justify-between rounded-xl px-3 py-2 ${dark ? 'bg-white/[0.04]' : 'bg-slate-50'}`}>
                    <span className={`text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Notify me at</span>
                    <span className={`text-sm font-extrabold tracking-tight ${dark ? 'text-teal-400' : 'text-teal-600'}`}>{estimate.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-1 w-full items-center justify-center text-center">
            <div className="px-6">
              <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${dark ? 'bg-white/[0.04]' : 'bg-slate-50'}`}>
                <svg width="28" height="28" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" className={dark ? 'text-slate-600' : 'text-slate-300'}>
                  <path d="M256 64c-17.67 0-32 14.33-32 32 0 6.4 1.92 12.48 5.12 17.6C175.36 128.96 135.68 176.64 135.68 233.28V288C135.68 335.68 110.72 379.2 78.08 402.56C69.12 408.96 64 419.2 64 429.76C64 447.04 77.76 460.8 94.4 460.8H417.6C434.24 460.8 448 447.04 448 429.76C448 419.2 442.88 408.96 433.92 402.56C401.28 379.2 376.32 335.68 376.32 288V233.28C376.32 176.64 336.64 128.96 282.88 113.6C286.08 108.48 288 102.4 288 96C288 78.33 273.67 64 256 64Z" fill="currentColor" />
                  <circle cx="256" cy="460" r="28" fill="currentColor" />
                </svg>
              </div>
              <p className={`mt-4 text-sm ${dark ? 'text-slate-500' : 'text-slate-400'}`}>No active alerts yet.</p>
              <p className={`mt-1 text-xs ${dark ? 'text-slate-600' : 'text-slate-400'}`}>Tap the alert icon on a bus card to get started.</p>
            </div>
          </div>
        )}
      </section>

      {/* Search Screen */}
      <section
        className={`absolute inset-0 z-10 flex flex-col px-5 pb-24 pt-8 transition-all duration-500 ease-out
          ${searchOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0'}
          ${dark ? 'bg-[rgb(27,26,26)] text-white' : 'bg-[#f8fafc] text-slate-900'}`}
      >
        <div className="mb-4">
          <h2 className="text-2xl font-bold tracking-tight">Search</h2>
        </div>

        {/* Search bar */}
        <div
          className={`flex h-[48px] items-center gap-3 rounded-2xl px-4 border transition-colors duration-200 ${dark ? 'bg-white/[0.06] border-white/10 focus-within:border-white/25' : 'bg-white border-slate-200 shadow-sm focus-within:border-slate-400 focus-within:shadow-md'}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`shrink-0 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search bus number or destination"
            className={`h-full flex-1 bg-transparent text-[15px] font-normal outline-none pr-1 ${dark ? 'text-slate-100 placeholder:text-slate-500' : 'text-slate-900 placeholder:text-slate-400'}`}
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedDestination(null);
              }}
              className={`flex h-6 w-6 items-center justify-center rounded-full ${dark ? 'text-slate-500 hover:bg-white/10' : 'text-slate-400 hover:bg-slate-100'}`}
              aria-label="Clear search"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Destination chips */}
        <div className="mt-4">
          <h3 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Where are you going?</h3>
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
            {['IT Park', 'Clock Tower', 'Rajpur Road', 'Sahastradhara', 'ISBT', 'Survey Chowk', 'Rajpur'].map((dest) => (
              <button
                key={dest}
                onClick={() => {
                  setSearchQuery(dest);
                  setSelectedDestination(dest);
                }}
                className={`px-4 py-2 rounded-xl border text-sm font-medium whitespace-nowrap transition-all duration-150 ${
                  selectedDestination === dest
                    ? dark ? 'border-white/25 bg-white/10' : 'border-slate-300 bg-slate-100'
                    : dark ? 'border-white/10 bg-white/[0.04] hover:bg-white/[0.07]' : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                {dest}
              </button>
            ))}
          </div>
        </div>

        {/* Results area */}
        <div className="mt-5 flex-1 overflow-y-auto -mx-5 px-5 pb-4">
          {liveBusPositionsRef.current.length > 0 ? (
            <div>
              <h3 className={`text-xs font-semibold uppercase tracking-wider mb-3 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Nearby Active Buses</h3>
              <div className="space-y-2.5">
                {getMockBusPlans().map((plan, idx) => {
                  void searchTick;

                  const state = liveStateRef.current[idx];
                  const route = liveRoutesRef.current[idx];
                  if (!state || !route) return null;

                  const userPos = userLngLatRef.current;
                  const estimate = getPassByEstimate(userPos, state, route);
                  const isMissed = estimate.status === 'missed';

                  // Real-time distance from user
                  let distLabel = '--';
                  if (userPos) {
                    const mLat = 110540;
                    const mLng = 111320 * Math.cos((userPos[1] * Math.PI) / 180);
                    const dx = (state.position[0] - userPos[0]) * mLng;
                    const dy = (state.position[1] - userPos[1]) * mLat;
                    const m = Math.sqrt(dx * dx + dy * dy);
                    distLabel = m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
                  }

                  const goingForward = state.distanceAlong <= state.forwardEndDistance;
                  const routeLabel = goingForward ? 'IT Park → Clock Tower' : 'Clock Tower → IT Park';
                  const destName = routeLabel.split('→')[1]?.trim() || '';

                  const matchesSearch = searchQuery
                    ? plan.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      routeLabel.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      destName.toLowerCase().includes(searchQuery.toLowerCase())
                    : true;

                  if (!matchesSearch) return null;

                  return (
                    <div
                      key={plan.id}
                      onClick={() => handleCardClick(idx)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') handleCardClick(idx);
                      }}
                      role="button"
                      tabIndex={0}
                      className={`w-full text-left p-4 rounded-2xl border transition-all active:scale-[0.99] ${dark ? 'bg-white/[0.04] border-white/8 hover:bg-white/[0.07]' : 'bg-white border-slate-100 shadow-sm hover:shadow-md'}`}
                    >
                      {/* Top Section: Header & Status */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${dark ? 'bg-teal-500/15' : 'bg-teal-50'}`}>
                            <img src={BUS_ICON_URL} alt="" className="h-6 w-6 object-contain" />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`font-bold text-[15px] leading-none ${dark ? 'text-white' : 'text-slate-900'}`}>
                                UK07BE9907
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyBusNumber();
                                }}
                                className={`flex items-center justify-center p-0.5 rounded transition-colors ${dark ? 'text-slate-600 hover:text-slate-400' : 'text-slate-300 hover:text-slate-500'}`}
                                aria-label="Copy bus number"
                              >
                                {copiedBusNumber ? (
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M20 6L9 17l-5-5" />
                                  </svg>
                                ) : (
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                                  </svg>
                                )}
                              </button>
                            </div>
                            <div className={`text-xs mt-1.5 truncate ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                              {routeLabel}
                            </div>
                          </div>
                        </div>

                        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full shrink-0 ${state.isMoving ? (dark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-600') : (dark ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-600')}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${state.isMoving ? 'bg-emerald-400 dot-breathe text-emerald-400' : 'bg-amber-400'}`} />
                          <span className="text-[10px] font-semibold uppercase tracking-wider leading-none">
                            {state.isMoving ? 'Moving' : 'Stopped'}
                          </span>
                        </div>
                      </div>

                      <div className={`mt-2 text-[10px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                        Last seen · just now
                      </div>

                      <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                        <div className={`flex flex-col min-h-11 items-center justify-center rounded-xl px-3 ${dark ? 'bg-white/[0.04]' : 'bg-[rgb(249,250,253)]'}`}>
                          <span className={`text-[8px] uppercase tracking-wider mb-0.5 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Distance</span>
                          <div className="flex items-center gap-1">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className={dark ? 'text-slate-500' : 'text-slate-400'}>
                              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="currentColor" opacity="0.5" />
                              <circle cx="12" cy="9" r="2" fill={dark ? 'rgb(35,33,33)' : '#ffffff'} />
                            </svg>
                            <span className={`text-xs font-bold ${dark ? 'text-slate-300' : 'text-slate-600'}`}>{isMissed ? '--' : distLabel}</span>
                          </div>
                        </div>

                        <div className={`flex flex-col min-h-11 items-center justify-center rounded-xl px-2 ${dark ? 'bg-white/[0.04]' : 'bg-[rgb(249,250,253)]'}`}>
                          <span className={`text-[8px] uppercase tracking-wider mb-0.5 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Arrival</span>
                          <span className={`text-[11px] font-extrabold leading-tight tracking-tight ${isMissed ? (dark ? 'text-rose-400' : 'text-rose-500') : (dark ? 'text-teal-400' : 'text-teal-700')}`}>
                            {isMissed ? 'Missed' : estimate.label}
                          </span>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isMissed) {
                              setActiveAlert({ busIdx: idx, step: 'select' });
                            } else {
                              const btn = e.currentTarget;
                              btn.classList.add('animate-shake');
                              setTimeout(() => btn.classList.remove('animate-shake'), 400);
                            }
                          }}
                          className={`flex h-11 w-11 items-center justify-center rounded-xl transition-all ${
                            isMissed 
                              ? 'bg-slate-100 dark:bg-white/[0.02] text-slate-400 dark:text-slate-600 opacity-50' 
                              : dark ? 'bg-white/[0.04] text-amber-400 hover:bg-white/[0.08]' : 'bg-[rgb(249,250,253)] text-amber-500 hover:bg-slate-100'
                          }`}
                          aria-label="Set alert"
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
                            <path d="M10.3 21a1.94 1.94 0 003.4 0" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16">
              <div className={`flex h-16 w-16 items-center justify-center rounded-full ${dark ? 'bg-white/[0.06]' : 'bg-slate-100'}`}>
                <img src={SEARCH_ICON_URL} alt="" className="h-8 w-8 opacity-50" />
              </div>
              <p className={`mt-4 text-sm ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Waiting for buses to appear...</p>
            </div>
          )}
        </div>
      </section>

      {/* Alert Popup Overlay */}
      {activeAlert && (() => {
        const alertBusIdx = activeAlert.busIdx;
        const state = liveStateRef.current[alertBusIdx];
        const route = liveRoutesRef.current[alertBusIdx];
        if (!state || !route) return null;

        const estimate = getPassByEstimate(userLngLatRef.current, state, route);
        // Dynamic options for Alert Popup based on the actual real-time pass-by ETA
        const passBySeconds = getPassBySeconds(userLngLatRef.current, state, route);
        const totalSeconds = passBySeconds ?? 0;
        const formatAlertLead = (seconds: number) => seconds < 60 ? `${Math.max(10, Math.round(seconds))} sec` : `${Math.floor(seconds / 60)} min`;
        const rawLeadSeconds = totalSeconds > 0
          ? [totalSeconds * 0.25, totalSeconds * 0.5, totalSeconds * 0.75]
          : [];
        const popupAlertOptions = Array.from(
          new globalThis.Map<string, { seconds: number; label: string }>(
            rawLeadSeconds
              .filter((seconds) => seconds > 8 && seconds < totalSeconds - 5)
              .map((seconds) => [formatAlertLead(seconds), { seconds, label: formatAlertLead(seconds) }])
          ).values()
        ).slice(0, 3);
        if (popupAlertOptions.length === 0 && totalSeconds > 8) {
          const fallbackSeconds = Math.max(5, Math.min(totalSeconds - 3, totalSeconds * 0.5));
          popupAlertOptions.push({ seconds: fallbackSeconds, label: formatAlertLead(fallbackSeconds) });
        }

        return (
          <div className="absolute inset-0 z-[100] flex items-center justify-center px-6 backdrop-blur-md bg-black/40">
            <div className={`w-full max-w-sm rounded-3xl border shadow-2xl overflow-hidden ${dark ? 'bg-[rgb(35,33,33)] border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'}`}>
              {activeAlert.step === 'select' ? (
                <div className="p-6 space-y-5">
                  <div className="text-center">
                    <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${dark ? 'bg-amber-500/15' : 'bg-amber-50'}`}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={dark ? 'text-amber-400' : 'text-amber-500'}>
                        <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
                        <path d="M10.3 21a1.94 1.94 0 003.4 0" />
                      </svg>
                    </div>
                    <h3 className="mt-4 text-lg font-bold tracking-tight">Add Alert</h3>
                    <p className={`mt-1 text-sm ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                      Get notified before the bus arrives so you don't miss it.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    {popupAlertOptions.map((option) => (
                      <button
                        key={option.label}
                        onClick={() => createAlert(alertBusIdx, Math.max(1, Math.round(option.seconds / 60)), option.label)}
                        className={`flex flex-col items-center justify-center py-3 rounded-xl border font-medium transition-all active:scale-95 ${
                          dark
                            ? 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-amber-400'
                            : 'border-slate-200 bg-white hover:bg-slate-50 text-amber-600 shadow-sm'
                        }`}
                      >
                        <span className="text-lg font-bold">{option.label.split(' ')[0]}</span>
                        <span className={`text-[10px] uppercase tracking-wide ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                          {option.label.split(' ')[1]}
                        </span>
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => setActiveAlert(null)}
                    className={`w-full py-3 rounded-xl text-sm font-medium transition-colors ${dark ? 'text-slate-400 hover:text-slate-300 hover:bg-white/5' : 'text-slate-500 hover:text-slate-600 hover:bg-slate-50'}`}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="p-6 space-y-5 text-center">
                  <div className="flex items-center justify-center gap-4">
                    {/* Bus Icon */}
                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${dark ? 'bg-teal-500/15' : 'bg-teal-50'}`}>
                      <img src={BUS_ICON_URL} alt="" className="h-7 w-7 object-contain" />
                    </div>

                    {/* Pass By Time in Center */}
                    <div className="flex flex-col items-center">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className={dark ? 'text-slate-600' : 'text-slate-300'}>
                        <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className={`mt-1 text-xl font-extrabold tracking-tight ${dark ? 'text-teal-400' : 'text-teal-600'}`}>
                        {estimate.label}
                      </span>
                      <span className={`text-[10px] uppercase tracking-wider ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Pass by</span>
                    </div>

                    {/* User Icon */}
                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${dark ? 'bg-white/[0.06]' : 'bg-slate-100'}`}>
                      <span className="h-7 w-7" dangerouslySetInnerHTML={{ __html: getUserLocationSvg(selectedLocator).replace('width="32" height="32"', 'width="28" height="28"') }} />
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-bold tracking-tight">Alert Set</h3>
                    <p className={`mt-1 text-sm ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                      You'll be notified when the bus is <strong>{userAlerts[userAlerts.length - 1]?.etaOffset} mins</strong> away.
                    </p>
                  </div>

                  <button
                    onClick={() => trackBusClick(activeAlert.busIdx)}
                    className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors ${
                      dark 
                        ? 'bg-white/15 text-white hover:bg-white/20' 
                        : 'bg-slate-900 text-white hover:bg-slate-800'
                    }`}
                  >
                    Track Bus
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Clean map tiles loading indicator — app-native style */}
      {tilesLoading && (
        <div className={`absolute bottom-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 px-5 py-2.5 rounded-full shadow-lg transition-all duration-300 ${dark ? 'bg-[rgb(45,43,43)] text-slate-200' : 'bg-white text-slate-700'}`}>
          <div className={`h-4 w-4 rounded-full border-[2.5px] border-t-transparent animate-spin ${dark ? 'border-teal-400' : 'border-teal-500'}`} />
          <span className="text-xs font-medium tracking-wide">Updating map...</span>
        </div>
      )}



      {/* Bottom Navigation Bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-20 shadow-2xl backdrop-blur-md border-t transition-colors duration-500
          ${dark ? 'bg-[rgb(35,33,33)]/95 border-white/5 shadow-black/50' : 'bg-white/95 border-slate-200 shadow-slate-300/60'}`}
      >
        <div className="grid grid-cols-5 w-full" style={{ height: '52px' }}>
          {/* Slot 1 — Locate */}
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(false);
              setSearchOpen(false);
              setAlertOpen(false);
              fitHomeView();
            }}
            className={`nav-btn ${dark ? 'nav-btn-dark' : 'nav-btn-light'} flex flex-col items-center justify-center w-full h-full`}
            aria-label="Fit view to your location and buses"
          >
            <span
              className="h-6 w-6 flex items-center justify-center"
              dangerouslySetInnerHTML={{ __html: getUserLocationSvg(selectedLocator).replace('width="32" height="32"', 'width="24" height="24"') }}
            />
            <span className={`text-[10px] font-semibold mt-0.5 select-none pointer-events-none ${dark ? 'text-slate-300' : 'text-slate-700'}`}>Locate</span>
          </button>

          {/* Slot 2 — Route (toggle) */}
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(false);
              setSearchOpen(false);
              setAlertOpen(false);
              setRoutesVisible((value) => !value);
            }}
            className={`nav-btn flex flex-col items-center justify-center w-full h-full ${routesVisible ? (dark ? 'nav-btn-on-dark' : 'nav-btn-on-light') : (dark ? 'nav-btn-dark' : 'nav-btn-light')}`}
            aria-label={routesVisible ? 'Hide bus routes' : 'Show bus routes'}
          >
            <img src={ROUTE_ICON_URL} alt="" draggable="false" className="h-5 w-5 object-contain pointer-events-none" />
            <span className={`text-[9px] font-medium mt-1 select-none pointer-events-none ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Route</span>
          </button>

          {/* Slot 3 — Alert */}
          <button
            type="button"
            onClick={() => {
              closeBusPopup();
              setSettingsOpen(false);
              setSearchOpen(false);
              setAlertOpen((value) => !value);
            }}
            className={`nav-btn relative flex flex-col items-center justify-center w-full h-full ${alertOpen ? (dark ? 'nav-btn-on-dark' : 'nav-btn-on-light') : (dark ? 'nav-btn-dark' : 'nav-btn-light')}`}
            aria-label="Alerts"
          >
            <svg width="22" height="22" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="pointer-events-none">
              <path d="M256 64c-17.67 0-32 14.33-32 32 0 6.4 1.92 12.48 5.12 17.6C175.36 128.96 135.68 176.64 135.68 233.28V288C135.68 335.68 110.72 379.2 78.08 402.56C69.12 408.96 64 419.2 64 429.76C64 447.04 77.76 460.8 94.4 460.8H417.6C434.24 460.8 448 447.04 448 429.76C448 419.2 442.88 408.96 433.92 402.56C401.28 379.2 376.32 335.68 376.32 288V233.28C376.32 176.64 336.64 128.96 282.88 113.6C286.08 108.48 288 102.4 288 96C288 78.33 273.67 64 256 64Z" fill="#FFC107"/>
              <circle cx="256" cy="460" r="28" fill="#FF9800"/>
              <path d="M96 200C96 156.93 115.36 118.72 145.28 92.16" stroke="#FF9800" stroke-width="16" stroke-linecap="round"/>
              <path d="M96 256C96 233.28 106.24 213.12 122.24 199.68" stroke="#FF9800" stroke-width="16" stroke-linecap="round"/>
              <path d="M416 200C416 156.93 396.64 118.72 366.72 92.16" stroke="#FF9800" stroke-width="16" stroke-linecap="round"/>
              <path d="M416 256C416 233.28 405.76 213.12 389.76 199.68" stroke="#FF9800" stroke-width="16" stroke-linecap="round"/>
              <path d="M192 160C192 124.65 220.65 96 256 96" stroke="#FFF176" stroke-width="16" stroke-linecap="round"/>
            </svg>
            {userAlerts.length > 0 && (
              <span className="absolute top-[5px] right-[7px] flex h-[12px] w-[12px] items-center justify-center rounded-full bg-rose-500 text-[7px] font-bold text-white shadow-lg animate-pulse">
                {Math.min(userAlerts.length, 9)}
              </span>
            )}
            <span className={`text-[10px] font-semibold mt-0.5 select-none pointer-events-none ${dark ? 'text-slate-300' : 'text-slate-700'}`}>Alert</span>
          </button>

          {/* Slot 4 — Search (toggle) */}
          <button
            type="button"
            onClick={() => {
              closeBusPopup();
              setSettingsOpen(false);
              setAlertOpen(false);
              setSearchOpen((value) => {
                if (value) {
                  setSearchQuery('');
                  setSelectedDestination(null);
                }
                return !value;
              });
            }}
            className={`nav-btn flex flex-col items-center justify-center w-full h-full ${searchOpen ? (dark ? 'nav-btn-on-dark' : 'nav-btn-on-light') : (dark ? 'nav-btn-dark' : 'nav-btn-light')}`}
            aria-label={searchOpen ? 'Close search' : 'Open search'}
          >
            <img src={SEARCH_ICON_URL} alt="" draggable="false" className="h-5 w-5 object-contain pointer-events-none" />
            <span className={`text-[9px] font-medium mt-1 select-none pointer-events-none ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Search</span>
          </button>

          {/* Slot 5 — Settings (toggle) */}
          <button
            type="button"
            onClick={() => {
              closeBusPopup();
              setSearchOpen(false);
              setAlertOpen(false);
              setSettingsOpen((value) => !value);
            }}
            className={`nav-btn flex flex-col items-center justify-center w-full h-full ${settingsOpen ? (dark ? 'nav-btn-on-dark' : 'nav-btn-on-light') : (dark ? 'nav-btn-dark' : 'nav-btn-light')}`}
            aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
          >
            <img src={GEAR_ICON_URL} alt="" draggable="false" className="h-5 w-5 object-contain pointer-events-none" />
            <span className={`text-[9px] font-medium mt-1 select-none pointer-events-none ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Settings</span>
          </button>
        </div>
      </div>

      {/* Bus Detail Card */}
      {selectedBus !== null && (
        <>
          <div className={`absolute inset-0 z-[80] bg-black/40 backdrop-blur-sm transition-opacity duration-200 ${busPopupClosing ? 'opacity-0' : 'bus-backdrop-in opacity-100'}`} onClick={closeBusPopup} />
          <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[81] flex flex-col items-center transition-all duration-200 ease-out ${busPopupClosing ? 'scale-[0.98] opacity-0' : 'bus-popup-in scale-100 opacity-100'}`} onClick={closeBusPopup}>
            {/* Popup card */}
            <div className={`w-[calc(100vw-2rem)] max-w-sm rounded-3xl border shadow-2xl overflow-hidden ${dark ? 'bg-[rgb(35,33,33)] border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'}`} onClick={(e) => e.stopPropagation()}>
              {/* Mini map */}
              <div ref={miniMapContainerRef} className="w-full h-40 rounded-t-3xl" />

              {/* Info */}
              <div className="p-5 space-y-4">
                 {/* Bus number - centered */}
                 <div className="text-center">
                   <div className="inline-flex items-center gap-2 mb-1">
                     <img src={BUS_ICON_URL} className="w-8 h-8 object-contain" />
                     <span className="font-bold text-base">UK07BE9907</span>
                     <button
                       onClick={(e) => {
                         e.stopPropagation();
                         copyBusNumber();
                       }}
                       className={`flex items-center justify-center p-1 rounded-lg transition-colors ${dark ? 'text-slate-600 hover:text-slate-400 hover:bg-white/5' : 'text-slate-300 hover:text-slate-500 hover:bg-slate-50'}`}
                       aria-label="Copy bus number"
                     >
                       {copiedBusNumber ? (
                         <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                           <path d="M20 6L9 17l-5-5" />
                         </svg>
                       ) : (
                         <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                           <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                           <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                         </svg>
                       )}
                     </button>
                   </div>
                   <div className={`text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>Doon Smart City e-Bus</div>
                 </div>

                {/* Status grid - centered titles and content */}
                <div className={`grid grid-cols-2 gap-3 text-xs ${dark ? 'text-slate-300' : 'text-slate-600'}`}>
                  <div className={`rounded-2xl p-3 text-center ${dark ? 'bg-white/5' : 'bg-slate-50'}`}>
                    <div className={`text-[10px] uppercase tracking-wider mb-1 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Last seen</div>
                    <div className="font-semibold text-sm">Just now</div>
                  </div>
                  <div className={`rounded-2xl p-3 text-center ${dark ? 'bg-white/5' : 'bg-slate-50'}`}>
                    <div className={`text-[10px] uppercase tracking-wider mb-1 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Bus status</div>
                    <div className="font-semibold text-sm flex items-center justify-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${busState?.isMoving ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      {busState?.isMoving ? 'Moving' : 'Stopped'}
                    </div>
                  </div>
                </div>

                {/* Route direction - centered */}
                <div className={`rounded-2xl p-3 text-center ${dark ? 'bg-white/5' : 'bg-slate-50'}`}>
                  <div className={`text-[10px] uppercase tracking-wider mb-1 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Going to</div>
                  <div className="font-semibold text-sm">
                    {busGoingForward ? 'IT Park → Clock Tower' : 'Clock Tower → IT Park'}
                  </div>
                </div>

                <div className="grid grid-cols-[1fr_auto] gap-3">
                  <div className={`rounded-2xl p-3 text-center ${dark ? 'bg-white/5' : 'bg-slate-50'}`}>
                    <div className={`text-[10px] uppercase tracking-wider mb-1 ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Pass by</div>
                    <div className={`font-bold text-base leading-tight ${passByEstimate.status === 'missed' ? 'text-rose-500' : passByEstimate.status === 'ok' ? 'text-teal-600' : (dark ? 'text-slate-300' : 'text-slate-700')}`}>
                      {passByEstimate.label}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (passByEstimate.status !== 'missed') {
                        setActiveAlert({ busIdx: selectedBus, step: 'select' });
                      } else {
                        const btn = e.currentTarget;
                        btn.classList.add('animate-shake');
                        setTimeout(() => btn.classList.remove('animate-shake'), 400);
                      }
                    }}
                    className={`flex w-[64px] items-center justify-center rounded-2xl transition-all ${
                      passByEstimate.status === 'missed' 
                        ? 'bg-slate-100 dark:bg-white/[0.02] text-slate-400 dark:text-slate-600 opacity-50' 
                        : dark ? 'bg-white/5 text-amber-400 hover:bg-white/10' : 'bg-slate-50 text-amber-500 hover:bg-slate-100'
                    }`}
                    aria-label="Set alert for this bus"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
                      <path d="M10.3 21a1.94 1.94 0 003.4 0" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Close button — always directly below the card */}
            <button
              type="button"
              onClick={closeBusPopup}
              aria-label="Close"
              className={`mt-3 flex h-10 w-10 items-center justify-center rounded-full shadow-2xl transition active:scale-90
                ${dark ? 'bg-[rgb(35,33,33)] text-white border border-white/10 hover:bg-[rgb(45,43,43)]' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </>
      )}



      {locationLoader !== 'hidden' && (
        <div className={`absolute inset-0 z-[90] flex flex-col items-center justify-center transition-colors duration-500 ${dark ? 'bg-[rgb(27,26,26)]' : 'bg-[#f8fafc]'}`}>
          {locationLoader === 'requesting' ? (
            /* Location permission request — full-screen, app-native feel */
            <div className="flex flex-col items-center px-8 text-center">
              {/* Location pin icon */}
              <div className={`flex h-20 w-20 items-center justify-center rounded-full ${dark ? 'bg-white/[0.06]' : 'bg-slate-100'}`}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill={dark ? '#5eead4' : '#14b8a6'} />
                  <circle cx="12" cy="9" r="2.5" fill={dark ? 'rgb(45,43,43)' : '#ffffff'} />
                </svg>
              </div>

              <h2 className={`mt-6 text-xl font-bold tracking-tight ${dark ? 'text-white' : 'text-slate-900'}`}>
                Enable Location
              </h2>
              <p className={`mt-2.5 text-sm leading-6 max-w-[260px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                We need your location to show nearby e-buses and estimate arrival times.
              </p>

              {/* Animated dots to indicate waiting */}
              <div className="mt-8 flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full animate-pulse ${dark ? 'bg-teal-400' : 'bg-teal-500'}`} style={{ animationDelay: '0ms' }} />
                <span className={`h-2 w-2 rounded-full animate-pulse ${dark ? 'bg-teal-400' : 'bg-teal-500'}`} style={{ animationDelay: '300ms' }} />
                <span className={`h-2 w-2 rounded-full animate-pulse ${dark ? 'bg-teal-400' : 'bg-teal-500'}`} style={{ animationDelay: '600ms' }} />
              </div>
              <span className={`mt-3 text-xs ${dark ? 'text-slate-500' : 'text-slate-400'}`}>Waiting for permission...</span>
            </div>
          ) : (
            /* Fetching location — loading spinner, app-native feel */
            <div className="flex flex-col items-center px-8 text-center">
              {/* Spinner */}
              <div className={`relative flex h-16 w-16 items-center justify-center`}>
                <div className={`absolute inset-0 rounded-full border-[3px] ${dark ? 'border-white/[0.06]' : 'border-slate-200'}`} />
                <div className={`absolute inset-0 rounded-full border-[3px] border-transparent animate-spin ${dark ? 'border-t-teal-400' : 'border-t-teal-500'}`} />
                {/* Inner pin icon */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill={dark ? '#5eead4' : '#14b8a6'} />
                  <circle cx="12" cy="9" r="2.5" fill={dark ? 'rgb(45,43,43)' : '#ffffff'} />
                </svg>
              </div>

              <h2 className={`mt-5 text-lg font-semibold tracking-tight ${dark ? 'text-white' : 'text-slate-900'}`}>
                Finding you...
              </h2>
              <p className={`mt-1.5 text-sm ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                Setting up the map around your location
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
