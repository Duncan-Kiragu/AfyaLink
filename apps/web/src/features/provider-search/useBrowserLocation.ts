import { useCallback, useState } from "react";

export interface BrowserCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

/**
 * Browser geolocation lives in the web app, not in @kkd/integrations: the
 * integrations package also runs in the Express API and the BullMQ worker,
 * where `navigator` is undefined.
 *
 * Spec 9.5.A.1 - the permission prompt is only triggered by an explicit user
 * action, after the UI has explained why location is needed.
 */
export function useBrowserLocation() {
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback((): Promise<BrowserCoordinates> => {
    setIsRequesting(true);
    setError(null);

    return new Promise<BrowserCoordinates>((resolve, reject) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        const err = new Error("Geolocation is not supported on this device");
        setError(err.message);
        setIsRequesting(false);
        reject(err);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          setIsRequesting(false);
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        (positionError) => {
          const message =
            positionError.code === positionError.PERMISSION_DENIED
              ? "Location access denied. Please enter your location manually."
              : "Could not detect your location. Please enter it manually.";
          setError(message);
          setIsRequesting(false);
          reject(new Error(message));
        },
        { timeout: 10000, enableHighAccuracy: false }
      );
    });
  }, []);

  return { request, isRequesting, error };
}
