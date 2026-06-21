// Playwright globalSetup: clear any shared-account lock left behind by a crashed
// prior run before this run's workers start. Normal runs release the lock in
// afterAll; only a hard process crash leaks it, and clearing it here makes the
// next run self-heal instead of blocking on a stale lock (see
// _shared-account-lock.ts).
import * as fs from "node:fs";
import { LOCK_FILE } from "./_shared-account-lock";

export default function globalSetup(): void {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch (err) {
    // Absent is the normal case; anything else (e.g. bad permissions) is a real
    // setup problem worth surfacing.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
