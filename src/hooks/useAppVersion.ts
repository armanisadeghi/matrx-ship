"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface VersionInfo {
  version: string;
  buildNumber: number;
  gitCommit?: string;
  deployedAt: string;
}

interface UseAppVersionOptions {
  /**
   * Base URL of the matrx-ship instance.
   * Example: "https://ship-myproject.yourdomain.com"
   * If not provided, uses relative URLs (for when this runs inside the ship app itself).
   */
  baseUrl?: string;

  /**
   * How often to check for updates (in milliseconds).
   * Default: 5 minutes (300000ms). Set to 0 to disable polling.
   */
  pollingInterval?: number;

  /**
   * Callback when a new version is detected.
   */
  onUpdateAvailable?: (
    newVersion: VersionInfo,
    currentVersion: VersionInfo,
  ) => void;

  /**
   * Enable debug logging.
   * Default: false
   */
  debug?: boolean;
}

/**
 * Hook to track app version and detect when updates are available.
 *
 * Works with any matrx-ship instance. Just provide the baseUrl.
 *
 * @example
 * const { isUpdateAvailable, reloadApp } = useAppVersion({
 *   baseUrl: "https://ship-myproject.yourdomain.com",
 *   pollingInterval: 300000,
 * });
 */
export function useAppVersion(options: UseAppVersionOptions = {}) {
  const {
    baseUrl = "",
    pollingInterval = 300000,
    onUpdateAvailable,
    debug = false,
  } = options;

  const [currentVersion, setCurrentVersion] = useState<VersionInfo | null>(
    null,
  );
  const [latestVersion, setLatestVersion] = useState<VersionInfo | null>(null);
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  const onUpdateAvailableRef = useRef(onUpdateAvailable);
  const isCheckingRef = useRef(false);

  useEffect(() => {
    onUpdateAvailableRef.current = onUpdateAvailable;
  }, [onUpdateAvailable]);

  const log = useCallback(
    (...args: unknown[]) => {
      if (debug) console.log("[useAppVersion]", ...args);
    },
    [debug],
  );

  const apiUrl = `${baseUrl}/api/version`;

  const fetchVersion = useCallback(async (): Promise<VersionInfo | null> => {
    try {
      const response = await fetch(apiUrl, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch version: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        version: data.version,
        buildNumber: data.buildNumber,
        gitCommit: data.gitCommit,
        deployedAt: data.deployedAt,
      };
    } catch (err) {
      log("Error fetching version:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      return null;
    }
  }, [apiUrl, log]);

  const isNewerVersion = useCallback(
    (newVer: VersionInfo, oldVer: VersionInfo): boolean => {
      if (newVer.buildNumber > oldVer.buildNumber) return true;
      if (new Date(newVer.deployedAt) > new Date(oldVer.deployedAt))
        return true;
      return false;
    },
    [],
  );

  const checkForUpdateRef = useRef<(() => Promise<void>) | undefined>(
    undefined,
  );

  const checkForUpdate = useCallback(async () => {
    if (isCheckingRef.current) return;

    isCheckingRef.current = true;
    setIsChecking(true);
    setError(null);
    log("Checking for update...");

    try {
      const version = await fetchVersion();
      if (!version) return;

      log("Fetched version:", version);

      setCurrentVersion((current) => {
        if (!current) {
          log("Setting initial version:", version);
          setLatestVersion(version);
          return version;
        }

        if (isNewerVersion(version, current)) {
          log("New version detected:", version);
          setLatestVersion(version);

          setIsDismissed((dismissed) => {
            const shouldShow = !dismissed;
            setIsUpdateAvailable(shouldShow);
            if (shouldShow && onUpdateAvailableRef.current) {
              onUpdateAvailableRef.current(version, current);
            }
            return dismissed;
          });
        } else {
          setLatestVersion(version);
        }

        return current;
      });
    } finally {
      isCheckingRef.current = false;
      setIsChecking(false);
    }
  }, [fetchVersion, isNewerVersion, log]);

  useEffect(() => {
    checkForUpdateRef.current = checkForUpdate;
  }, [checkForUpdate]);

  const dismissUpdate = useCallback(() => {
    setIsUpdateAvailable(false);
    setIsDismissed(true);
  }, []);

  const reloadApp = useCallback(async () => {
    log("Performing hard reset...");

    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && !key.startsWith("sb-") && !key.startsWith("supabase")) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Ignore
    }

    try {
      sessionStorage.clear();
    } catch {
      // Ignore
    }

    if ("caches" in window) {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      } catch {
        // Ignore
      }
    }

    if ("serviceWorker" in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
      } catch {
        // Ignore
      }
    }

    const url = new URL(window.location.href);
    url.searchParams.set("_reload", Date.now().toString());
    window.location.replace(url.toString());
  }, [log]);

  // Initial check
  useEffect(() => {
    checkForUpdateRef.current?.();
  }, []);

  // Clean up _reload param
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("_reload")) {
      url.searchParams.delete("_reload");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  // Polling
  useEffect(() => {
    if (pollingInterval <= 0) return;

    const intervalId = setInterval(() => {
      checkForUpdateRef.current?.();
    }, pollingInterval);

    return () => clearInterval(intervalId);
  }, [pollingInterval]);

  return {
    currentVersion,
    latestVersion,
    isUpdateAvailable,
    isChecking,
    error,
    checkForUpdate,
    dismissUpdate,
    reloadApp,
  };
}
