import {
  type CommandHelp,
  installHelpInterceptor,
  type InterceptableCommand,
  isHelpRequested,
  renderCommandHelp,
} from '../src/lib/command-help';

const identity = (s: string) => s;
const makePrint = () => {
  const lines: string[] = [];
  return {
    colors: { bold: identity, cyan: identity, dim: identity, yellow: identity },
    info: (s: string) => lines.push(s),
    lines,
    text: () => lines.join('\n'),
  };
};

describe('isHelpRequested', () => {
  it('is true for --help and -h', () => {
    expect(isHelpRequested({ options: { help: true } })).toBe(true);
    expect(isHelpRequested({ options: { h: true } })).toBe(true);
  });

  it('is false for --help-json (handled by tools.helpJson)', () => {
    expect(isHelpRequested({ options: { 'help-json': true } })).toBe(false);
    expect(isHelpRequested({ options: { helpJson: true } })).toBe(false);
  });

  it('is false when no help flag is present', () => {
    expect(isHelpRequested({ options: {} })).toBe(false);
    expect(isHelpRequested(undefined)).toBe(false);
    expect(isHelpRequested({ options: { to: 'vendor' } })).toBe(false);
  });
});

describe('renderCommandHelp', () => {
  const command = {
    commandPath: ['fullstack', 'convert-mode'],
    description: 'Convert fullstack monorepo between npm and vendor modes',
  };

  it('renders generic help (usage, description, NOT-executed notice)', () => {
    const print = makePrint();
    renderCommandHelp(print, command);
    const out = print.text();
    expect(out).toContain('lt fullstack convert-mode');
    expect(out).toContain('Convert fullstack monorepo');
    expect(out).toContain('--help, -h');
    expect(out).toContain('NOT executed');
  });

  it('renders rich help with features, examples, options and configuration', () => {
    const print = makePrint();
    const help: CommandHelp = {
      configuration: 'commands.fullstack.frameworkMode: "npm" | "vendor"',
      examples: ['fullstack convert-mode --to vendor'],
      features: ['Converts backend and frontend in one go'],
      options: [{ description: 'Target mode', flag: '--to', required: true, values: ['vendor', 'npm'] }],
    };
    renderCommandHelp(print, command, help);
    const out = print.text();
    expect(out).toContain('Converts backend and frontend in one go');
    expect(out).toContain('lt fullstack convert-mode --to vendor');
    expect(out).toContain('--to');
    expect(out).toContain('vendor|npm');
    expect(out).toContain('required');
    expect(out).toContain('frameworkMode');
  });
});

describe('installHelpInterceptor', () => {
  const baseCommand = (): InterceptableCommand & { run: (t: unknown) => unknown } => ({
    commandPath: ['server', 'module'],
    description: 'Create a module',
    file: '/some/where/module.js',
    run: () => 'EXECUTED',
  });

  it('prints help and skips execution when help is requested', () => {
    const command = baseCommand();
    let executed = false;
    command.run = () => {
      executed = true;
      return 'EXECUTED';
    };
    installHelpInterceptor([command]);
    const print = makePrint();
    const result = command.run({ parameters: { options: { help: true } }, print });
    expect(executed).toBe(false);
    expect(result).toBeUndefined();
    expect(print.text()).toContain('lt server module');
    expect(print.text()).toContain('NOT executed');
  });

  it('executes normally when no help flag is set', () => {
    const command = baseCommand();
    installHelpInterceptor([command]);
    const result = command.run({ parameters: { options: {} }, print: makePrint() });
    expect(result).toBe('EXECUTED');
  });

  it('does not double-wrap', () => {
    const command = baseCommand();
    installHelpInterceptor([command]);
    const wrappedOnce = command.run;
    installHelpInterceptor([command]);
    expect(command.run).toBe(wrappedOnce);
  });

  it('leaves preloaded builtins (file === null) and the default command untouched', () => {
    const builtin: InterceptableCommand & { run: (t: unknown) => unknown } = {
      commandPath: ['help'],
      file: null,
      run: () => 'BUILTIN',
    };
    const def = baseCommand();
    installHelpInterceptor([builtin, def], def);
    // builtin still runs even with help flag (gluegun handles top-level help)
    expect(builtin.run({ parameters: { options: { help: true } }, print: makePrint() })).toBe('BUILTIN');
    // default command is not wrapped either
    expect(def.run({ parameters: { options: { help: true } }, print: makePrint() })).toBe('EXECUTED');
  });
});
