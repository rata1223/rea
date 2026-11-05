import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SweepOptions {
  readonly parent?: string;
  readonly prefixes?: readonly string[];
  readonly maxAgeMs?: number;
}

export interface SweepResult {
  readonly sweptPaths: readonly string[];
  readonly errors: readonly string[];
}

const DEFAULT_PREFIXES = ["rea-", ".rea-write-"] as const;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Sweeps orphaned temporary directories left behind by previous dead REA sessions.
 */
export class StartupSweeper {
  /**
   * Scan and remove stale temporary runtime directories matching the prefix.
   */
  static async sweepOrphanedRuntimeRoots(
    options: SweepOptions = {},
  ): Promise<SweepResult> {
    const parent = options.parent ?? tmpdir();
    const prefixes = options.prefixes ?? DEFAULT_PREFIXES;
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const now = Date.now();

    const sweptPaths: string[] = [];
    const errors: string[] = [];

    let entries: string[];
    try {
      entries = await readdir(parent);
    } catch (err: unknown) {
      return {
        sweptPaths,
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }

    for (const name of entries) {
      const matches = prefixes.some((p) => name.startsWith(p));
      if (!matches) continue;

      const fullPath = join(parent, name);
      try {
        const stats = await stat(fullPath);
        if (!stats.isDirectory()) continue;

        const ageMs = now - stats.mtimeMs;
        if (ageMs >= maxAgeMs) {
          await rm(fullPath, { recursive: true, force: true });
          sweptPaths.push(fullPath);
        }
      } catch (err: unknown) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    return { sweptPaths, errors };
  }
}
