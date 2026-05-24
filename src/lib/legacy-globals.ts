// Bridge module: re-exports every public function from storage.ts and sync.ts
// onto `window` so the not-yet-converted UI files (script.js, ui-shared.js,
// source-water-ui.js, recipe-browser.js, my-recipes-ui.js, library-picker.js,
// stock-editor.js, diy-editor.js, estimate-water-ui.js, mineral-selector.js,
// login-modal.js, library-data.js) keep working without per-file changes.
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

import * as storage from "./storage";
import * as sync from "./sync";

Object.assign(window, storage, sync);
