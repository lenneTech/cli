import * as fs from 'fs';
import { GluegunCommand } from 'gluegun';
import * as path from 'path';
import { promisify } from 'util';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

const execAsync = promisify(require('child_process').exec);

/**
 * Export MongoDB collection to JSON file
 */
const command: GluegunCommand = {
  alias: ['ce'],
  description: 'Export collection to JSON',
  name: 'collection-export',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper,
      parameters,
      print: { error, info, spin, success, warning },
      prompt,
      system,
    } = toolbox;

    // Start timer
    const timer = system.startTimer();

    info('MongoDB Collection Export');
    info('');

    // ============================================================================
    // Step 1: MongoDB Connection
    // ============================================================================

    info('Step 1: MongoDB Connection');
    info('');

    const mongoUri = await helper.getInput(
      parameters.options.mongoUri || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017',
      {
        initial: 'mongodb://127.0.0.1:27017',
        name: 'MongoDB Connection URI',
        showError: true,
      },
    );
    if (!mongoUri) {
      error('MongoDB URI is required');
      return;
    }

    // ============================================================================
    // Step 2: List Databases
    // ============================================================================

    info('');
    info('Step 2: Fetching databases...');
    info('');

    let databases: string[] = [];
    const systemDatabases = ['admin', 'local', 'config'];

    try {
      const listDbSpin = spin('Listing databases');

      // Use mongo shell to list databases
      const listDbCommand = `mongosh "${mongoUri}" --quiet --eval "JSON.stringify(db.adminCommand('listDatabases').databases.map(d => d.name))"`;
      const { stdout } = await execAsync(listDbCommand);

      const allDatabases = JSON.parse(stdout.trim());
      // Filter out system databases
      databases = allDatabases.filter((db: string) => !systemDatabases.includes(db));

      if (databases.length === 0) {
        listDbSpin.fail('No user databases found');
        warning('Only system databases (admin, local, config) are available');
        return;
      }

      listDbSpin.succeed(`Found ${databases.length} database(s)`);
    } catch (err: any) {
      error(`Failed to list databases: ${err.message}`);
      info('');
      info('Please ensure:');
      info('- MongoDB is running and accessible');
      info('- mongosh (MongoDB Shell) is installed');
      info('- The MongoDB URI is correct');
      return;
    }

    // ============================================================================
    // Step 3: Select Database
    // ============================================================================

    info('');
    info('Step 3: Select database');
    info('');

    let selectedDatabase: string;

    if (parameters.options.database) {
      selectedDatabase = parameters.options.database;
      if (!databases.includes(selectedDatabase)) {
        error(`Database "${selectedDatabase}" not found`);
        return;
      }
      success(`Using database: ${selectedDatabase}`);
    } else {
      const { database } = await prompt.ask({
        choices: databases,
        initial: 0,
        message: 'Select database:',
        name: 'database',
        type: 'select',
      });

      if (!database) {
        error('No database selected');
        return;
      }

      selectedDatabase = database;
      success(`Selected database: ${selectedDatabase}`);
    }

    // ============================================================================
    // Step 4: List Collections
    // ============================================================================

    info('');
    info('Step 4: Fetching collections...');
    info('');

    let collections: string[] = [];

    try {
      const listCollSpin = spin('Listing collections');

      // Use mongo shell to list collections
      const listCollCommand = `mongosh "${mongoUri}/${selectedDatabase}" --quiet --eval "JSON.stringify(db.getCollectionNames())"`;
      const { stdout } = await execAsync(listCollCommand);

      collections = JSON.parse(stdout.trim());

      if (collections.length === 0) {
        listCollSpin.fail('No collections found in this database');
        return;
      }

      listCollSpin.succeed(`Found ${collections.length} collection(s)`);
    } catch (err: any) {
      error(`Failed to list collections: ${err.message}`);
      return;
    }

    // ============================================================================
    // Step 5: Select Collection
    // ============================================================================

    info('');
    info('Step 5: Select collection');
    info('');

    let selectedCollection: string;

    if (parameters.options.collection) {
      selectedCollection = parameters.options.collection;
      if (!collections.includes(selectedCollection)) {
        error(`Collection "${selectedCollection}" not found`);
        return;
      }
      success(`Using collection: ${selectedCollection}`);
    } else {
      const { collection } = await prompt.ask({
        choices: collections,
        initial: 0,
        message: 'Select collection:',
        name: 'collection',
        type: 'select',
      });

      if (!collection) {
        error('No collection selected');
        return;
      }

      selectedCollection = collection;
      success(`Selected collection: ${selectedCollection}`);
    }

    // Get document count
    try {
      const countCommand = `mongosh "${mongoUri}/${selectedDatabase}" --quiet --eval "db.${selectedCollection}.countDocuments()"`;
      const { stdout } = await execAsync(countCommand);
      const count = parseInt(stdout.trim(), 10);
      info(`Collection contains ${count} document(s)`);
    } catch (err: any) {
      warning(`Could not get document count: ${err.message}`);
    }

    // ============================================================================
    // Step 6: Output File Path
    // ============================================================================

    info('');
    info('Step 6: Output file path');
    info('');

    const defaultFilename = `${selectedDatabase}_${selectedCollection}_${Date.now()}.json`;
    const defaultPath = path.join(process.cwd(), defaultFilename);

    const outputPath = await helper.getInput(parameters.options.output || defaultPath, {
      initial: defaultPath,
      name: 'Output file path',
      showError: true,
    });

    if (!outputPath) {
      error('Output path is required');
      return;
    }

    // Check if file exists
    if (await toolbox.filesystem.existsAsync(outputPath)) {
      const { overwrite } = await prompt.ask({
        initial: false,
        message: `File "${outputPath}" already exists. Overwrite?`,
        name: 'overwrite',
        type: 'confirm',
      });

      if (!overwrite) {
        info('Export cancelled');
        return;
      }
    }

    // Ensure directory exists
    const outputDir = path.dirname(outputPath);
    try {
      await fs.promises.mkdir(outputDir, { recursive: true });
    } catch (err: any) {
      error(`Failed to create directory: ${err.message}`);
      return;
    }

    // ============================================================================
    // Step 7: Export Data
    // ============================================================================

    info('');
    info('Step 7: Exporting data...');
    info('');

    try {
      const exportSpin = spin(`Exporting ${selectedDatabase}.${selectedCollection}`);

      // Use mongoexport to export collection
      const exportCommand = `mongoexport --uri="${mongoUri}/${selectedDatabase}" --collection="${selectedCollection}" --out="${outputPath}" --jsonArray`;

      const { stderr } = await execAsync(exportCommand, {
        maxBuffer: 1024 * 1024 * 100, // 100MB buffer
      });

      // mongoexport outputs progress to stderr, check for actual errors
      if (stderr && stderr.toLowerCase().includes('error') && !stderr.includes('exported')) {
        throw new Error(stderr);
      }

      exportSpin.succeed('Data exported successfully');

      // Get file size
      const stats = await fs.promises.stat(outputPath);
      const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
      info(`File size: ${fileSizeMB} MB`);
    } catch (err: any) {
      error(`Failed to export data: ${err.message}`);
      info('');
      info('Please ensure:');
      info('- MongoDB is running and accessible');
      info('- mongoexport tool is installed (part of MongoDB Database Tools)');
      info('- You have read permissions on the database/collection');
      info('- You have write permissions to the output directory');
      return;
    }

    // ============================================================================
    // Done
    // ============================================================================

    info('');
    success(`Collection exported successfully in ${helper.msToMinutesAndSeconds(timer())}m`);
    success(`Output: ${outputPath}`);
    info('');

    if (!parameters.options.fromGluegunMenu) {
      process.exit(0);
    }

    return `mongodb export ${selectedDatabase}.${selectedCollection}`;
  },
};

export default command;
