import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

interface HistoryEntry {
  args: string[];
  command: string;
  cwd: string;
  timestamp: string;
}

const MAX_HISTORY_ENTRIES = 100;

/**
 * Command history management
 */
export class History {
  private toolbox: ExtendedGluegunToolbox;
  private historyFile: string;

  constructor(toolbox: ExtendedGluegunToolbox) {
    this.toolbox = toolbox;
    const homeDir = toolbox.filesystem.homedir();
    const ltDir = join(homeDir, `.${toolbox.runtime.brand}`);

    // Ensure ~/.lt directory exists
    if (!existsSync(ltDir)) {
      mkdirSync(ltDir, { recursive: true });
    }

    this.historyFile = join(ltDir, 'history.json');
  }

  /**
   * Get all history entries
   */
  getHistory(): HistoryEntry[] {
    try {
      if (existsSync(this.historyFile)) {
        const content = readFileSync(this.historyFile, 'utf-8');
        return JSON.parse(content);
      }
    } catch {
      // Return empty if file doesn't exist or is corrupted
    }
    return [];
  }

  /**
   * Add a command to history
   */
  addEntry(command: string, args: string[]): void {
    // Skip history-related commands
    if (command === 'history' || args.includes('--no-history')) {
      return;
    }

    const history = this.getHistory();
    const entry: HistoryEntry = {
      args,
      command,
      cwd: this.toolbox.filesystem.cwd(),
      timestamp: new Date().toISOString(),
    };

    history.push(entry);

    // Limit history size
    const trimmed = history.slice(-MAX_HISTORY_ENTRIES);

    try {
      writeFileSync(this.historyFile, JSON.stringify(trimmed, null, 2));
    } catch {
      // Ignore write errors
    }
  }

  /**
   * Clear history
   */
  clear(): void {
    try {
      writeFileSync(this.historyFile, '[]');
    } catch {
      // Ignore errors
    }
  }

  /**
   * Get last N entries
   */
  getLast(count: number): HistoryEntry[] {
    const history = this.getHistory();
    return history.slice(-count);
  }

  /**
   * Get entry by index (1-based, negative for reverse)
   */
  getEntry(index: number): HistoryEntry | null {
    const history = this.getHistory();
    if (index < 0) {
      // Negative index: -1 = last, -2 = second last, etc.
      const actualIndex = history.length + index;
      return history[actualIndex] || null;
    }
    // Positive index: 1-based
    return history[index - 1] || null;
  }

  /**
   * Search history by command pattern
   */
  search(pattern: string): HistoryEntry[] {
    const history = this.getHistory();
    const regex = new RegExp(pattern, 'i');
    return history.filter((entry) => regex.test(entry.command) || entry.args.some((arg) => regex.test(arg)));
  }

  /**
   * Format entry for display
   */
  formatEntry(entry: HistoryEntry, index: number): string {
    const date = new Date(entry.timestamp);
    const dateStr = date.toLocaleDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const fullCommand = [entry.command, ...entry.args].join(' ');
    return `${index.toString().padStart(4)}  ${dateStr} ${timeStr}  lt ${fullCommand}`;
  }
}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.history = new History(toolbox);
};
