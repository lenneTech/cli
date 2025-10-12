import { paginateListObjectsV2, S3 } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import { GluegunCommand } from 'gluegun';
import * as path from 'path';
import { promisify } from 'util';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

const execAsync = promisify(require('child_process').exec);

interface S3BackupFile {
  key: string;
  label: string;
  lastModified?: Date;
  size?: number;
}

/**
 * Restore MongoDB database from S3 backup
 */
const command: GluegunCommand = {
  alias: ['s3r'],
  description: 'Restore MongoDB database from S3 backup',
  name: 's3-restore',
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

    info('MongoDB Restore from S3');
    info('');

    // ============================================================================
    // Step 1: S3 Configuration
    // ============================================================================

    info('Step 1: S3 Configuration');
    info('');

    const s3Bucket = await helper.getInput(parameters.options.bucket || process.env.S3_BUCKET, {
      name: 'S3 Bucket Name',
      showError: true,
    });
    if (!s3Bucket) {
      error('S3 Bucket is required');
      return;
    }

    const s3Key = await helper.getInput(parameters.options.key || process.env.S3_KEY, {
      name: 'S3 Access Key ID',
      showError: true,
    });
    if (!s3Key) {
      error('S3 Access Key ID is required');
      return;
    }

    const s3Secret = await helper.getInput(parameters.options.secret || process.env.S3_SECRET, {
      name: 'S3 Secret Access Key',
      showError: true,
    });
    if (!s3Secret) {
      error('S3 Secret Access Key is required');
      return;
    }

    const s3Url = await helper.getInput(parameters.options.url || process.env.S3_URL, {
      name: 'S3 Endpoint URL',
      showError: true,
    });
    if (!s3Url) {
      error('S3 Endpoint URL is required');
      return;
    }

    const s3Region = await helper.getInput(parameters.options.region || process.env.S3_REGION || 'de', {
      initial: 'de',
      name: 'S3 Region (optional)',
      showError: false,
    });

    const s3Folder = await helper.getInput(parameters.options.folder || process.env.S3_FOLDER || '', {
      initial: '',
      name: 'S3 Folder/Prefix (optional)',
      showError: false,
    });

    // ============================================================================
    // Step 2: Initialize S3 Client and List Backups
    // ============================================================================

    info('');
    info('Step 2: Fetching available backups from S3...');
    info('');

    let s3Client: S3;
    let backupFiles: S3BackupFile[] = [];

    try {
      s3Client = new S3({
        credentials: {
          accessKeyId: s3Key,
          secretAccessKey: s3Secret,
        },
        endpoint: s3Url,
        forcePathStyle: true,
        region: s3Region,
      });

      const listSpin = spin('Listing backup files from S3');

      // List all backup files from S3
      const paginator = paginateListObjectsV2(
        { client: s3Client },
        {
          Bucket: s3Bucket,
          Prefix: s3Folder,
        },
      );

      for await (const page of paginator) {
        const objects = page.Contents;

        if (!objects?.length) {
          continue;
        }

        backupFiles = [
          ...backupFiles,
          ...objects
            .filter(object => object.Key && (object.Key.endsWith('.tar.gz') || object.Key.endsWith('.archive')))
            .map(object => ({
              key: object.Key!,
              label: object.Key!.split('/').pop() || object.Key!,
              lastModified: object.LastModified,
              size: object.Size,
            })),
        ];
      }

      // Sort by last modified date (newest first)
      backupFiles.sort((a, b) => {
        if (!a.lastModified || !b.lastModified) {
          return 0;
        }
        return b.lastModified.getTime() - a.lastModified.getTime();
      });

      listSpin.succeed(`Found ${backupFiles.length} backup file(s)`);
    } catch (err: any) {
      error(`Failed to connect to S3 or list backups: ${err.message}`);
      return;
    }

    if (backupFiles.length === 0) {
      warning('No backup files found in the specified S3 bucket/folder');
      return;
    }

    // ============================================================================
    // Step 3: Select Backup File
    // ============================================================================

    info('');
    info('Step 3: Select backup file');
    info('');

    // Format backup files for selection with additional info
    const backupChoices = backupFiles.map((file, index) => {
      const sizeStr = file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'Unknown size';
      const dateStr = file.lastModified
        ? file.lastModified.toLocaleString('de-DE', {
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            month: '2-digit',
            year: 'numeric',
          })
        : 'Unknown date';
      const marker = index === 0 ? ' (newest)' : '';
      return {
        message: `${file.label}${marker} - ${dateStr} - ${sizeStr}`,
        name: file.key,
      };
    });

    const { selectedBackupKey } = await prompt.ask({
      choices: backupChoices,
      initial: 0, // Pre-select the newest (first) backup
      message: 'Select backup file to restore:',
      name: 'selectedBackupKey',
      type: 'select',
    });

    if (!selectedBackupKey) {
      error('No backup file selected');
      return;
    }

    const selectedBackup = backupFiles.find(f => f.key === selectedBackupKey);
    if (!selectedBackup) {
      error('Selected backup not found');
      return;
    }

    success(`Selected: ${selectedBackup.label}`);

    // ============================================================================
    // Step 4: Download Backup
    // ============================================================================

    info('');
    info('Step 4: Downloading backup...');
    info('');

    const tempDir = path.join('/tmp', `backup-${Date.now()}`);
    const backupFile = path.join(tempDir, 'backup.archive');

    try {
      await fs.promises.mkdir(tempDir, { recursive: true });

      const downloadSpin = spin(`Downloading ${selectedBackup.label}`);

      const command = {
        Bucket: s3Bucket,
        Key: selectedBackup.key,
      };

      const data = await s3Client.getObject(command);
      const bodyStream = data.Body as any;
      const bodyArray = await bodyStream.transformToByteArray();
      await fs.promises.writeFile(backupFile, Buffer.from(bodyArray));

      downloadSpin.succeed(
        `Downloaded ${selectedBackup.label} (${(bodyArray.length / 1024 / 1024).toFixed(2)} MB)`,
      );
    } catch (err: any) {
      error(`Failed to download backup: ${err.message}`);
      // Cleanup
      try {
        await fs.promises.rm(tempDir, { force: true, recursive: true });
      } catch (e) {
        // Ignore cleanup errors
      }
      return;
    }

    // ============================================================================
    // Step 5: Extract Backup
    // ============================================================================

    info('');
    info('Step 5: Extracting backup...');
    info('');

    const extractDir = path.join(tempDir, 'extracted');

    try {
      await fs.promises.mkdir(extractDir, { recursive: true });

      const extractSpin = spin('Extracting backup archive');
      const extractCommand = `tar -xzf "${backupFile}" -C "${extractDir}"`;
      await execAsync(extractCommand);
      extractSpin.succeed('Backup extracted');
    } catch (err: any) {
      error(`Failed to extract backup: ${err.message}`);
      // Cleanup
      try {
        await fs.promises.rm(tempDir, { force: true, recursive: true });
      } catch (e) {
        // Ignore cleanup errors
      }
      return;
    }

    // ============================================================================
    // Step 6: Find Databases in Backup
    // ============================================================================

    info('');
    info('Step 6: Detecting databases from backup...');
    info('');

    let backupRootDir = '';
    let sourceDbName = '';
    const systemDatabases = ['admin', 'local', 'config'];

    try {
      const findDbSpin = spin('Searching for database files');

      // Find all directories containing BSON files
      const findBsonCommand = `find "${extractDir}" -name "*.bson" -exec dirname {} \\; | sort -u`;
      const { stdout } = await execAsync(findBsonCommand);
      const dbPaths = stdout.trim().split('\n').filter(p => p);

      if (dbPaths.length === 0) {
        throw new Error('No database files found in backup');
      }

      // Find the common parent directory (backup root)
      // Example: /tmp/backup-xxx/extracted/tmp/backup-name/admin -> parent is /tmp/backup-xxx/extracted/tmp/backup-name
      const firstPath = dbPaths[0];
      const pathParts = firstPath.split('/');
      // The parent is everything except the last part (database name)
      backupRootDir = pathParts.slice(0, -1).join('/');

      // Get all database names from their directories
      const dbNames = dbPaths
        .map((p) => {
          const parts = p.split('/');
          return parts[parts.length - 1];
        })
        .filter((name, index, self) => self.indexOf(name) === index); // unique

      // Filter out system databases
      const userDatabases = dbNames.filter(name => !systemDatabases.includes(name));

      if (userDatabases.length === 0) {
        warning('Only system databases (admin, local, config) found in backup');
        warning('Will proceed, but you may want to check the backup file');
        sourceDbName = dbNames[0]; // Use first available database
      } else if (userDatabases.length === 1) {
        sourceDbName = userDatabases[0];
        findDbSpin.succeed(`Found database: ${sourceDbName}`);
      } else {
        findDbSpin.succeed(`Found ${userDatabases.length} databases`);

        // Let user select which database to restore
        info('');
        info('Multiple databases found in backup:');
        userDatabases.forEach(db => info(`  - ${db}`));
        info('');

        const { selectedDb } = await prompt.ask({
          choices: userDatabases,
          initial: 0,
          message: 'Select source database to restore:',
          name: 'selectedDb',
          type: 'select',
        });

        if (!selectedDb) {
          error('No database selected');
          // Cleanup
          try {
            await fs.promises.rm(tempDir, { force: true, recursive: true });
          } catch (e) {
            // Ignore cleanup errors
          }
          return;
        }

        sourceDbName = selectedDb;
        success(`Selected source database: ${sourceDbName}`);
      }

      info(`Backup root directory: ${backupRootDir}`);
    } catch (err: any) {
      error(`Could not detect databases: ${err.message}`);
      // Cleanup
      try {
        await fs.promises.rm(tempDir, { force: true, recursive: true });
      } catch (e) {
        // Ignore cleanup errors
      }
      return;
    }

    // ============================================================================
    // Step 7: MongoDB Configuration
    // ============================================================================

    info('');
    info('Step 7: MongoDB Configuration');
    info('');

    const mongoUri = await helper.getInput(
      parameters.options.mongoUri || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017',
      {
        initial: 'mongodb://127.0.0.1:27017',
        name: 'MongoDB Connection URI (without database name)',
        showError: true,
      },
    );
    if (!mongoUri) {
      error('MongoDB URI is required');
      // Cleanup
      try {
        await fs.promises.rm(tempDir, { force: true, recursive: true });
      } catch (e) {
        // Ignore cleanup errors
      }
      return;
    }

    const targetDbName = await helper.getInput(parameters.options.database || sourceDbName, {
      initial: sourceDbName,
      name: 'Target Database Name',
      showError: true,
    });
    if (!targetDbName) {
      error('Target database name is required');
      // Cleanup
      try {
        await fs.promises.rm(tempDir, { force: true, recursive: true });
      } catch (e) {
        // Ignore cleanup errors
      }
      return;
    }

    // ============================================================================
    // Step 8: Confirmation
    // ============================================================================

    info('');
    warning('IMPORTANT: This operation will restore the backup to the target database.');
    warning(`Target: ${mongoUri}/${targetDbName}`);
    warning('If the database already exists, it may be overwritten or merged.');
    info('');

    const { confirmRestore } = await prompt.ask({
      initial: false,
      message: `Proceed with restore to ${targetDbName}?`,
      name: 'confirmRestore',
      type: 'confirm',
    });

    if (!confirmRestore) {
      info('Restore cancelled');
      // Cleanup
      try {
        await fs.promises.rm(tempDir, { force: true, recursive: true });
      } catch (e) {
        // Ignore cleanup errors
      }
      return;
    }

    // ============================================================================
    // Step 9: Restore Database
    // ============================================================================

    info('');
    info('Step 9: Restoring database...');
    info('');

    try {
      const restoreSpin = spin(`Restoring ${sourceDbName} to ${targetDbName}`);

      // Build mongorestore command
      // If source and target names are the same, use simpler command
      let restoreCommand: string;
      if (sourceDbName === targetDbName) {
        // Restore without renaming
        const fullMongoUri = `${mongoUri}/${targetDbName}`;
        restoreCommand = `mongorestore --uri="${fullMongoUri}" --nsInclude="${sourceDbName}.*" "${backupRootDir}"`;
      } else {
        // Restore with renaming using --nsFrom and --nsTo
        restoreCommand = `mongorestore --uri="${mongoUri}" --nsFrom="${sourceDbName}.*" --nsTo="${targetDbName}.*" --nsInclude="${sourceDbName}.*" "${backupRootDir}"`;
      }

      info('Running: mongorestore ...');
      const { stderr } = await execAsync(restoreCommand, {
        maxBuffer: 1024 * 1024 * 50, // 50MB buffer for large outputs
      });

      // Check for actual failures (mongorestore outputs warnings to stderr)
      if (stderr && stderr.includes('Failed:') && !stderr.includes('0 document(s) failed')) {
        throw new Error(stderr);
      }

      restoreSpin.succeed(`Database restored successfully (${sourceDbName} → ${targetDbName})`);
    } catch (err: any) {
      error(`Failed to restore database: ${err.message}`);
      info('');
      info('Please ensure:');
      info('- MongoDB is running and accessible');
      info('- mongorestore tool is installed (part of MongoDB Database Tools)');
      info('- The MongoDB URI is correct');
      info('- The source database exists in the backup');
      // Cleanup
      try {
        await fs.promises.rm(tempDir, { force: true, recursive: true });
      } catch (e) {
        // Ignore cleanup errors
      }
      return;
    }

    // ============================================================================
    // Step 10: Cleanup
    // ============================================================================

    info('');
    const cleanupSpin = spin('Cleaning up temporary files');

    try {
      await fs.promises.rm(tempDir, { force: true, recursive: true });
      cleanupSpin.succeed('Temporary files cleaned up');
    } catch (err: any) {
      cleanupSpin.fail(`Failed to cleanup temporary files: ${err.message}`);
      warning(`You may need to manually delete: ${tempDir}`);
    }

    // ============================================================================
    // Done
    // ============================================================================

    info('');
    success(`Database restored successfully to ${targetDbName} in ${helper.msToMinutesAndSeconds(timer())}m`);
    info('');

    if (!parameters.options.fromGluegunMenu) {
      process.exit(0);
    }

    return `mongodb restored ${targetDbName}`;
  },
};

export default command;
