// Vitest configuration for Cafelytic unit tests.
// CommonJS — matches the default package.json (no "type": "module").
// Tests run in Node (no DOM needed for pure-logic files like metrics.js).
module.exports = {
  test: {
    environment: "node",
    globals: true, // describe/expect/test auto-injected — lets .test.js files stay CJS and just `require()` the sources under test
    include: ["**/*.test.{js,ts}"],
    exclude: ["node_modules", "coverage", "supabase", "e2e", ".claude"],
    // Installs browser-global stubs (window, localStorage, isLoggedInSync...)
    // BEFORE any test file's `import` of src/lib/storage.ts or src/lib/sync.ts.
    // Tests can't stub these inline because ESM imports hoist above sibling
    // top-level code, and storage.ts reads localStorage at module-eval time.
    setupFiles: ["./vitest.setup.js"],
  },
};
