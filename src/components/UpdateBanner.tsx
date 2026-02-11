"use client";

import { useState } from "react";
import { useAppVersion } from "@/hooks/useAppVersion";
import { RefreshCw, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface UpdateBannerProps {
  /**
   * Base URL of the matrx-ship instance.
   * Example: "https://ship-myproject.yourdomain.com"
   * If not provided, uses relative URLs.
   */
  baseUrl?: string;

  /**
   * How often to check for updates (in milliseconds).
   * Default: 5 minutes (300000ms)
   */
  pollingInterval?: number;

  /**
   * Position of the banner.
   * Default: "top"
   */
  position?: "top" | "bottom";

  /**
   * Custom className.
   */
  className?: string;
}

/**
 * Embeddable update banner component.
 * Displays a banner when a new version of the app is available.
 *
 * @example
 * <UpdateBanner
 *   baseUrl="https://ship-myproject.yourdomain.com"
 *   pollingInterval={300000}
 * />
 */
export function UpdateBanner({
  baseUrl,
  pollingInterval = 300000,
  position = "top",
  className,
}: UpdateBannerProps) {
  const [isReloading, setIsReloading] = useState(false);

  const { isUpdateAvailable, latestVersion, reloadApp, dismissUpdate } =
    useAppVersion({
      baseUrl,
      pollingInterval,
      debug: process.env.NODE_ENV === "development",
    });

  const handleReload = async () => {
    setIsReloading(true);
    await reloadApp();
  };

  if (!isUpdateAvailable) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed left-0 right-0 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg z-50",
        position === "top" ? "top-0" : "bottom-0",
        className,
      )}
      role="alert"
      aria-live="polite"
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 sm:py-3">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
            <div className="shrink-0 bg-white/20 rounded-full p-1.5 sm:p-2">
              <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                <span className="sm:hidden">New update</span>
                <span className="hidden sm:inline">
                  A new version is available
                </span>
                {latestVersion && (
                  <span className="ml-2 opacity-90 text-xs hidden sm:inline">
                    (v{latestVersion.version})
                  </span>
                )}
              </p>
              <p className="text-xs opacity-90 hidden sm:block">
                Click reload to get the latest features and fixes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={handleReload}
              disabled={isReloading}
              className={cn(
                "px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg font-medium text-sm",
                "bg-white text-blue-600 hover:bg-blue-50",
                "transition-colors duration-200",
                "focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-blue-600",
                "disabled:opacity-70 disabled:cursor-not-allowed",
              )}
            >
              {isReloading ? (
                <span className="flex items-center gap-1.5 sm:gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Updating...</span>
                </span>
              ) : (
                "Reload"
              )}
            </button>
            <button
              onClick={dismissUpdate}
              disabled={isReloading}
              className={cn(
                "p-1.5 sm:p-2 rounded-lg",
                "hover:bg-white/10",
                "transition-colors duration-200",
                "focus:outline-none focus:ring-2 focus:ring-white",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
              aria-label="Dismiss update notification"
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
