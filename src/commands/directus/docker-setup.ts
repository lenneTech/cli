import * as crypto from 'crypto';
import { GluegunCommand } from 'gluegun';
import * as net from 'net';
import { join } from 'path';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Find next available port starting from a given port
 */
async function findAvailablePort(startPort: number, maxAttempts = 100): Promise<number> {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found between ${startPort} and ${startPort + maxAttempts}`);
}

/**
 * Check if a port is available
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port, '0.0.0.0');
  });
}

/**
 * Validate instance name for Docker compatibility
 * Docker container names must match: ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$
 */
function validateInstanceName(name: string): { error?: string; isValid: boolean } {
  // Docker container names must start with alphanumeric and can contain alphanumeric, underscore, period, hyphen
  const dockerNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

  if (!name || name.length === 0) {
    return { error: 'Instance name cannot be empty', isValid: false };
  }

  if (name.length > 128) {
    return { error: 'Instance name cannot exceed 128 characters', isValid: false };
  }

  if (!dockerNamePattern.test(name)) {
    // Check for common issues to provide helpful error messages
    if (/[äöüÄÖÜß]/.test(name)) {
      return {
        error: `Instance name contains umlauts (${name}). Docker container names only allow: letters (a-z, A-Z), numbers (0-9), underscores (_), periods (.), and hyphens (-)`,
        isValid: false,
      };
    }
    if (/\s/.test(name)) {
      return { error: 'Instance name cannot contain spaces', isValid: false };
    }
    if (/^[^a-zA-Z0-9]/.test(name)) {
      return { error: 'Instance name must start with a letter or number', isValid: false };
    }
    return {
      error: `Instance name "${name}" contains invalid characters. Only letters (a-z, A-Z), numbers (0-9), underscores (_), periods (.), and hyphens (-) are allowed`,
      isValid: false,
    };
  }

  return { isValid: true };
}

/**
 * Setup a new local Directus Docker instance
 */
const NewCommand: GluegunCommand = {
  alias: ['ds'],
  description: 'Setup Docker instance',
  hidden: false,
  name: 'docker-setup',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      config,
      filesystem,
      parameters,
      print: { error, info, spin, success, warning },
      prompt,
      system,
      template,
    } = toolbox;

    // Check if Docker is installed
    if (!system.which('docker')) {
      error('Docker is not installed. Please install Docker first.');
      return;
    }

    // Load configuration
    const ltConfig = config.loadConfig();

    // Parse CLI arguments
    const cliName = parameters.options.name || parameters.options.n;
    const cliVersion = parameters.options.version || parameters.options.v;
    const cliDatabase = parameters.options.database || parameters.options.db;
    const cliPort = parameters.options.port || parameters.options.p;

    // Determine noConfirm with priority: CLI > command > global > default
    const noConfirm = config.getNoConfirm({
      cliValue: parameters.options.noConfirm,
      commandConfig: ltConfig?.commands?.directus?.dockerSetup,
      config: ltConfig,
    });

    // Get configuration values
    const configName = ltConfig?.commands?.directus?.dockerSetup?.name;
    const configVersion = ltConfig?.commands?.directus?.dockerSetup?.version;
    const configDatabase = ltConfig?.commands?.directus?.dockerSetup?.database;

    // Determine instance name
    let instanceName: string;
    if (cliName && typeof cliName === 'string') {
      instanceName = cliName;
    } else if (configName) {
      instanceName = configName;
      info(`Using instance name from lt.config: ${instanceName}`);
    } else if (noConfirm) {
      instanceName = 'directus';
      info(`Using default instance name: ${instanceName}`);
    } else {
      const nameResponse = await prompt.ask<{ name: string }>({
        initial: 'directus',
        message: 'Enter instance name:',
        name: 'name',
        type: 'input',
      });
      instanceName = nameResponse.name;
    }

    if (!instanceName) {
      error('Instance name is required!');
      return;
    }

    // Validate instance name for Docker compatibility
    const validation = validateInstanceName(instanceName);
    if (!validation.isValid) {
      error(validation.error!);
      return;
    }

    // Determine Directus version
    let version: string;
    if (cliVersion && typeof cliVersion === 'string') {
      version = cliVersion;
    } else if (configVersion) {
      version = configVersion;
      info(`Using Directus version from lt.config: ${version}`);
    } else if (noConfirm) {
      version = 'latest';
      info(`Using default Directus version: ${version}`);
    } else {
      const versionResponse = await prompt.ask<{ version: string }>({
        initial: 'latest',
        message: 'Enter Directus version (e.g., latest, 10, 10.8.0):',
        name: 'version',
        type: 'input',
      });
      version = versionResponse.version;
    }

    if (!version) {
      error('Directus version is required!');
      return;
    }

    // Determine database type
    let database: 'mysql' | 'postgres' | 'sqlite';
    const databaseChoices = [
      { message: 'PostgreSQL (recommended)', name: 'postgres' },
      { message: 'MySQL', name: 'mysql' },
      { message: 'SQLite', name: 'sqlite' },
    ];

    if (cliDatabase && typeof cliDatabase === 'string') {
      const validDatabases = ['postgres', 'postgresql', 'mysql', 'sqlite'];
      const normalizedDb = cliDatabase.toLowerCase();
      if (!validDatabases.includes(normalizedDb)) {
        error(`Invalid database type: ${cliDatabase}. Valid options: postgres, mysql, sqlite`);
        return;
      }
      database = (normalizedDb === 'postgresql' ? 'postgres' : normalizedDb) as 'mysql' | 'postgres' | 'sqlite';
    } else if (configDatabase) {
      database = configDatabase as 'mysql' | 'postgres' | 'sqlite';
      info(`Using database type from lt.config: ${database}`);
    } else if (noConfirm) {
      database = 'postgres';
      info(`Using default database type: ${database}`);
    } else {
      const result = await prompt.ask<{ database: 'mysql' | 'postgres' | 'sqlite' }>({
        choices: databaseChoices,
        initial: 0,
        message: 'Select database type:',
        name: 'database',
        type: 'select',
      });
      database = result.database;
    }

    if (!database) {
      error('Database type is required!');
      return;
    }

    // Determine instance directory
    const directusDir = join(filesystem.homedir(), '.lt', 'directus', instanceName);
    const instanceExists = filesystem.exists(directusDir);

    // Check if instance already exists
    if (instanceExists && !parameters.options.update) {
      if (noConfirm) {
        error(`Instance "${instanceName}" already exists. Use --update to modify it.`);
        return;
      }
      const shouldUpdate = await prompt.confirm(`Instance "${instanceName}" already exists. Update it?`);
      if (!shouldUpdate) {
        info('Operation cancelled.');
        return;
      }
    }

    if (instanceExists) {
      info(`Updating existing instance: ${instanceName}`);
    }

    // Read existing .env if updating to preserve secrets
    const existingEnv: { [key: string]: string } = {};
    if (instanceExists) {
      const envPath = join(directusDir, '.env');
      if (filesystem.exists(envPath)) {
        const envContent = filesystem.read(envPath);
        if (envContent) {
          // Parse .env file
          envContent.split('\n').forEach((line) => {
            const match = line.match(/^([A-Z_]+)=(.+)$/);
            if (match) {
              existingEnv[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
            }
          });
        }
      }
    }

    // Generate random secrets (or use existing ones if updating)
    const generateSecret = () => {
      return crypto.randomBytes(32).toString('hex');
    };

    const keySecret = existingEnv.KEY || generateSecret();
    const adminSecret = existingEnv.SECRET || generateSecret();

    // Database configuration (use existing passwords if updating)
    const dbConfig = {
      mysql: {
        adminPassword: existingEnv.MYSQL_ROOT_PASSWORD || generateSecret(),
        client: 'mysql',
        database: 'directus',
        image: 'mysql:8',
        password: existingEnv.DB_PASSWORD || generateSecret(),
        port: 3306,
        user: 'directus',
      },
      postgres: {
        client: 'pg',
        database: 'directus',
        image: 'postgres:16',
        password: existingEnv.DB_PASSWORD || generateSecret(),
        port: 5432,
        user: 'directus',
      },
      sqlite: {
        client: 'sqlite3',
        database: '/directus/database/data.db',
        image: null, // SQLite doesn't need a separate container
        password: null,
        port: null,
        user: null,
      },
    };

    const selectedDbConfig = dbConfig[database];

    // Determine port (CLI > existing > config > auto-detect)
    let directusPort: number;
    const configPort = ltConfig?.commands?.directus?.dockerSetup?.port;

    if (cliPort && typeof cliPort !== 'boolean') {
      directusPort = Number.parseInt(String(cliPort), 10);
      if (Number.isNaN(directusPort) || directusPort < 1 || directusPort > 65535) {
        error(`Invalid port: ${cliPort}. Must be between 1 and 65535.`);
        return;
      }
      info(`Using port from CLI: ${directusPort}`);
    } else if (existingEnv.DIRECTUS_PORT) {
      directusPort = Number.parseInt(existingEnv.DIRECTUS_PORT, 10);
      info(`Using existing port: ${directusPort}`);
    } else if (configPort) {
      directusPort = configPort;
      info(`Using port from lt.config: ${directusPort}`);
    } else {
      // Auto-detect available port starting from 8055
      const portSpin = spin('Finding available port');
      try {
        directusPort = await findAvailablePort(8055);
        portSpin.succeed();
        info(`Found available port: ${directusPort}`);
      } catch (portError) {
        portSpin.fail('Failed to find available port');
        if (portError instanceof Error) {
          error(portError.message);
        }
        return;
      }
    }

    // Create instance directory
    const dirSpin = spin('Preparing instance directory');
    try {
      filesystem.dir(directusDir);
      dirSpin.succeed();
    } catch (dirError) {
      dirSpin.fail('Failed to create instance directory');
      if (dirError instanceof Error) {
        error(dirError.message);
      }
      return;
    }

    // Generate docker-compose.yml
    const composeSpin = spin('Generating docker-compose.yml');
    try {
      await template.generate({
        props: {
          dbConfig: selectedDbConfig,
          dbType: database,
          instanceName,
          version,
        },
        target: join(directusDir, 'docker-compose.yml'),
        template: 'directus/docker-compose.yml.ejs',
      });
      composeSpin.succeed();
    } catch (composeError) {
      composeSpin.fail('Failed to generate docker-compose.yml');
      if (composeError instanceof Error) {
        error(composeError.message);
      }
      return;
    }

    // Generate .env file
    const envSpin = spin('Generating .env file');
    try {
      await template.generate({
        props: {
          adminEmail: 'admin@example.com',
          adminPassword: 'admin',
          adminSecret,
          dbConfig: selectedDbConfig,
          dbType: database,
          keySecret,
          port: directusPort,
          version,
        },
        target: join(directusDir, '.env'),
        template: 'directus/.env.ejs',
      });
      envSpin.succeed();
    } catch (envError) {
      envSpin.fail('Failed to generate .env file');
      if (envError instanceof Error) {
        error(envError.message);
      }
      return;
    }

    // Generate README.md
    const readmeSpin = spin('Generating README.md');
    try {
      await template.generate({
        props: {
          dbType: database,
          instanceName,
          port: directusPort,
        },
        target: join(directusDir, 'README.md'),
        template: 'directus/README.md.ejs',
      });
      readmeSpin.succeed();
    } catch (readmeError) {
      readmeSpin.fail('Failed to generate README.md');
      if (readmeError instanceof Error) {
        error(readmeError.message);
      }
      return;
    }

    // Stop existing containers if updating
    if (instanceExists) {
      const stopSpin = spin('Stopping existing containers');
      try {
        await system.run(`cd ${directusDir} && docker-compose down`);
        stopSpin.succeed();
      } catch (stopError) {
        stopSpin.fail('Failed to stop existing containers');
        if (stopError instanceof Error) {
          error(stopError.message);
        }
      }
    }

    // Start Directus with docker-compose
    const startSpin = spin('Starting Directus instance');
    try {
      await system.run(`cd ${directusDir} && docker-compose up -d`);
      startSpin.succeed();
    } catch (startError) {
      startSpin.fail('Failed to start Directus');
      if (startError instanceof Error) {
        error(startError.message);
      }
      return;
    }

    // Success message
    success(`Directus Docker setup ${instanceExists ? 'updated' : 'created'} successfully!`);
    info('');
    info('Configuration stored at:');
    info(`  ${directusDir}`);
    info('');
    info('Instance details:');
    info(`  - Name: ${instanceName}`);
    info(`  - Version: ${version}`);
    info(`  - Database: ${database}`);
    info(`  - Port: ${directusPort}`);
    info('');

    // Only display secrets if this is a new instance (not updating)
    if (!existingEnv.KEY) {
      warning('Generated secrets (SAVE THESE):');
      info(`  KEY: ${keySecret}`);
      info(`  SECRET: ${adminSecret}`);
      if (selectedDbConfig.password) {
        info(`  DB_PASSWORD: ${selectedDbConfig.password}`);
      }
      if (database === 'mysql' && dbConfig.mysql.adminPassword) {
        info(`  MYSQL_ROOT_PASSWORD: ${dbConfig.mysql.adminPassword}`);
      }
      info('');
    }

    info('Default admin credentials:');
    info('  Email: admin@example.com');
    info('  Password: admin');
    info(`  URL: http://localhost:${directusPort}`);
    info('');
    info('');
    info('Management commands:');
    info(`  Start:   cd ${directusDir} && docker-compose up -d`);
    info(`  Stop:    cd ${directusDir} && docker-compose down`);
    info(`  Restart: cd ${directusDir} && docker-compose restart`);
    info(`  Logs:    cd ${directusDir} && docker-compose logs -f`);
    info('');
    info(`Full documentation: ${directusDir}/README.md`);

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `${instanceExists ? 'updated' : 'created'} directus docker setup ${instanceName}`;
  },
};

export default NewCommand;
