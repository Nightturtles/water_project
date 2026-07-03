// Bridge module: re-exports every public export from constants.ts, storage.ts,
// sync.ts, metrics.ts, and stock-format.ts onto `window` so the classic inline
// page scripts (e.g. the taste.html / minerals.html DOMContentLoaded blocks)
// and e2e page-context reads keep working without per-file changes.
//
// Both storage.ts and sync.ts ALSO populate window.* at the bottom of their
// own module bodies — that side-effect is what keeps unit tests working
// (the tests `require()` storage.ts / sync.ts directly without loading this
// bridge). The Object.assign here is belt-and-suspenders: importing this
// module triggers each underlying module's top-level side-effects (event
// listener registration, initSync kickoff), and then folds the named
// exports onto window so any UI script that grabs e.g. `loadSelectedMinerals`
// via lexical lookup sees the function.
//
// Window type augmentation lives in globals.d.ts — keeping it there avoids
// duplicating the per-function shape across files.
//
// Phase A PR (e): ui-shared and login-modal now live under src/components/
// as ES modules. They are pulled in via bare side-effect imports below; both
// modules self-publish their public API on window (the same pattern storage
// and sync use), so no Object.assign addition is needed for them.
//
// Phase A PR (h): sentry-init and supabase-client also live under src/lib
// and are imported here. Order matters: sentry-init FIRST so Sentry catches
// errors thrown by any subsequent import; supabase-client SECOND so
// window.supabaseClient exists before storage.ts and sync.ts read it.
//
// Phase A PR (k): capacitor-bootstrap is imported AFTER supabase-client so
// the deep-link handler can call window.supabaseClient.auth.exchangeCodeForSession
// without a null guard. On web the module is effectively a no-op (every
// side-effect is gated on Capacitor.isNativePlatform()).

import * as constants from "./constants";
import "./sentry-init";
// analytics-init gates GA4 loading (hostname / webdriver / opt-out). Imported
// right after sentry-init: no storage/supabase dependency, fired early so the
// GA queue + ?no-analytics strip happen near page load. Was a render-blocking
// <head> script pre-migration; GA's own gtag/js tag is async, so the deferred
// load is immaterial.
import "./analytics-init";
import "./html";
import "./supabase-client";
import "./capacitor-bootstrap";
import * as storage from "./storage";
import * as sync from "./sync";
import * as metrics from "./metrics";
import * as stockFormat from "./stock-format";
// library-data depends on storage (imports several of its helpers) and reads
// window.supabaseClient at call time, so it imports AFTER supabase-client and
// storage but BEFORE the component modules + classic consumers that reach its
// fns (getPublicRecipesSync, applyFilters, …) via window.*.
import "./library-data";
import "../components/ui-shared";
import "../components/login-modal";
import "./creator-display";
import "../components/recipe-card";
import "../components/stock-editor";
import "../components/diy-editor";
import "../components/estimate-water-ui";
import "../components/source-water-ui";
import "../components/library-picker";
import "../components/my-recipes-ui";
import "../components/mineral-selector";
import "../components/recipe-browser";

Object.assign(window, constants, storage, sync, metrics, stockFormat);
