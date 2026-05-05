import type { LocationTrackingCallbacks, LngLat } from '../types/domain';

export function watchUserLocation(callbacks: LocationTrackingCallbacks) {
  if (!('geolocation' in navigator)) {
    callbacks.onLocationUnavailable();
    return () => {};
  }

  callbacks.onRequestingAccess();

  if ('permissions' in navigator) {
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((permission) => {
        if (permission.state === 'granted') callbacks.onFetchingLocation();
        if (permission.state === 'denied') callbacks.onLocationUnavailable();
      })
      .catch(() => {
        callbacks.onRequestingAccess();
      });
  }

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      const lngLat: LngLat = [position.coords.longitude, position.coords.latitude];
      callbacks.onLocationUpdate?.(lngLat);
    },
    () => {
      callbacks.onLocationUnavailable();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 8000,
      timeout: 15000,
    }
  );

  return () => navigator.geolocation.clearWatch(watchId);
}