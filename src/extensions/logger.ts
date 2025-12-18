import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

export type LogLevel = 'debug' | 'error' | 'info' | 'verbose' | 'warn';

/**
 * Logger with support for verbose and debug output
 */
export class Logger {
  private debugEnabled: boolean;
  private metricsEnabled: boolean;
  private metrics: Map<string, { count: number; totalMs: number }> = new Map();
  private toolbox: ExtendedGluegunToolbox;
  private verboseEnabled: boolean;

  constructor(toolbox: ExtendedGluegunToolbox) {
    this.toolbox = toolbox;

    // Check CLI flags first, then environment variable, then config
    const cliVerbose = toolbox.parameters.options.verbose || toolbox.parameters.options.v;
    const cliDebug = toolbox.parameters.options.debug || toolbox.parameters.options.d;
    const envDebug = process.env.LT_DEBUG === '1' || process.env.LT_DEBUG === 'true';

    this.verboseEnabled = cliVerbose || envDebug || false;
    this.debugEnabled = cliDebug || envDebug || false;
    this.metricsEnabled = process.env.LT_METRICS === '1' || process.env.LT_METRICS === 'true';
  }

  private get print() {
    return this.toolbox.print;
  }

  /**
   * Check if verbose mode is enabled
   */
  get isVerbose(): boolean {
    return this.verboseEnabled || this.debugEnabled;
  }

  /**
   * Check if debug mode is enabled
   */
  get isDebug(): boolean {
    return this.debugEnabled;
  }

  /**
   * Log info message (always shown)
   */
  info(message: string): void {
    this.print.info(message);
  }

  /**
   * Log success message (always shown)
   */
  success(message: string): void {
    this.print.success(message);
  }

  /**
   * Log warning message (always shown)
   */
  warn(message: string): void {
    this.print.warning(message);
  }

  /**
   * Log error message (always shown)
   */
  error(message: string): void {
    this.print.error(message);
  }

  /**
   * Log verbose message (only shown with --verbose or --debug)
   */
  verbose(message: string): void {
    if (this.isVerbose) {
      this.print.info(this.print.colors.dim(`[verbose] ${message}`));
    }
  }

  /**
   * Log debug message (only shown with --debug)
   */
  debug(message: string): void {
    if (this.isDebug) {
      this.print.info(this.print.colors.cyan(`[debug] ${message}`));
    }
  }

  /**
   * Log a step with timing information (verbose mode)
   */
  step(stepName: string, details?: string): void {
    if (this.isVerbose) {
      const timestamp = new Date().toISOString().substring(11, 23);
      const msg = details ? `${stepName}: ${details}` : stepName;
      this.print.info(this.print.colors.dim(`[${timestamp}] ${msg}`));
    }
  }

  /**
   * Log object as formatted JSON (debug mode)
   */
  debugObject(label: string, obj: unknown): void {
    if (this.isDebug) {
      this.print.info(this.print.colors.cyan(`[debug] ${label}:`));
      this.print.info(JSON.stringify(obj, null, 2));
    }
  }

  /**
   * Log command execution (debug mode)
   */
  debugCommand(command: string): void {
    if (this.isDebug) {
      this.print.info(this.print.colors.yellow(`[cmd] ${command}`));
    }
  }

  /**
   * Create a spinner that respects verbose mode
   */
  spin(text: string) {
    const spinner = this.print.spin(text);

    if (this.isVerbose) {
      this.verbose(`Starting: ${text}`);
    }

    return spinner;
  }

  /**
   * Log timing information
   */
  timing(operation: string, durationMs: number): void {
    if (this.isVerbose) {
      const duration = durationMs < 1000
        ? `${durationMs}ms`
        : `${(durationMs / 1000).toFixed(2)}s`;
      this.print.info(this.print.colors.dim(`[timing] ${operation}: ${duration}`));
    }
  }

  /**
   * Record a metric for an operation (for performance tracking)
   */
  recordMetric(operation: string, durationMs: number): void {
    if (!this.metricsEnabled) return;

    const existing = this.metrics.get(operation);
    if (existing) {
      existing.count++;
      existing.totalMs += durationMs;
    } else {
      this.metrics.set(operation, { count: 1, totalMs: durationMs });
    }
  }

  /**
   * Create a timer that automatically records metrics
   */
  startTimer(operation: string): () => number {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.recordMetric(operation, duration);
      if (this.isVerbose) {
        this.timing(operation, duration);
      }
      return duration;
    };
  }

  /**
   * Get all collected metrics
   */
  getMetrics(): Map<string, { avgMs: number; count: number; totalMs: number }> {
    const result = new Map<string, { avgMs: number; count: number; totalMs: number }>();
    this.metrics.forEach((value, key) => {
      result.set(key, {
        avgMs: Math.round(value.totalMs / value.count),
        count: value.count,
        totalMs: value.totalMs,
      });
    });
    return result;
  }

  /**
   * Print metrics summary (if enabled)
   */
  printMetricsSummary(): void {
    if (!this.metricsEnabled || this.metrics.size === 0) return;

    this.print.info('');
    this.print.info(this.print.colors.dim('─'.repeat(50)));
    this.print.info(this.print.colors.bold('Performance Metrics:'));

    const sortedMetrics = [...this.metrics.entries()]
      .sort((a, b) => b[1].totalMs - a[1].totalMs);

    for (const [operation, data] of sortedMetrics) {
      const avgMs = Math.round(data.totalMs / data.count);
      this.print.info(
        this.print.colors.dim(
          `  ${operation}: ${data.count}x, avg ${avgMs}ms, total ${data.totalMs}ms`
        )
      );
    }
  }
}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.logger = new Logger(toolbox);
};
