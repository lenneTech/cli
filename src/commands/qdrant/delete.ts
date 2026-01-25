import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

interface QdrantCollection {
  name: string;
}

interface QdrantCollectionsResponse {
  result?: {
    collections: QdrantCollection[];
  };
}

const command: GluegunCommand = {
  alias: ['d'],
  description: 'Deletes a Qdrant collection',
  name: 'delete',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const { http, print, prompt } = toolbox;

    const qdrantApi = http.create({
      baseURL: 'http://localhost:6333',
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    });

    // 1. Fetch all collections
    const collectionsResponse = await qdrantApi.get<QdrantCollectionsResponse>(
      '/collections',
    );

    if (!collectionsResponse.ok) {
      print.error('Error fetching collections from Qdrant.');
      print.info('Please ensure Qdrant is running on http://localhost:6333');
      return;
    }

    const collections = collectionsResponse.data?.result?.collections;
    if (!collections || collections.length === 0) {
      print.warning('No collections found in Qdrant.');
      return;
    }

    const collectionNames = collections.map(c => c.name);

    // 2. Ask user to select a collection
    const { collectionToDelete } = await prompt.ask({
      choices: collectionNames,
      message: 'Which collection do you want to delete?',
      name: 'collectionToDelete',
      type: 'select',
    });

    if (!collectionToDelete) {
      print.info('No collection selected. Aborting.');
      return;
    }

    print.info(`You selected: ${collectionToDelete}`);

    // 3. Confirm the action
    const { confirm } = await prompt.ask({
      initial: true,
      message: `Are you sure you want to delete collection "${collectionToDelete}"? This action cannot be undone.`,
      name: 'confirm',
      type: 'confirm',
    });

    if (!confirm) {
      print.info('Aborting.');
      return;
    }

    const spinner = print.spin(`Deleting collection "${collectionToDelete}"...`);

    // 4. Delete the collection
    const deleteResponse = await qdrantApi.delete(
      `/collections/${collectionToDelete}`,
    );
    if (!deleteResponse.ok) {
      spinner.fail(`Error deleting collection "${collectionToDelete}".`);
      print.error(deleteResponse.data);
      return;
    }

    spinner.succeed(`Successfully deleted collection "${collectionToDelete}".`);

    // Exit if not running from menu
    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return `qdrant deleted ${collectionToDelete}`;
  },
};

export default command;
