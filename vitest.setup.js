// Vitest setup: installs the browser-global stubs that storage.ts / sync.ts
// expect at module-evaluation time. Runs BEFORE any test file's imports
// execute, which is the reason this lives in setupFiles rather than at the
// top of each test — ESM `import` statements hoist above any sibling code,
// so we can't stub globals from inside a test file before importing source.
//
// Per-test reset happens via `localStorage.clear()` in each suite's
// beforeEach; the makeFakeStorage instance below survives across tests
// within a file and provides the .clear() / .length / .key() surface.

function makeFakeStorage() {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i) => Object.keys(store)[i] || null,
    get _store() {
      return store;
    },
  };
}

global.window = global;
global.document = { addEventListener: () => {} };
global.window.addEventListener = () => {};
global.localStorage = makeFakeStorage();
global.sessionStorage = makeFakeStorage();
global.window.supabaseClient = undefined;
// Default to "logged in" so transient-storage helpers route to localStorage.
// Tests that exercise the anonymous path override per-test.
global.isLoggedInSync = () => true;
global._cachedAuthUserId = "test-user-id";
