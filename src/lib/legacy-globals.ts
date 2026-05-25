// Bridge module: re-exports every public function from storage.ts and sync.ts
// onto `window` so the not-yet-converted UI files (script.js,
// source-water-ui.js, recipe-browser.js, my-recipes-ui.js, library-picker.js,
// stock-editor.js, diy-editor.js, estimate-water-ui.js, mineral-selector.js,
// library-data.js) keep working without per-file changes.
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

import "./sentry-init";
import "./supabase-client";
import * as storage from "./storage";
import * as sync from "./sync";
import "../components/ui-shared";
import "../components/login-modal";

Object.assign(window, storage, sync);
