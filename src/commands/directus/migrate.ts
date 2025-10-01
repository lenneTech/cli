import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

interface DirectusConfig {
  migration: {
    batchSize: number;
    collections: string[];
    files: boolean;
    retryCount: number;
  };
  source: { token: string; url: string };
  target: { token: string; url: string };
}

/**
 * Directus Migrate Command
 * Selectively migrate schema + data + files between two Directus instances
 */
const NewCommand: GluegunCommand = {
  alias: ['m'],
  description:
    'Migrate collections between Directus instances. Use --source-url, --source-token, --target-url, --target-token, --collections (comma-separated), --files (true|false) for non-interactive mode.',
  hidden: false,
  name: 'migrate',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper,
      parameters,
      print: { error, info, spin, success },
      prompt: { ask },
      system: { startTimer },
    } = toolbox;

    // Start timer
    const timer = startTimer();

    info('=== Directus Selective Migration ===\n');

    const config: DirectusConfig = {
      migration: {
        batchSize: 100,
        collections: [],
        files: false,
        retryCount: 3,
      },
      source: { token: '', url: '' },
      target: { token: '', url: '' },
    };

    // Helper functions
    const log = (...m: any[]) => info(`[directus-migrate] ${m.join(' ')}`);

    const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

    // Fetch helper with retry logic
    const dfetch = async (base: string, token: string, url: string, opts: RequestInit = {}, retry = 4): Promise<any> => {
      const full = base.replace(/\/$/, '') + url;
      const res = await fetch(full, {
        ...opts,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(opts.headers || {}),
        },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (retry > 0 && [429, 502, 503, 504].includes(res.status)) {
          await sleep(500 * (5 - retry));
          return dfetch(base, token, url, opts, retry - 1);
        }
        throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url}: ${text}`);
      }

      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        return res.json();
      }
      return res.text();
    };

    // 1. Get source credentials
    config.source.url
      = parameters.options['source-url']
      || (await ask({ message: 'Source URL:', name: 'url', type: 'input' })).url;

    config.source.token
      = parameters.options['source-token']
      || (await ask({ message: 'Source Token:', name: 'token', type: 'password' })).token;

    // 2. Get target credentials
    config.target.url
      = parameters.options['target-url']
      || (await ask({ message: 'Target URL:', name: 'url', type: 'input' })).url;

    config.target.token
      = parameters.options['target-token']
      || (await ask({ message: 'Target Token:', name: 'token', type: 'password' })).token;

    // 3. Validate credentials
    const validateSpinner = spin('Validating credentials...');
    try {
      const sourceUser = await dfetch(config.source.url, config.source.token, '/users/me');
      log(`✓ Source credentials valid (User: ${sourceUser?.data?.email || 'Unknown'})`);
    } catch (err: any) {
      validateSpinner.fail();
      error(`✗ Source credentials invalid: ${err.message}`);
      return;
    }

    try {
      const targetUser = await dfetch(config.target.url, config.target.token, '/users/me');
      log(`✓ Target credentials valid (User: ${targetUser?.data?.email || 'Unknown'})`);
    } catch (err: any) {
      validateSpinner.fail();
      error(`✗ Target credentials invalid: ${err.message}`);
      return;
    }
    validateSpinner.succeed('Credentials validated');

    // 4. Fetch and display available collections
    const collectionsSpinner = spin('Fetching available collections...');
    const collectionsResponse = await dfetch(config.source.url, config.source.token, '/collections');
    const allCollections = collectionsResponse?.data || [];
    const userCollections = allCollections.filter((c: any) => !c.collection.startsWith('directus_'));
    collectionsSpinner.succeed(`Found ${userCollections.length} collections`);

    info('\n=== Available Collections ===');
    userCollections.forEach((col: any, idx: number) => {
      info(`${idx + 1}. ${col.collection}${col.meta?.group ? ` (in ${col.meta.group})` : ''}`);
    });

    // 5. Collection selection
    if (parameters.options.collections) {
      config.migration.collections = parameters.options.collections.split(',').map((c: string) => c.trim());
    } else {
      const selectedIndices = (
        await ask({
          message: 'Enter collection numbers (comma-separated, e.g., 1,3,5):',
          name: 'indices',
          type: 'input',
        })
      ).indices;

      const indices = selectedIndices.split(',').map((s: string) => parseInt(s.trim()) - 1);
      config.migration.collections = indices
        .filter((i: number) => i >= 0 && i < userCollections.length)
        .map((i: number) => userCollections[i].collection);
    }

    if (config.migration.collections.length === 0) {
      error('No valid collections selected.');
      return;
    }

    log(`Selected collections: ${config.migration.collections.join(', ')}`);

    // 6. Ask about files migration
    if (parameters.options.files !== undefined) {
      config.migration.files = parameters.options.files === 'true' || parameters.options.files === true;
    } else {
      const filesAnswer = await ask({ message: 'Migrate files?', name: 'files', type: 'confirm' });
      config.migration.files = !!filesAnswer.files;
    }

    // 7. Show migration plan
    info('\n=== Migration Plan ===');
    info(`Source: ${config.source.url}`);
    info(`Target: ${config.target.url}`);
    info(`Collections: ${config.migration.collections.join(', ')}`);
    info(`Migrate Files: ${config.migration.files ? 'Yes' : 'No'}`);
    info(`Batch Size: ${config.migration.batchSize}`);
    info(`Retry Count: ${config.migration.retryCount}`);

    const proceed = await ask({ message: 'Proceed with migration?', name: 'proceed', type: 'confirm' });
    if (!proceed.proceed) {
      info('Migration cancelled.');
      return;
    }

    // 8. Execute migration
    try {
      await executeMigration(config, { dfetch, error, info, log, sleep, spin, success });
      success(`Migration completed in ${helper.msToMinutesAndSeconds(timer())}m`);
    } catch (err: any) {
      error(`Migration failed: ${err.message}`);
    }
  },
};

// Migration execution function
async function executeMigration(
  config: DirectusConfig,
  helpers: {
    dfetch: (base: string, token: string, url: string, opts?: RequestInit, retry?: number) => Promise<any>;
    error: (...m: any[]) => void;
    info: (...m: any[]) => void;
    log: (...m: any[]) => void;
    sleep: (ms: number) => Promise<void>;
    spin: (message: string) => any;
    success: (...m: any[]) => void;
  },
) {
  const { dfetch, info, log, sleep, spin } = helpers;
  const { migration, source, target } = config;

  // Step 1: Fetch schema snapshot
  const schemaSpinner = spin('Fetching schema...');
  const [collections, fields, relations] = await Promise.all([
    dfetch(source.url, source.token, '/collections'),
    dfetch(source.url, source.token, '/fields'),
    dfetch(source.url, source.token, '/relations'),
  ]);

  const snapshot = {
    collections: collections?.data || [],
    fields: fields?.data || [],
    relations: relations?.data || [],
  };

  // Filter snapshot to only include selected collections
  const keepSet = new Set(migration.collections);

  // Find junction tables for M2M relations (exclude directus_ system tables)
  const junctionTables = new Set<string>();
  const junctionTableInfo = new Map<string, { related: string; source: string }>();

  snapshot.relations.forEach((r: any) => {
    if (r.meta?.junction_field && r.meta?.many_collection) {
      const junctionTable = r.meta.many_collection;

      // Skip directus system tables
      if (junctionTable.startsWith('directus_')) {
        return;
      }

      junctionTables.add(junctionTable);

      // Track which collections this junction table connects
      // r.collection is the junction table itself (e.g., m2m2_m2m1)
      // r.meta.one_collection is the target collection (e.g., m2m2 or m2m1)
      // We need to store both sides of the M2M relation
      const existingInfo = junctionTableInfo.get(junctionTable);
      const targetCollection = r.meta.one_collection || r.related_collection;

      if (!existingInfo) {
        junctionTableInfo.set(junctionTable, {
          related: targetCollection,
          source: junctionTable,
        });
      } else if (targetCollection && targetCollection !== existingInfo.related) {
        // Update with the second side of the relation
        junctionTableInfo.set(junctionTable, {
          related: targetCollection,
          source: existingInfo.related,
        });
      }
    }
  });

  // Debug: Show junction table info
  log('\n🔍 DEBUG: Junction table info:');
  junctionTableInfo.forEach((info, jt) => {
    log(`  ${jt}: source=${info.source}, related=${info.related}`);
  });

  // Add junction tables to collections to migrate (only if both connected collections are being migrated)
  junctionTables.forEach((jt) => {
    if (!keepSet.has(jt)) {
      const info = junctionTableInfo.get(jt);
      // Only add junction table if both source and related collections are being migrated
      if (info && keepSet.has(info.source) && keepSet.has(info.related)) {
        keepSet.add(jt);
        migration.collections.push(jt);
        log(`📋 Auto-added junction table: ${jt} (connects ${info.source} ↔ ${info.related})`);
      }
    }
  });

  const trimmedSnapshot = {
    collections: snapshot.collections.filter((c: any) => keepSet.has(c.collection)),
    fields: snapshot.fields.filter((f: any) => keepSet.has(f.collection)),
    relations: snapshot.relations.filter(
      (r: any) => keepSet.has(r.collection) || keepSet.has(r.related_collection),
    ),
  };

  schemaSpinner.succeed(
    `Schema fetched: ${trimmedSnapshot.collections.length} collections, ${trimmedSnapshot.fields.length} fields, ${trimmedSnapshot.relations.length} relations`,
  );

  // Step 2: Create collections
  info('\n📦 Creating Collections...');
  for (const collection of trimmedSnapshot.collections) {
    try {
      log(`Creating collection: ${collection.collection}`);
      await dfetch(target.url, target.token, '/collections', {
        body: JSON.stringify(collection),
        method: 'POST',
      });
      log(`✓ Created: ${collection.collection}`);
    } catch (err: any) {
      if (err.message.includes('already exists') || err.message.includes('409')) {
        log(`⚪ Collection ${collection.collection} already exists, skipping`);
      } else {
        log(`✗ Error creating ${collection.collection}: ${err.message}`);
      }
    }
  }

  // Step 3: Create fields
  info('\n🔧 Creating Fields...');
  for (const field of trimmedSnapshot.fields) {
    try {
      log(`Creating field: ${field.collection}.${field.field}`);
      await dfetch(target.url, target.token, `/fields/${field.collection}`, {
        body: JSON.stringify(field),
        method: 'POST',
      });
      log(`✓ Created: ${field.collection}.${field.field}`);
    } catch (err: any) {
      if (err.message.includes('already exists') || err.message.includes('409')) {
        log(`⚪ Field ${field.collection}.${field.field} already exists, skipping`);
      } else {
        log(`✗ Error creating ${field.collection}.${field.field}: ${err.message}`);
      }
    }
  }

  // Step 4: Create relations (with proper dependency order)
  info('\n🔗 Creating Relations...');

  // Sort relations to create in proper order
  const sortedRelations = sortRelationsByDependency(trimmedSnapshot.relations, migration.collections);

  for (const relation of sortedRelations) {
    try {
      const relType = relation.meta?.junction_field ? 'M2M' : 'M2O';
      const targetDesc = relation.related_collection || `junction:${relation.meta?.many_collection || 'unknown'}`;
      log(`Creating ${relType} relation: ${relation.collection}.${relation.field} -> ${targetDesc}`);

      // Clean relation data - remove meta fields that cause issues
      const cleanRelation: any = {
        collection: relation.collection,
        field: relation.field,
        related_collection: relation.related_collection,
      };

      // Add optional fields only if they exist
      if (relation.meta) {
        cleanRelation.meta = {};

        // Copy all meta fields that exist
        const metaFields = [
          'junction_field',
          'many_collection',
          'many_field',
          'one_allowed_collections',
          'one_collection',
          'one_collection_field',
          'one_deselect_action',
          'one_field',
          'sort_field',
        ];

        metaFields.forEach((field) => {
          if (relation.meta[field] !== undefined) {
            cleanRelation.meta[field] = relation.meta[field];
          }
        });
      }

      if (relation.schema) {
        cleanRelation.schema = {};

        const schemaFields = [
          'constraint_name',
          'foreign_key_column',
          'foreign_key_table',
          'on_delete',
          'on_update',
          'table',
        ];

        schemaFields.forEach((field) => {
          if (relation.schema[field] !== undefined) {
            cleanRelation.schema[field] = relation.schema[field];
          }
        });
      }

      await dfetch(target.url, target.token, '/relations', {
        body: JSON.stringify(cleanRelation),
        method: 'POST',
      });
      log(`✓ Created ${relType} relation`);
    } catch (err: any) {
      if (err.message.includes('already exists') || err.message.includes('409')) {
        log('⚪ Relation already exists, skipping');
      } else if (err.message.includes('Foreign key constraint')) {
        log('⚠️  Skipping relation due to constraint issue (will retry after data migration)');
      } else {
        log(`✗ Error creating relation: ${err.message}`);
      }
    }
  }

  // Step 5: Migrate files (if requested)
  let fileMapping = new Map<string, string>();
  if (migration.files) {
    info('\n📁 Migrating Files...');
    fileMapping = await migrateFiles(config, helpers);
    log(`✓ File migration complete: ${fileMapping.size} files mapped`);
  }

  // Step 6: Migrate data
  info('\n📊 Migrating Data...');
  const globalIdMapping = new Map<string, string>();
  const migratedCollections = new Set<string>();
  const isJunctionTable = (name: string) => junctionTables.has(name);

  // Build M2M field map (fields that should be excluded from data migration)
  const m2mFieldsByCollection = new Map<string, Set<string>>();

  log('\n🔍 Analyzing relations for M2M fields...');

  snapshot.relations.forEach((rel: any) => {
    // M2M relations are identified by having a junction_field
    // The one_field on the one_collection is the M2M array field that should be excluded
    if (rel.meta?.junction_field && rel.meta?.one_collection && rel.meta?.one_field) {
      const targetCollection = rel.meta.one_collection;
      const targetField = rel.meta.one_field;

      if (!m2mFieldsByCollection.has(targetCollection)) {
        m2mFieldsByCollection.set(targetCollection, new Set());
      }
      m2mFieldsByCollection.get(targetCollection)!.add(targetField);
      log(`  ✅ Found M2M field: ${targetCollection}.${targetField} (junction: ${rel.collection})`);
    }
  });

  log('\n📋 M2M Fields by Collection:');
  m2mFieldsByCollection.forEach((fields, collection) => {
    log(`  ${collection}: [${Array.from(fields).join(', ')}]`);
  });

  // Separate regular collections and junction tables
  const regularCollections = migration.collections.filter(c => !isJunctionTable(c));
  const junctionCollections = migration.collections.filter(c => isJunctionTable(c));

  let remainingCollections = [...regularCollections];
  let currentRetry = 0;
  let successCount = 0;

  // Phase 1: Migrate regular collections
  log('📦 Phase 1: Migrating regular collections...');
  while (remainingCollections.length > 0 && currentRetry <= migration.retryCount) {
    log(
      `🔄 Migration Round ${currentRetry + 1}/${migration.retryCount + 1} - ${remainingCollections.length} collections remaining`,
    );

    const readyCollections = getReadyCollections(remainingCollections, snapshot.relations, migratedCollections);

    if (readyCollections.length === 0) {
      log('⚠️  No collections ready, attempting to break circular dependency');
      if (remainingCollections.length > 0) {
        readyCollections.push(remainingCollections[0]);
      } else {
        break;
      }
    }

    for (const collectionName of readyCollections) {
      try {
        log(`🔸 Migrating collection: ${collectionName}`);

        // Fetch items
        const items = await fetchAllItems(source.url, source.token, collectionName, migration.batchSize, dfetch);
        log(`  Fetched ${items.length} items from ${collectionName}`);

        if (items.length === 0) {
          migratedCollections.add(collectionName);
          remainingCollections = remainingCollections.filter(c => c !== collectionName);
          successCount++;
          continue;
        }

        // Sanitize and import
        const m2mFields = m2mFieldsByCollection.get(collectionName) || new Set();
        log(`  🔍 DEBUG: M2M fields for ${collectionName}: [${Array.from(m2mFields).join(', ')}]`);

        const sanitized = sanitizeItems(items, fileMapping, globalIdMapping, m2mFields);

        // Log first item for debugging
        if (sanitized.length > 0) {
          log(`  📝 Sample item keys BEFORE sanitization: ${Object.keys(items[0]).join(', ')}`);
          log(`  📝 Sample item keys AFTER sanitization: ${Object.keys(sanitized[0]).join(', ')}`);
        }

        await importItems(target.url, target.token, collectionName, sanitized, globalIdMapping, dfetch);

        log(`  ✅ Successfully migrated ${collectionName} (${items.length} items)`);
        migratedCollections.add(collectionName);
        remainingCollections = remainingCollections.filter(c => c !== collectionName);
        successCount++;
      } catch (err: any) {
        log(`  ❌ Failed to migrate ${collectionName}: ${err.message}`);
        // Try to give more details about the error
        if (err.message.includes('403') || err.message.includes('Forbidden')) {
          log(`  💡 Tip: Check if target user has permissions for ${collectionName}`);
          log('  💡 Tip: Check if collection has user_created/user_updated fields causing issues');
        }
      }
    }

    currentRetry++;
    if (remainingCollections.length > 0) {
      await sleep(1000);
    }
  }

  // Phase 2: Migrate junction tables (M2M relations)
  if (junctionCollections.length > 0) {
    log('\n📋 Phase 2: Migrating junction tables (M2M relations)...');

    // Check which collections from Phase 1 were actually migrated
    const failedPhase1Collections = regularCollections.filter(c => !migratedCollections.has(c));
    if (failedPhase1Collections.length > 0) {
      log(`⚠️  Warning: Some collections failed in Phase 1: ${failedPhase1Collections.join(', ')}`);
      log('  Junction tables depending on these collections may fail.');
    }

    for (const junctionName of junctionCollections) {
      try {
        log(`🔸 Migrating junction table: ${junctionName}`);

        // Check if both connected collections were migrated successfully
        const info = junctionTableInfo.get(junctionName);
        if (info) {
          const sourceMigrated = migratedCollections.has(info.source);
          const relatedMigrated = migratedCollections.has(info.related);

          if (!sourceMigrated || !relatedMigrated) {
            const missing = [];
            if (!sourceMigrated) {
missing.push(info.source);
}
            if (!relatedMigrated) {
missing.push(info.related);
}
            log(`  ⚠️  Skipping: Required collections not migrated: ${missing.join(', ')}`);
            continue;
          }
        }

        // Fetch items
        const items = await fetchAllItems(source.url, source.token, junctionName, migration.batchSize, dfetch);
        log(`  Fetched ${items.length} junction items from ${junctionName}`);

        if (items.length === 0) {
          migratedCollections.add(junctionName);
          successCount++;
          continue;
        }

        // Sanitize and import - junction tables need ID mapping (no M2M fields in junction tables)
        const sanitized = sanitizeItems(items, fileMapping, globalIdMapping, new Set());
        await importItems(target.url, target.token, junctionName, sanitized, globalIdMapping, dfetch);

        log(`  ✅ Successfully migrated junction table ${junctionName} (${items.length} items)`);
        migratedCollections.add(junctionName);
        successCount++;
      } catch (err: any) {
        log(`  ❌ Failed to migrate junction table ${junctionName}: ${err.message}`);
      }
    }
  }

  // Final summary
  info('\n=== Migration Summary ===');
  log(`✅ Successfully migrated: ${successCount} collections`);
  if (remainingCollections.length > 0) {
    log(`❌ Failed to migrate: ${remainingCollections.join(', ')}`);
  }
  log(`🔗 ID mappings created: ${globalIdMapping.size} items`);
  if (fileMapping.size > 0) {
    log(`📁 Files migrated: ${fileMapping.size}`);
  }
}

// Helper: Fetch all items with pagination
async function fetchAllItems(base: string, token: string, collection: string, batchSize: number, dfetch: any): Promise<any[]> {
  let page = 1;
  const all: any[] = [];

  while (true) {
    const params = new URLSearchParams();
    params.set('limit', String(batchSize));
    params.set('page', String(page));
    params.set('fields', '*');

    const res = await dfetch(base, token, `/items/${encodeURIComponent(collection)}?${params.toString()}`);
    const items = res?.data || [];
    all.push(...items);

    const cur = Number(res?.meta?.page);
    const pages = Number(res?.meta?.pageCount ?? (items.length < batchSize ? page : page + 1));

    if (!cur || cur >= pages || items.length === 0) {
      break;
    }
    page++;
  }

  return all;
}

// Helper: Get collections ready for migration
function getReadyCollections(remaining: string[], relations: any[], migrated: Set<string>): string[] {
  const ready: string[] = [];

  for (const collection of remaining) {
    const deps = relations
      .filter((r: any) => r.collection === collection)
      .map((r: any) => r.related_collection)
      .filter((dep: string) => remaining.includes(dep) && !migrated.has(dep));

    if (deps.length === 0) {
      ready.push(collection);
    }
  }

  return ready;
}

// Helper: Import items with ID mapping
async function importItems(
  base: string,
  token: string,
  collection: string,
  items: any[],
  globalIdMapping: Map<string, string>,
  dfetch: any,
): Promise<void> {
  const chunk = (arr: any[], size: number) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) {
      out.push(arr.slice(i, i + size));
    }
    return out;
  };

  for (const ch of chunk(items, 100)) {
    const cleanItems = ch.map((item) => {
      const { _originalId, ...cleanItem } = item;
      return cleanItem;
    });

    const response = await dfetch(base, token, `/items/${encodeURIComponent(collection)}`, {
      body: JSON.stringify(cleanItems),
      method: 'POST',
    });

    const responseData = Array.isArray(response.data) ? response.data : [response.data];
    responseData.forEach((newItem: any, index: number) => {
      const originalItem = ch[index];
      if (originalItem._originalId && newItem.id) {
        globalIdMapping.set(String(originalItem._originalId), String(newItem.id));
      }
    });
  }
}

// Helper: Migrate files
async function migrateFiles(config: DirectusConfig, helpers: any): Promise<Map<string, string>> {
  const { dfetch, log } = helpers;
  const fileMapping = new Map<string, string>();

  // Scan collections for file references
  const fileIds = new Set<string>();
  for (const collectionName of config.migration.collections) {
    log(`Scanning ${collectionName} for file references...`);
    const items = await fetchAllItems(
      config.source.url,
      config.source.token,
      collectionName,
      config.migration.batchSize,
      dfetch,
    );

    items.forEach((item) => {
      Object.values(item).forEach((value) => {
        if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
          fileIds.add(value);
        }
      });
    });
  }

  log(`Found ${fileIds.size} file references`);

  // Migrate each file
  for (const fileId of fileIds) {
    try {
      log(`Migrating file: ${fileId}`);

      const fileInfo = await dfetch(config.source.url, config.source.token, `/files/${fileId}`);
      const filename = fileInfo.data?.filename_download || fileInfo.data?.filename_disk || `file_${fileId}`;

      const fileResponse = await fetch(`${config.source.url.replace(/\/$/, '')}/assets/${fileId}`, {
        headers: { Authorization: `Bearer ${config.source.token}` },
      });

      if (!fileResponse.ok) {
        throw new Error(`Failed to download: ${fileResponse.status}`);
      }

      const fileBlob = await fileResponse.blob();
      const formData = new FormData();
      formData.append('file', fileBlob, filename);

      const uploadResponse = await fetch(`${config.target.url.replace(/\/$/, '')}/files`, {
        body: formData,
        headers: { Authorization: `Bearer ${config.target.token}` },
        method: 'POST',
      });

      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload: ${uploadResponse.status}`);
      }

      const uploadResult = await uploadResponse.json();
      const newFileId = uploadResult.data?.id;

      if (newFileId) {
        fileMapping.set(fileId, newFileId);
        log(`✓ Migrated file ${fileId} -> ${newFileId}`);
      }
    } catch (err: any) {
      log(`✗ Failed to migrate file ${fileId}: ${err.message}`);
    }
  }

  return fileMapping;
}

// Helper: Sanitize items for import
function sanitizeItems(
  items: any[],
  fileMapping: Map<string, string>,
  idMapping: Map<string, string>,
  m2mFields: Set<string>,
): any[] {
  return items.map((item) => {
    const sanitized = { ...item };
    const originalId = sanitized.id;
    delete sanitized.id;

    // Remove system fields that might cause permission issues
    delete sanitized.user_created;
    delete sanitized.user_updated;
    delete sanitized.date_created;
    delete sanitized.date_updated;

    // Remove M2M relation fields (they'll be populated via junction table)
    m2mFields.forEach((fieldName) => {
      delete sanitized[fieldName];
    });

    // Map file and ID references
    Object.keys(sanitized).forEach((key) => {
      const value = sanitized[key];

      // Skip null/undefined values
      if (value === null || value === undefined) {
        return;
      }

      if (typeof value === 'string') {
        if (fileMapping.has(value)) {
          sanitized[key] = fileMapping.get(value);
        } else if (idMapping.has(value)) {
          sanitized[key] = idMapping.get(value);
        }
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map((v) => {
          const vStr = String(v);
          return fileMapping.get(vStr) || idMapping.get(vStr) || v;
        });
      }
    });

    return { ...sanitized, _originalId: originalId };
  });
}

// Helper: Sort relations by dependency (M2M need special handling)
function sortRelationsByDependency(relations: any[], collections: string[]): any[] {
  const collectionsSet = new Set(collections);

  // Separate M2M relations from regular relations
  const m2mRelations: any[] = [];
  const regularRelations: any[] = [];

  relations.forEach((rel) => {
    const hasCollection = collectionsSet.has(rel.collection);
    const hasRelated = !rel.related_collection || collectionsSet.has(rel.related_collection);

    if (!hasCollection || !hasRelated) {
      return; // Skip if collections don't exist
    }

    if (rel.meta?.junction_field) {
      m2mRelations.push(rel);
    } else {
      regularRelations.push(rel);
    }
  });

  // For M2M, we need to ensure junction collection exists
  const validM2M = m2mRelations.filter((rel) => {
    const junctionCollection = rel.meta?.many_collection;
    return !junctionCollection || collectionsSet.has(junctionCollection);
  });

  // Return regular relations first, then M2M relations
  return [...regularRelations, ...validM2M];
}

export default NewCommand;
