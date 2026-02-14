import { exec } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

import { ExtendedGluegunCommand } from '../../interfaces/extended-gluegun-command';
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

// ────────────────────────────────────────────────────────────────────────────
// Interfaces (matching @lenne.tech/nest-server PermissionsReport)
// Kept locally for type safety (CLI doesn't have nest-server as compile-time dependency)
// ────────────────────────────────────────────────────────────────────────────

interface EndpointPermissions {
  className: string;
  classRoles: string[];
  filePath: string;
  methods: MethodPermission[];
}

interface FieldPermission {
  description?: string;
  inherited?: boolean;
  name: string;
  roles: string;
}

interface FilePermissions {
  className: string;
  classRestriction: string[];
  extendsClass?: string;
  fields: FieldPermission[];
  filePath: string;
  securityCheck?: SecurityCheckInfo;
}

interface MethodPermission {
  httpMethod: string;
  name: string;
  roles: string[];
  route?: string;
}

interface ModulePermissions {
  controllers: EndpointPermissions[];
  inputs: FilePermissions[];
  models: FilePermissions[];
  name: string;
  outputs: FilePermissions[];
  resolvers: EndpointPermissions[];
}

interface PermissionsReport {
  generated: string;
  modules: ModulePermissions[];
  objects: FilePermissions[];
  roleEnums: RoleEnumInfo[];
  stats: ReportStats;
  warnings: SecurityWarning[];
}

interface ReportStats {
  endpointCoverage: number;
  securityCoverage: number;
  totalEndpoints: number;
  totalModels: number;
  totalModules: number;
  totalSubObjects: number;
  totalWarnings: number;
  warningsByType: WarningsByType;
}

interface RoleEnumInfo {
  file: string;
  name: string;
  values: { key: string; value: string }[];
}

interface ScannerModule {
  generateMarkdownReport: ((report: PermissionsReport, projectPath?: string) => string) | null;
  scanPermissions: (
    path: string,
    logger?: { log?: (msg: string) => void; warn?: (msg: string) => void },
  ) => PermissionsReport;
}

interface SecurityCheckInfo {
  fieldsStripped: string[];
  returnsUndefined: boolean;
  summary: string;
}

interface SecurityWarning {
  details: string;
  file: string;
  module: string;
  type: string;
}

interface WarningsByType {
  NO_RESTRICTION: number;
  NO_ROLES: number;
  NO_SECURITY_CHECK: number;
  UNRESTRICTED_FIELD: number;
  UNRESTRICTED_METHOD: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Helper functions (alphabetically sorted per ESLint rules)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Find the project root containing src/server/modules/
 * (CLI-local version needed before scanner is loaded)
 */
function findProjectRoot(startPath: string): null | string {
  let current = startPath;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(current, 'src', 'server', 'modules'))) {
      return current;
    }
    const parent = join(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Minimal markdown fallback if scanner.generateMarkdownReport is not available
 * (only happens with nest-server versions that export scanPermissions but not generateMarkdownReport)
 */
function generateFallbackMarkdown(report: PermissionsReport, projectPath: string): string {
  return JSON.stringify({ ...report, project: projectPath }, null, 2);
}

/**
 * Generate HTML report via EJS template
 */
function generateHtml(report: PermissionsReport, projectPath: string, templateFn: any): Promise<string> {
  return templateFn.generate({
    props: {
      generated: report.generated,
      modules: report.modules,
      objects: report.objects,
      projectPath,
      roleEnums: report.roleEnums,
      stats: report.stats,
      warnings: report.warnings,
    },
    target: undefined,
    template: 'permissions/report.html.ejs',
  });
}

/**
 * Generate JSON report
 */
function generateJson(report: PermissionsReport, projectPath: string): string {
  return JSON.stringify(
    {
      generated: report.generated,
      modules: report.modules,
      objects: report.objects,
      project: projectPath,
      roleEnums: report.roleEnums,
      stats: report.stats,
      warnings: report.warnings,
    },
    null,
    2,
  );
}

/**
 * Try to dynamically load the permissions scanner module.
 *
 * Strategy (in order of preference):
 * 1. Load from project's @lenne.tech/nest-server (>= 11.17.0) — single source of truth
 * 2. Use CLI's bundled fallback scanner (standalone copy using ts-morph)
 *
 * Returns an object with scanPermissions + generateMarkdownReport, or null if neither is available.
 */
async function loadScanner(projectPath: string): Promise<null | ScannerModule> {
  // Try 1: Load from project's nest-server (preferred)
  const scannerPaths = [
    join(
      projectPath,
      'node_modules',
      '@lenne.tech',
      'nest-server',
      'dist',
      'core',
      'modules',
      'permissions',
      'permissions-scanner',
    ),
    join(
      projectPath,
      'node_modules',
      '@lenne.tech',
      'nest-server',
      'dist',
      'core',
      'modules',
      'permissions',
      'permissions-scanner.js',
    ),
  ];

  for (const scannerPath of scannerPaths) {
    try {
      const mod = require(scannerPath);
      if (typeof mod.scanPermissions === 'function') {
        return {
          generateMarkdownReport: typeof mod.generateMarkdownReport === 'function' ? mod.generateMarkdownReport : null,
          scanPermissions: mod.scanPermissions,
        };
      }
    } catch {
      // Not available at this path
    }
  }

  // Try 2: Use CLI's bundled fallback scanner
  try {
    const fallback = require('../../lib/fallback-scanner');
    if (typeof fallback.scanPermissions === 'function') {
      return {
        generateMarkdownReport:
          typeof fallback.generateMarkdownReport === 'function' ? fallback.generateMarkdownReport : null,
        scanPermissions: fallback.scanPermissions,
      };
    }
  } catch {
    // Fallback not available
  }

  return null;
}

/**
 * Open a file in the default browser/application
 */
function openFile(filePath: string): void {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${filePath}"`);
}

/**
 * Print console summary
 */
function printConsoleSummary(print: any, report: PermissionsReport): void {
  print.info('');
  print.info('Summary:');
  print.info('');

  const tableData: string[][] = [['Module', 'Models', 'Inputs', 'Outputs', 'Ctrl', 'Resolver', 'Warn']];
  for (const mod of report.modules) {
    const modWarnings = report.warnings.filter((w) => w.module === mod.name).length;
    tableData.push([
      mod.name,
      String(mod.models.length),
      String(mod.inputs.length),
      String(mod.outputs.length),
      String(mod.controllers.length),
      String(mod.resolvers.length),
      String(modWarnings),
    ]);
  }
  print.table(tableData);

  print.info(
    `Endpoint Coverage: ${report.stats.endpointCoverage}% | Security Coverage: ${report.stats.securityCoverage}%`,
  );

  if (report.objects.length > 0) {
    print.info(`SubObjects: ${report.objects.length}`);
  }

  if (report.warnings.length > 0) {
    print.info('');
    print.warning(`${report.warnings.length} Warning(s):`);
    for (const w of report.warnings) {
      const fileName = w.file.split('/').pop() || w.file;
      print.warning(`  [${w.type}] ${w.module}/${fileName}: ${w.details}`);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Command
// ────────────────────────────────────────────────────────────────────────────

/**
 * Scan server permissions and generate report
 */
const PermissionsCommand: ExtendedGluegunCommand = {
  alias: ['p'],
  description: 'Scan server permissions',
  hidden: false,
  name: 'permissions',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      config,
      filesystem,
      parameters,
      print,
      print: { error, info, spin, success },
      template,
    } = toolbox;

    info('Scan server permissions');

    // Hint for non-interactive callers
    toolbox.tools.nonInteractiveHint('lt server permissions --path <dir> --format <md|json|html> --noConfirm');

    // Load configuration
    const ltConfig = config.loadConfig();
    const permConfig = ltConfig?.commands?.server?.permissions;

    // Determine noConfirm
    config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: permConfig,
      config: ltConfig,
    });

    // Intelligent defaults based on TTY
    const isTTY = process.stdin.isTTY;
    const defaultFormat = isTTY ? 'html' : 'md';
    const defaultOpen = !!isTTY;
    const defaultConsole = false;
    const defaultFailOnWarnings = false;

    // Resolve parameters with config priority
    const format =
      config.getValue<string>({
        cliValue: parameters.options.format,
        configValue: permConfig?.format,
        defaultValue: defaultFormat,
      }) || defaultFormat;

    const shouldOpen =
      config.getValue<boolean>({
        cliValue: parameters.options.open ?? (parameters.options['no-open'] === true ? false : undefined),
        configValue: permConfig?.open,
        defaultValue: defaultOpen,
      }) ?? defaultOpen;

    const shouldConsole =
      config.getValue<boolean>({
        cliValue: parameters.options.console,
        configValue: permConfig?.console,
        defaultValue: defaultConsole,
      }) ?? defaultConsole;

    const failOnWarnings =
      config.getValue<boolean>({
        cliValue: parameters.options['fail-on-warnings'] ?? parameters.options.failOnWarnings,
        configValue: permConfig?.failOnWarnings,
        defaultValue: defaultFailOnWarnings,
      }) ?? defaultFailOnWarnings;

    // Determine project path
    let projectPath = config.getValue<string>({
      cliValue: parameters.options.path,
      configValue: permConfig?.path,
    });

    if (!projectPath) {
      projectPath = findProjectRoot(filesystem.cwd());
    }

    if (!projectPath) {
      error('No NestJS project found. Use --path <dir> to specify the project path.');
      error('Expected: src/server/modules/ directory');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'permissions: project not found';
    }

    info(`Project: ${projectPath}`);

    // Output file
    const defaultOutputName = `permissions.${format}`;
    const outputFile =
      config.getValue<string>({
        cliValue: parameters.options.output,
        configValue: permConfig?.output,
        defaultValue: defaultOutputName,
      }) || defaultOutputName;

    const outputPath = join(projectPath, outputFile);

    // Load scanner from project's @lenne.tech/nest-server
    const spinner = spin('Loading permissions scanner...');
    const scanner = await loadScanner(projectPath);

    if (!scanner) {
      spinner.fail('Permissions scanner not available');
      error('');
      error(
        "Neither the project's @lenne.tech/nest-server scanner (>= 11.17.0) nor the CLI fallback scanner could be loaded.",
      );
      error('Please ensure ts-morph is installed: npm install ts-morph');
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'permissions: scanner not available';
    }

    // Scan permissions
    spinner.text = 'Scanning modules...';
    let report: PermissionsReport;
    try {
      report = scanner.scanPermissions(projectPath, {
        log: (msg: string) => {
          spinner.text = msg;
        },
        warn: (msg: string) => {
          print.warning(`  ${msg}`);
        },
      });
    } catch (err) {
      spinner.fail('Permissions scan failed');
      error(String(err));
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return 'permissions: scan failed';
    }

    spinner.succeed(
      `Scanned ${report.stats.totalModules} modules, ${report.stats.totalSubObjects} objects, found ${report.stats.totalWarnings} warnings`,
    );

    // Generate report
    const reportSpinner = spin(`Generating ${format} report...`);
    let reportContent: string;

    if (format === 'json') {
      reportContent = generateJson(report, projectPath);
    } else if (format === 'html') {
      reportContent = (await generateHtml(report, projectPath, template)) || '';
      if (!reportContent) {
        // Fallback: generate markdown if HTML template not available
        reportContent =
          scanner.generateMarkdownReport?.(report, projectPath) || generateFallbackMarkdown(report, projectPath);
        reportSpinner.warn('HTML template not found, falling back to markdown');
      }
    } else {
      reportContent =
        scanner.generateMarkdownReport?.(report, projectPath) || generateFallbackMarkdown(report, projectPath);
    }

    // Write file
    filesystem.write(outputPath, reportContent);
    reportSpinner.succeed(`Report saved to ${outputFile}`);

    // Console summary
    if (shouldConsole) {
      printConsoleSummary(print, report);
    }

    // Open in browser
    if (shouldOpen && (format === 'html' || format === 'md')) {
      openFile(outputPath);
      info(`Report opened in default application`);
    }

    // Summary line (always shown)
    success(
      `${report.stats.totalModules} modules, ${report.stats.totalSubObjects} objects, ${report.stats.totalWarnings} warnings → ${outputFile}`,
    );

    // Exit code for CI
    if (failOnWarnings && report.warnings.length > 0) {
      error(`${report.warnings.length} warning(s) found (--fail-on-warnings is active)`);
      if (!parameters.options.fromGluegunMenu) process.exit(1);
    }

    if (!parameters.options.fromGluegunMenu) {
      process.exit();
    }

    return `permissions report generated: ${outputFile}`;
  },
};

export default PermissionsCommand;
