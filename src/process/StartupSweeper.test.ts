import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StartupSweeper } from "./StartupSweeper.js";

describe("StartupSweeper", () => {
  it("sweeps directories older than maxAgeMs matching prefix", async () => {
    const parent = await mkdtemp(join(tmpdir(), "rea-sweeper-test-"));
    try {
      const staleDir = join(parent, "rea-stale-dir");
      const freshDir = join(parent, "rea-fresh-dir");
      const otherDir = join(parent, "other-stale-dir");

      await mkdir(staleDir);
      await mkdir(freshDir);
      await mkdir(otherDir);

      // Make staleDir appear 2 hours old
      const pastTime = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
      await utimes(staleDir, pastTime, pastTime);
      await utimes(otherDir, pastTime, pastTime);

      const result = await StartupSweeper.sweepOrphanedRuntimeRoots({
        parent,
        prefixes: ["rea-"],
        maxAgeMs: 60 * 60 * 1000, // 1 hour threshold
      });

      expect(result.sweptPaths).toContain(staleDir);
      expect(result.sweptPaths).not.toContain(freshDir);
      expect(result.sweptPaths).not.toContain(otherDir);
      expect(result.errors).toEqual([]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("handles non-existent parent directory gracefully", async () => {
    const nonExistent = join(tmpdir(), "non-existent-dir-" + Date.now());
    const result = await StartupSweeper.sweepOrphanedRuntimeRoots({
      parent: nonExistent,
    });
    expect(result.sweptPaths).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
