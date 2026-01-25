import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

export interface ParsedPropsResult {
  objectsToAdd: { object: string; property: string }[];
  props: Record<string, any>;
  referencesToAdd: { property: string; reference: string }[];
  refsSet: boolean;
  schemaSet: boolean;
}

/**
 * Extend toolbox with parseProperties() helper.
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.parseProperties = async (
    options?: {
      argProps?: string[];
      objectsToAdd?: { object: string; property: string }[];
      parameters?: typeof toolbox.parameters;
      referencesToAdd?: { property: string; reference: string }[];
      server?: typeof toolbox.server;
    },
  ): Promise<ParsedPropsResult> => {
    const { parameters: globalParameters, server: globalServer } = toolbox;
    const {
      argProps = Object.keys(globalParameters.options || {}).filter(key => key.startsWith('prop')),
      objectsToAdd = [],
      parameters = globalParameters,
      referencesToAdd = [],
      server = globalServer,
    } = options || {};
    // --- CLI Mode ---
    if (argProps.length > 0) {
      const { print } = toolbox;

      // Count how many prop-name flags exist
      const propNameFlags = argProps.filter(key => key.startsWith('prop-name'));
      const hasMultipleProps = propNameFlags.length > 1;

      // If multiple properties, all must have numeric indices
      if (hasMultipleProps) {
        const hasNonIndexed = propNameFlags.some(key => !key.match(/^prop-name-\d+$/));
        if (hasNonIndexed) {
          print.error('When adding multiple properties, all must use numeric indices (e.g., --prop-name-0, --prop-name-1)');
          print.info('');
          print.info('Example:');
          print.info('  lt server addProp --type Module --element User \\');
          print.info('    --prop-name-0 email --prop-type-0 string \\');
          print.info('    --prop-name-1 age --prop-type-1 number');
          throw new Error('Invalid property flags: Multiple properties require numeric indices');
        }
      }

      // Extract index from prop key (e.g., 'prop-name-1' -> 1)
      const extractIndex = (key: string, prefix: string): number => {
        const match = key.match(new RegExp(`^${prefix}-(\\d+)$`));
        return match ? parseInt(match[1], 10) : -1;
      };

      // Build a map of index -> property data
      const propDataByIndex = new Map<number, any>();

      for (const key of argProps) {
        let index = -1;
        let field = '';

        if (key.startsWith('prop-name-')) {
          index = extractIndex(key, 'prop-name');
          field = 'name';
        } else if (key.startsWith('prop-type-')) {
          index = extractIndex(key, 'prop-type');
          field = 'type';
        } else if (key.startsWith('prop-nullable-')) {
          index = extractIndex(key, 'prop-nullable');
          field = 'nullable';
        } else if (key.startsWith('prop-array-')) {
          index = extractIndex(key, 'prop-array');
          field = 'isArray';
        } else if (key.startsWith('prop-enum-')) {
          index = extractIndex(key, 'prop-enum');
          field = 'enumRef';
        } else if (key.startsWith('prop-schema-')) {
          index = extractIndex(key, 'prop-schema');
          field = 'schema';
        } else if (key.startsWith('prop-reference-')) {
          index = extractIndex(key, 'prop-reference');
          field = 'reference';
        }

        if (index >= 0 && field) {
          if (!propDataByIndex.has(index)) {
            propDataByIndex.set(index, {
              enumRef: null,
              isArray: false,
              name: '',
              nullable: false,
              reference: null,
              schema: null,
              type: 'string',
            });
          }

          const propData = propDataByIndex.get(index);
          const value = parameters.options[key];

          if (field === 'nullable' || field === 'isArray') {
            // Accept both string 'true' and boolean true
            propData[field] = value === 'true' || value === true;
          } else {
            propData[field] = value;
          }
        }
      }

      // Convert map to props object
      const props: Record<string, any> = {};
      for (const propData of propDataByIndex.values()) {
        if (!propData.name) {
          continue;
        }
        props[propData.name] = propData;
      }

      return { objectsToAdd, props, referencesToAdd, refsSet: false, schemaSet: false };
    }

    // --- Interactive Mode ---
    const result = await server.addProperties({ objectsToAdd, referencesToAdd });
    return {
      objectsToAdd: result.objectsToAdd,
      props: result.props,
      referencesToAdd: result.referencesToAdd,
      refsSet: result.refsSet,
      schemaSet: result.schemaSet,
    };
  };
};
