import { existsSync, unwatchFile, watch, watchFile, type FSWatcher } from "node:fs";
import path from "node:path";
import { collectWatchTargetFiles } from "../cli/watch-targets.js";
import { parseKui } from "../parser/kui-parser.js";
import { loadSourceWithIncludes } from "../utils/source-loader.js";

const DEBOUNCE_MS = 150;
const POLL_INTERVAL_MS = 1000;

/**
 * Watches a .kui file plus its includes, bibliography files and local assets,
 * invoking onChange (debounced) whenever any of them is modified. The main
 * file is additionally polled with fs.watchFile as a fallback for platforms
 * where fs.watch is unreliable.
 */
export class WatchSession {
  private readonly watchers = new Map<string, FSWatcher>();
  private timer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(
    private readonly mainFile: string,
    private readonly onChange: () => void
  ) {
    this.syncWatchers();
    watchFile(this.mainFile, { interval: POLL_INTERVAL_MS }, () => this.schedule());
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    unwatchFile(this.mainFile);
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }

  private collectTargets(): string[] {
    try {
      const source = loadSourceWithIncludes(this.mainFile);
      const document = parseKui(source.content, { file: source.file });
      document.sourceFiles = source.files;
      return collectWatchTargetFiles(document, path.dirname(source.file));
    } catch {
      return [this.mainFile];
    }
  }

  private syncWatchers(): void {
    const targets = new Set(this.collectTargets().filter((file) => existsSync(file)));
    targets.add(this.mainFile);
    for (const [file, watcher] of this.watchers) {
      if (!targets.has(file)) {
        watcher.close();
        this.watchers.delete(file);
      }
    }
    for (const file of targets) {
      if (this.watchers.has(file) || !existsSync(file)) continue;
      try {
        this.watchers.set(file, watch(file, () => this.schedule()));
      } catch {
        // Files that disappear between collection and watch are picked up on resync.
      }
    }
  }

  private schedule(): void {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.closed) return;
      this.syncWatchers();
      this.onChange();
    }, DEBOUNCE_MS);
  }
}
