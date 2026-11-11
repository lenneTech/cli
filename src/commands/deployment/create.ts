import { existsSync } from 'fs';
import { GluegunCommand } from 'gluegun';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';
import { apiConfiguresAi } from '../../lib/api-ai-config';
import { detectFrontendKind } from '../../lib/frontend-kind';
import {
  isValidDomain,
  isValidProjectSlug,
  mergeTurboOpsConfig,
  optionString,
  readJsonObject,
} from '../../lib/turboops-config';
import { detectSubProjectContext, findWorkspaceRoot } from '../../lib/workspace-integration';

/**
 * Create the TurboOps deployment config for a fullstack monorepo.
 *
 * The generic deployment files already ship with the monorepo template:
 *   - projects/api/Dockerfile + projects/app/Dockerfile (from the starters)
 *   - docker-compose.yml + .gitlab-ci.yml (TurboOps build + `turbo deploy`)
 * so this command only writes the project-specific `.turboops.json` and prints the
 * one-time TurboOps setup checklist (project, stages, CI/CD vars, DNS, stage env).
 *
 * The file is MERGED, never clobbered: any keys a user added by hand survive a
 * re-run, and an unchanged file is left untouched.
 *
 * Both frontends read their URLs from the stage env at runtime: a Nuxt app as
 * `NUXT_*`, an Angular app (ng-base-starter, SSR) as `NG_*`. So nothing is patched
 * into the project, and one image per branch can serve any stage. Until 1.57 the
 * command rewrote an Angular app's `environment.{prod,develop,test}.ts`, because
 * the Angular 14 starter baked its URLs into the bundle; the current starter has
 * no such files.
 *
 * Legacy note: this used to generate a Docker-Swarm deployment (root
 * Dockerfile/Dockerfile.app, docker-compose.{dev,test,prod}.yml, manual Traefik
 * labels). That is obsolete on the TurboOps stack and has been removed. GitLab
 * is the only supported pipeline — the lt-monorepo template ships
 * `.gitlab-ci.yml`, not a GitHub deploy workflow.
 */

export const help = {
  configuration: 'commands.deployment.domain, commands.deployment.noConfirm, defaults.domain, defaults.noConfirm',
  description: 'Create the TurboOps deployment config (.turboops.json) for a fullstack monorepo',
  examples: [
    'deployment create',
    'deployment create MyProject --domain myproject.lenne.tech --noConfirm',
    'deployment create MyProject --domain myproject.lenne.tech --project myproject',
  ],
  features: [
    'Writes `.turboops.json` to the workspace root (merges into an existing file)',
    'Prints the one-time TurboOps setup checklist (project, stages, CI/CD vars, DNS, stage env)',
  ],
  name: 'create',
  options: [
    {
      description: 'Main domain of the project (e.g. myproject.lenne.tech)',
      flag: '--domain',
      required: false,
      type: 'string',
    },
    {
      description: 'TurboOps project slug (registry namespace + login user). Default: kebab-case project name',
      flag: '--project',
      required: false,
      type: 'string',
    },
    {
      default: false,
      description: 'Skip confirmation prompts; resolve every value from CLI flags, lt.config, or defaults',
      flag: '--noConfirm',
      required: false,
      type: 'boolean',
    },
  ],
};

const NewCommand: GluegunCommand = {
  alias: ['dc'],
  description: 'Create TurboOps config',
  hidden: false,
  name: 'create',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      config,
      filesystem,
      helper,
      parameters,
      print: { error, info, spin, success, warning },
      prompt: { confirm },
      strings: { kebabCase, pascalCase },
      system,
      template,
    } = toolbox;

    const fail = (message: string, result: string): string => {
      error(message);
      if (!parameters.options.fromGluegunMenu) process.exit(1);
      return result;
    };

    // Load configuration
    const ltConfig = config.loadConfig();
    const configDomain = ltConfig?.commands?.deployment?.domain;
    const globalDomain = config.getGlobalDefault<string>(ltConfig, 'domain');
    const cliDomain = optionString(parameters.options.domain);
    const cliProject = optionString(parameters.options.project);

    // Priority: CLI > command config > global default > false. When set, every
    // value must resolve from a flag, lt.config, or a default — no prompts, so
    // AI agents and CI never block on an interactive question.
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.deployment,
      config: ltConfig,
    });

    // Start timer
    const timer = system.startTimer();
    info('Create TurboOps deployment config');

    // `.turboops.json` must sit in the repo root — `.gitlab-ci.yml` reads it
    // from there. Resolve the workspace root so running this from inside
    // `projects/api/` still writes to the right place.
    const cwd = filesystem.cwd();
    const subProject = detectSubProjectContext(cwd, filesystem);
    const projectRoot = subProject?.workspaceRoot ?? findWorkspaceRoot(cwd, filesystem) ?? cwd;
    if (projectRoot !== cwd) {
      info(`Using workspace root: ${projectRoot}`);
    }

    // Default project name from lt.json / package.json. Read-only: `patching.update`
    // would re-serialize and rewrite the file just to look at one field. A
    // malformed file is tolerated (best-effort default), never fatal.
    let projectName = '';
    const ltName = readJsonObject(filesystem, join(projectRoot, 'lt.json')).value?.name;
    if (typeof ltName === 'string' && ltName) {
      projectName = ltName;
    }
    if (!projectName) {
      const pkgName = readJsonObject(filesystem, join(projectRoot, 'package.json')).value?.name;
      if (typeof pkgName === 'string' && pkgName) {
        projectName = pascalCase(pkgName);
      }
    }

    // Project name (CLI arg > detected name > interactive)
    const cliName = optionString(parameters.first);
    const name =
      cliName ??
      (noConfirm
        ? projectName
        : await helper.getInput('', {
            initial: projectName,
            name: `project name (e.g. ${projectName || 'My new project'})`,
          }));
    if (!name) {
      return fail(
        noConfirm
          ? 'No project name: pass it as the first argument (no lt.json / package.json "name" found).'
          : 'No project name given.',
        'deployment create: no name',
      );
    }

    const slug = kebabCase(name);

    // Main domain (priority: CLI > config > global > interactive/default)
    let domain: string;
    if (cliDomain) {
      domain = cliDomain;
    } else if (configDomain) {
      domain = configDomain.replace('{name}', slug);
      info(`Using domain from lt.config commands.deployment: ${domain}`);
    } else if (globalDomain) {
      domain = globalDomain.replace('{name}', slug);
      info(`Using domain from lt.config defaults: ${domain}`);
    } else if (noConfirm) {
      // Honour the documented `[domain]` positional; only then fall back to the
      // default — otherwise a `--noConfirm` caller's explicit domain is dropped.
      const argDomain = optionString(parameters.second);
      domain = argDomain ?? `${slug}.lenne.tech`;
      info(argDomain ? `Using domain: ${domain}` : `Using default domain: ${domain}`);
    } else {
      domain = await helper.getInput(parameters.second, {
        initial: `${slug}.lenne.tech`,
        name: `main domain of the project (e.g. ${slug}.lenne.tech)`,
      });
    }
    if (!domain) {
      return fail('No domain given.', 'deployment create: no domain');
    }

    // `domain` is written verbatim into `.turboops.json` and into copy-paste checklist
    // lines, so validate it as a hostname — a stray quote / `$` / whitespace would
    // produce a broken config or a pasted env value that is not what it looks like.
    // Mirrors the slug check below.
    if (!isValidDomain(domain)) {
      return fail(
        `Invalid domain "${domain}" — expected a hostname like ${slug}.lenne.tech (letters, digits, dashes, dots).`,
        'deployment create: invalid domain',
      );
    }

    // TurboOps project slug (registry namespace + login user). Defaults to the kebab name.
    const rawProject =
      cliProject ??
      (noConfirm ? slug : await helper.getInput('', { initial: slug, name: `TurboOps project slug (e.g. ${slug})` }));
    if (!rawProject) {
      return fail('No TurboOps project slug given.', 'deployment create: no project');
    }

    // `docker login -u "$TURBOOPS_PROJECT"` and `registry.turbo-ops.de/<project>`
    // only accept a lowercase dash-separated slug.
    const project = kebabCase(rawProject);
    if (!isValidProjectSlug(project)) {
      return fail(
        `Invalid TurboOps project slug "${rawProject}" — expected lowercase letters, digits and dashes.`,
        'deployment create: invalid project slug',
      );
    }
    if (project !== rawProject) {
      warning(`Normalized TurboOps project slug "${rawProject}" → "${project}".`);
    }

    // Write `.turboops.json`. Merge instead of overwrite: the file is committed
    // and a user may have added keys by hand; a re-run must not silently drop them.
    const target = join(projectRoot, '.turboops.json');
    const generateSpinner = spin('Generate .turboops.json');
    const current = readJsonObject(filesystem, target);
    const existing = current.value;

    // File exists but did not parse into a usable object (malformed JSON, or a
    // bare null/number/array). Don't silently clobber it.
    if (current.found && !existing) {
      generateSpinner.fail('.turboops.json exists but is not a usable JSON object');
      if (noConfirm || !(await confirm(`Replace the unusable ${target}?`, false))) {
        return fail(`Refusing to overwrite unusable ${target}.`, 'deployment create: unusable config');
      }
    }

    if (existing) {
      const merged = mergeTurboOpsConfig(existing, project);
      if (!merged.changed) {
        generateSpinner.succeed('.turboops.json already up to date');
      } else {
        if (merged.previousProject && merged.previousProject !== project) {
          warning(`Changing TurboOps project "${merged.previousProject}" → "${project}".`);
        }
        // Trailing newline matches the template-generated form, so re-runs stay
        // byte-stable and never produce a whitespace-only diff.
        filesystem.write(target, `${JSON.stringify(merged.config, null, 2)}\n`);
        generateSpinner.succeed('.turboops.json updated (existing keys preserved)');
      }
    } else {
      await template.generate({
        props: { project },
        target,
        template: 'deployment/turboops.json.ejs',
      });
      generateSpinner.succeed('.turboops.json generated');
    }

    // The app's framework decides the NAMES of the stage env vars, nothing else.
    const appDir = existsSync(join(projectRoot, 'projects', 'app'))
      ? join(projectRoot, 'projects', 'app')
      : projectRoot;
    const isAngular = detectFrontendKind(appDir) === 'angular';
    const apiDir = existsSync(join(projectRoot, 'projects', 'api'))
      ? join(projectRoot, 'projects', 'api')
      : projectRoot;

    // One-time setup checklist
    info('');
    success(`TurboOps deployment wired for "${name}" in ${helper.msToMinutesAndSeconds(timer())}m.`);
    info('');
    info('One-time setup:');
    info(`  1. TurboOps: create project "${project}" with stages "dev" and "production" on your server.`);
    info(`     - production domains: ${domain} (app) + api.${domain} (api)`);
    info(`     - dev domains:        dev.${domain} (app) + api.dev.${domain} (api)`);
    info(`  2. CI/CD variables: TURBOOPS_PROJECT=${project} and TURBOOPS_TOKEN=<token> (masked).`);
    info('     GitLab: Settings > CI/CD > Variables. GitHub: a repo variable + a repo secret.');
    info('  3. DNS A/AAAA records -> your server IP:');
    info(`     - ${domain}          (apex — NOT covered by a wildcard)`);
    info(`     - *.${domain}        (covers api.${domain}, dev.${domain} AND api.dev.${domain}:`);
    info('       a DNS wildcard matches one or MORE labels, RFC 4592)');
    info(`     - *.dev.${domain}    only needed if dev.${domain} exists as an EXPLICIT record`);
    info('       (an explicit node blocks the parent wildcard for names below it)');
    info('  4. Set the stage env vars in TurboOps (per stage), e.g. for production:');
    info(`       NODE_ENV=production, NSC__BASE_URL=https://api.${domain},`);
    // The DB host is spelled out per stage on purpose. Every other variable in
    // this checklist carries a concrete value; leaving this one as a bare name
    // forces the reader to invent it, and the only reference in sight is the
    // project's own docker-compose.yml, where the service is called `mongo`.
    // `mongodb://mongo:27017/...` is the natural guess — and the wrong one: the
    // short name is a Swarm alias on a network shared by every stack, so it
    // resolves to a FOREIGN project's database (and to a different one on each
    // connection). Symptoms are split-brain writes, sessions that vanish, and
    // data quietly landing in someone else's MongoDB. See DEV-2140.
    info(
      `       NSC__MONGOOSE__URI=mongodb://<user>:<pass>@${project}-production_mongo:27017/${project}?authSource=admin,`,
    );
    info(`         (dev stage: mongodb://<user>:<pass>@${project}-dev_mongo:27017/${project}?authSource=admin)`);
    info('         NOTE: always the stack-prefixed host `<project>-<stage>_mongo`, never a bare');
    info('         `mongo` — the short name is shared across stacks and resolves to a FOREIGN');
    info('         database, non-deterministically per connection.');
    info('         The stack-prefix fixes WHICH database you reach, not WHO may reach it:');
    info('         the overlay network is shared, so the DB credentials are the actual');
    info('         boundary. Set them in the mongo service and never deploy it open.');
    // NSC__AI__ENCRYPTION_SECRET alone creates an `ai` block, and nest-server enables CoreAiModule
    // (all /ai/* routes) on mere presence: recommend it only where the API configures AI.
    if (apiConfiguresAi(apiDir)) {
      info('       NSC__BETTER_AUTH__SECRET, NSC__AI__ENCRYPTION_SECRET,');
    } else {
      info('       NSC__BETTER_AUTH__SECRET,');
      info('         (NSC__AI__* only with an `ai` block in config.env.ts: on its own it switches the AI');
      info('         module and its /ai/* routes on)');
    }
    info('       NSC__EMAIL__SMTP__*, NSC__EMAIL__DEFAULT_SENDER__EMAIL,');
    // Read by the app's SSR server at request time, so one image serves every stage.
    const prefix = isAngular ? 'NG' : 'NUXT';
    info(`       ${prefix}_PUBLIC_API_URL=https://api.${domain}, ${prefix}_API_URL=https://api.${domain},`);
    info(`       ${prefix}_PUBLIC_SITE_URL=https://${domain}`);
    info(`       (dev stage: the same with dev.${domain} and api.dev.${domain})`);
    if (isAngular) {
      // ng-base's bug reporting (`@lenne.tech/ng-base/bug`) decides at runtime by this value; an
      // unset value in a production build counts as production, i.e. reporting off (fail-closed).
      info('       NG_PUBLIC_APP_ENV=production   (dev stage: develop)');
      info('     Optional secrets for bug reports to Linear (server only, masked, never public):');
      info('       NG_LINEAR_API_KEY, NG_LINEAR_TEAM_NAME, NG_LINEAR_PROJECT_NAME');
    }
    info('  5. Commit `.turboops.json` — `turbo deploy` reads it from the repo root in CI.');
    info('');
    info('Then: push `dev` -> the dev stage, push `main` -> the production stage');
    info('(.gitlab-ci.yml, or .github/workflows/deploy.yml on GitHub). Tests gate the deploy.');

    if (!parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `new deployment ${name}`;
  },
};

export default NewCommand;
