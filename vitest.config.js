// Vitest configuration for Cafelytic unit tests.
// CommonJS — matches the default package.json (no "type": "module").
// Tests run in Node (no DOM needed for pure-logic files like metrics.js).
module.exports = {
  test: {
    environment: "node",
    globals: true, // describe/expect/test auto-injected — lets .test.js files stay CJS and just `require()` the sources under test
    include: ["**/*.test.js"],
    exclude: ["node_modules", "coverage", "supabase", "e2e", ".claude"],
  },
};
