// Polyfills for the oldest WebViews the native apps run on. Imported first by
// both module entries (legacy-globals.ts and oauth-consent.ts).
//
// Array.prototype.at needs Chrome 92 / Safari 15.4. The app's own code does not
// call it, but @sentry/browser 11 does, in the layout-shift and interaction
// trackers it bundles: on an Android 11 device with WebView 90 every page threw
// "this.o.at is not a function" from Sentry's own PerformanceObserver callback
// (Sentry issue JAVASCRIPT-1E). Keep this until the SDK stops calling .at() or
// the apps stop supporting WebViews that old.

export function installArrayAt(proto: { at?: unknown }): void {
  if (typeof proto.at === "function") return;
  Object.defineProperty(proto, "at", {
    value: function at(this: ArrayLike<unknown>, index: number): unknown {
      const len = this.length;
      let i = Math.trunc(Number(index)) || 0;
      if (i < 0) i += len;
      return i < 0 || i >= len ? undefined : this[i];
    },
    writable: true,
    configurable: true,
  });
}

installArrayAt(Array.prototype);
