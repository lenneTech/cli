import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

interface QdrantCollection {
  name: string;
}

interface QdrantCollectionInfo {
  disk_size: number;
  points_count: number;
  ram_size: number;
  segments_count: number;
  vectors_count: number;
}

interface QdrantCollectionInfoResponse {
  result?: QdrantCollectionInfo;
}

interface QdrantCollectionsResponse {
  result?: {
    collections: QdrantCollection[];
  };
}

const command: GluegunCommand = {
  alias: ['s'],
  description: 'Show collection statistics',
  name: 'stats',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const { http, print } = toolbox;

    const qdrantApi = http.create({
      baseURL: 'http://localhost:6333',
      headers: { 'Content-Type': 'application/json' },
    });

    const spinner = print.spin('Fetching Qdrant statistics...');

    // 1. Fetch all collections
    const collectionsResponse = await qdrantApi.get<QdrantCollectionsResponse>(
      '/collections',
    );

    if (!collectionsResponse.ok) {
      spinner.fail('Error fetching collections from Qdrant.');
      print.info('Please ensure Qdrant is running on http://localhost:6333');
      return;
    }

    const collections = collectionsResponse.data?.result?.collections;
    if (!collections || collections.length === 0) {
      spinner.succeed('No collections found in Qdrant.');
      return;
    }

    spinner.succeed('Fetched collection statistics:');

    const tableData = [
      [
        'Collection',
        'Points',
        'Vectors',
        'Segments',
        'RAM Size (MB)',
        'Disk Size (MB)',
      ],
    ];

    for (const collection of collections) {
      const infoResponse
        = await qdrantApi.get<QdrantCollectionInfoResponse>(
          `/collections/${collection.name}`,
        );

      if (infoResponse.ok && infoResponse.data?.result) {
        const result = infoResponse.data.result;
        tableData.push([
          collection.name,
          result.points_count.toString(),
          result.vectors_count?.toString(),
          result.segments_count?.toString(),
          (result.ram_size / 1024 / 1024).toFixed(2),
          (result.disk_size / 1024 / 1024).toFixed(2),
        ]);
      } else {
        tableData.push([collection.name, 'Error', 'Error', 'Error', 'Error', 'Error']);
      }
    }

    print.table(tableData, {
      format: 'lean',
    });

    if (!toolbox.parameters.options.fromGluegunMenu) {
      process.exit();
    }

    // For tests
    return 'qdrant stats';
  },
};

export default command;
