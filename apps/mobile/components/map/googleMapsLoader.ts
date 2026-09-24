/// <reference types="google.maps" />

/**
 * Minimal promise-based loader for the Google Maps JavaScript API — the only
 * Google-specific code on web, kept in one file. The key arrives through the
 * EXPO_PUBLIC_GOOGLE_MAPS_API_KEY build-time env var (Expo inlines it into
 * the bundle); it is never committed to source.
 */

declare global {
  interface Window {
    __campgroundMapsReady?: () => void;
  }
}

let loaderPromise: Promise<void> | null = null;
let loaderApiKey: string | null = null;

export function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps requires a browser environment"));
  }
  if (window.google?.maps) return Promise.resolve();
  // A key change invalidates the in-flight loader (not expected in practice).
  if (loaderPromise && loaderApiKey === apiKey) return loaderPromise;
  loaderApiKey = apiKey;
  loaderPromise = new Promise((resolve, reject) => {
    const callbackName = "__campgroundMapsReady";
    window[callbackName] = () => resolve();
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => {
      loaderPromise = null;
      reject(new Error("Failed to load the Google Maps JavaScript API — check the key and referrer restrictions"));
    };
    document.head.appendChild(script);
  });
  return loaderPromise;
}
