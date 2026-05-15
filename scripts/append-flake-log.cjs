#!/usr/bin/env node
// Parses Playwright's JSON reporter output and prints one line of markdown
// suitable as a body for `gh issue comment`. Invoked by the e2e job in
// .github/workflows/ci.yml on push-to-main runs only.
//
// Usage:  node scripts/append-flake-log.cjs
// Reads:  playwright-report/results.json (relative to cwd)
// Env:    GH_RUN_URL, GH_SHA (set by the workflow)
// Emits:  one line of markdown to stdout. Always exits 0 — failures here must
//         not affect the CI job's reported status.
//
// Output format:
//   `<UTC date>` • <status> • flaky=<N> [(test names)] • [run](url) • <sha>
// where <status> is one of: passed | failed | flaky | crashed.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPORT_PATH = path.join("playwright-report", "results.json");

function isoMinute(d) {
  return d.toISOString().replace(/:\d\d\.\d{3}Z$/, "Z");
}

function* walkSpecs(suites) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) yield spec;
    yield* walkSpecs(suite.suites);
  }
}

function summarize(report) {
  const flakyTitles = [];
  let unexpectedCount = 0;

  for (const spec of walkSpecs(report.suites)) {
    for (const test of spec.tests || []) {
      // Playwright JSON reporter test.status values:
      //   "expected"   = passed first try (or expected failure)
      //   "unexpected" = failed final attempt
      //   "flaky"      = failed earlier attempt, passed final
      //   "skipped"    = skipped
      if (test.status === "flaky") {
        flakyTitles.push(spec.title);
      } else if (test.status === "unexpected") {
        unexpectedCount++;
      }
    }
  }

  let status;
  if (unexpectedCount > 0) status = "failed";
  else if (flakyTitles.length > 0) status = "flaky";
  else status = "passed";

  return { status, flakyTitles };
}

function main() {
  const ts = isoMinute(new Date());
  const runUrl = process.env.GH_RUN_URL || "";
  const sha = (process.env.GH_SHA || "").slice(0, 7);
  const runLink = runUrl ? `[run](${runUrl})` : "run=?";

  let raw;
  try {
    raw = fs.readFileSync(REPORT_PATH, "utf8");
  } catch {
    process.stdout.write(`\`${ts}\` • crashed • flaky=0 • ${runLink} • ${sha || "?"}\n`);
    return;
  }

  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    process.stdout.write(`\`${ts}\` • crashed • flaky=0 • ${runLink} • ${sha || "?"}\n`);
    return;
  }

  const { status, flakyTitles } = summarize(report);
  const names =
    flakyTitles.length > 0 ? ` (${flakyTitles.map((t) => t.split(":")[0].trim()).join(", ")})` : "";
  process.stdout.write(
    `\`${ts}\` • ${status} • flaky=${flakyTitles.length}${names} • ${runLink} • ${sha || "?"}\n`,
  );
}

main();
