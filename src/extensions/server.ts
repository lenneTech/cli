import * as crypto from 'crypto';
import { GluegunFilesystem } from 'gluegun';
import { PromptOptions } from 'gluegun/build/types/toolbox/prompt-enquirer-types';
import { GluegunAskResponse, GluegunEnquirer } from 'gluegun/build/types/toolbox/prompt-types';
import { join } from 'path';
import * as ts from 'typescript';

import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';
import { ServerProps } from '../interfaces/ServerProps.interface';

type GluegunPromptAsk = <T = GluegunAskResponse>(questions: (((this: GluegunEnquirer) => PromptOptions) | PromptOptions)[] | ((this: GluegunEnquirer) => PromptOptions) | PromptOptions) => Promise<T>;
type GluegunPromptConfirm = (message: string, initial?: boolean) => Promise<boolean>;

/**
 * Server helper functions
 */
export class Server {
  // String manipulation functions
  camelCase: (value: string) => string;
  kebabCase: (value: string) => string;
  pascalCase: (value: string) => string;

  // Gluegun functions
  ask: GluegunPromptAsk;
  confirm: GluegunPromptConfirm;
  filesystem: GluegunFilesystem;
  info: (message: string) => void;

  // Specific imports for default modells
  imports: Record<string, string> = {
    'CoreFileInfo': 'import { CoreFileInfo } from \'@lenne.tech/nest-server\';',
    'FileUpload': 'import type { FileUpload } from \'graphql-upload/processRequest.js\';',
    'GraphQLUpload': 'import * as GraphQLUpload from \'graphql-upload/GraphQLUpload.js\';',
    'Record<string, unknown>': 'import { JSON } from \'@lenne.tech/nest-server\';',
  };

  // Specific types for properties in input fields
  inputFieldTypes: Record<string, string> = {
    Boolean: 'Boolean',
    Date: 'Date',
    File: 'GraphQLUpload',
    FileInfo: 'GraphQLUpload',
    ID: 'String',
    Id: 'String',
    JSON: 'JSON',
    Json: 'JSON',
    Number: 'Number',
    ObjectId: 'String',
    String: 'String',
    Upload: 'GraphQLUpload',
  };

  // Specific types for properties in input classes
  inputClassTypes: Record<string, string> = {
    Boolean: 'boolean',
    Date: 'Date',
    File: 'FileUpload',
    FileInfo: 'FileUpload',
    ID: 'string',
    Id: 'string',
    JSON: 'Record<string, unknown>',
    Json: 'Record<string, unknown>',
    Number: 'number',
    ObjectId: 'string',
    String: 'string',
    Upload: 'FileUpload',
  };

  // Specific types for properties in model fields
  modelFieldTypes: Record<string, string> = {
    Boolean: 'Boolean',
    Date: 'Date',
    File: 'CoreFileInfo',
    FileInfo: 'CoreFileInfo',
    ID: 'String',
    Id: 'String',
    JSON: 'JSON',
    Json: 'JSON',
    Number: 'Number',
    ObjectId: 'String',
    String: 'String',
    Upload: 'CoreFileInfo',
  };

  // Specific types for properties in model class
  modelClassTypes: Record<string, string> = {
    Boolean: 'boolean',
    Date: 'Date',
    File: 'CoreFileInfo',
    FileInfo: 'CoreFileInfo',
    ID: 'string',
    Id: 'string',
    JSON: 'Record<string, unknown>',
    Json: 'Record<string, unknown>',
    Number: 'number',
    ObjectId: 'string',
    String: 'string',
    Upload: 'CoreFileInfo',
  };

  // Additional string for ID properties
  propertySuffixTypes: Record<string, string> = {
    ID: 'Id',
    Id: 'Id',
    ObjectId: 'Id',
  };

  // Standard types: primitives and default JavaScript classes
  standardTypes: string[] = ['boolean', 'string', 'number', 'Date'];

  /**
   * Constructor for integration of toolbox
   */
  constructor(protected toolbox: ExtendedGluegunToolbox) {
    this.ask = toolbox.prompt.ask;
    this.camelCase = toolbox.strings.camelCase;
    this.confirm = toolbox.prompt.confirm;
    this.filesystem = toolbox.filesystem;
    this.kebabCase = toolbox.strings.kebabCase;
    this.pascalCase = toolbox.strings.pascalCase;
    this.info = toolbox.print.info;
  }

  /**
   * Add properties to model
   */
  async addProperties(options?: {
    objectsToAdd?: { object: string; property: string }[];
    referencesToAdd?: { property: string; reference: string }[];
  }): Promise<{
    objectsToAdd: { object: string; property: string }[];
    props: Record<string, ServerProps>;
    referencesToAdd: { property: string; reference: string }[];
    refsSet: boolean;
    schemaSet: boolean;
  }> {
    const { objectsToAdd, referencesToAdd } = { objectsToAdd: [], referencesToAdd: [], ...options };

    // Set props
    const props: Record<string, ServerProps> = {};
    const setProps = true;
    let refsSet = false;
    let schemaSet = false;
    while (setProps) {
      const name = (
        await this.ask({
          message: 'Enter property name (e.g. myProperty) of the property or leave empty (ENTER)',
          name: 'input',
          type: 'input',
        })
      ).input;
      if (!name.trim()) {
        break;
      }

      let type = (
        await this.ask([
          {
            choices: ['boolean', 'string', 'number', 'ObjectId / Reference', 'Date', 'enum', 'SubObject', 'Use own', 'JSON / any'],
            message: 'Choose property type',
            name: 'input',
            type: 'select',
          },
        ])
      ).input;
      if (type === 'ObjectId / Reference') {
        type = 'ObjectId';
      } else if (type === 'JSON / any') {
        type = 'JSON';
      }

      let schema: string;
      if (type === 'SubObject') {
        type = (
          await this.ask({
            initial: this.pascalCase(name),
            message: 'Enter property type (e.g. MyClass)',
            name: 'input',
            type: 'input',
          })
        ).input;
        schema = type;
        schemaSet = true;
        if (type) {
          refsSet = true;
        }

        if (type?.trim()) {
          let createObjAfter: boolean = false;
          const cwd = this.filesystem.cwd();
          const path = cwd.substr(0, cwd.lastIndexOf('src'));
          const objectsDir = join(path, 'src', 'server', 'common', 'objects', this.kebabCase(type));
          if (!this.filesystem.exists(objectsDir)) {
            createObjAfter = await this.confirm('Create this Object after all the other Properties?', true);
          }

          if (createObjAfter && !objectsToAdd.find(obj => obj.object === this.kebabCase(type))) {
            objectsToAdd.push({ object: this.kebabCase(type), property: name });
          }
        }
      }

      let reference: string;
      let enumRef: string;
      if (type === 'ObjectId') {
        reference = (
          await this.ask({
            initial: this.pascalCase(name),
            message: 'Enter reference for ObjectId',
            name: 'input',
            type: 'input',
          })
        ).input;
        if (reference) {
          refsSet = true;
        }

        if (reference?.trim()) {
          let createRefAfter: boolean = false;
          const cwd = this.filesystem.cwd();
          const path = cwd.substr(0, cwd.lastIndexOf('src'));
          const moduleDir = join(path, 'src', 'server', 'modules', this.kebabCase(reference));
          if (!this.filesystem.exists(moduleDir)) {
            createRefAfter = await this.confirm('Create this Module after all the other Properties?', true);
          }

          if (createRefAfter && !referencesToAdd.find(ref => ref.reference === this.kebabCase(reference))) {
            referencesToAdd.push({ property: name, reference: this.kebabCase(reference) });
          }
        }
      } else if (type === 'enum') {
        enumRef = (
          await this.ask({
            initial: `${this.pascalCase(name)}Enum`,
            message: 'Enter enum type',
            name: 'input',
            type: 'input',
          })
        ).input;
        if (enumRef) {
          refsSet = true;
        }
      }

      const arrayEnding = type.endsWith('[]');
      type = type.replace('[]', '');
      const isArray = arrayEnding || (await this.confirm('Array?'));

      const nullable = await this.confirm('Nullable?', true);

      props[name] = { enumRef, isArray, name, nullable, reference, schema, type };
    }
    return { objectsToAdd, props, referencesToAdd, refsSet, schemaSet };
  }

  useDefineForClassFieldsActivated(): boolean {
    const tsConfigPath = this.filesystem.resolve('tsconfig.json');
    if (tsConfigPath) {
      const readConfig = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
      if (!readConfig.error) {
        const tsConfig = readConfig.config;
        if (tsConfig?.compilerOptions?.useDefineForClassFields) {
          return tsConfig.compilerOptions.useDefineForClassFields;
        }
      }
    }
    return false;
  }

  /**
   * Determine GraphQL Field type for UnifiedField decorator
   * Used for Model, Input, and CreateInput
   */
  getInputFieldType(item: ServerProps, options?: { create?: boolean }): string {
    const { create } = { create: false, ...options };
    const reference = item.reference?.trim() ? this.pascalCase(item.reference.trim()) : '';
    const schema = item.schema?.trim() ? this.pascalCase(item.schema.trim()) : '';
    const enumRef = item.enumRef?.trim() ? this.pascalCase(item.enumRef.trim()) : '';

    if (schema) {
      // SubObject → Schema + Input/CreateInput suffix
      return schema + (create ? 'CreateInput' : 'Input');
    } else if (reference) {
      // ObjectId/Reference → always String for IDs
      return 'String';
    } else if (enumRef) {
      // Enum → use enum name
      return enumRef;
    } else {
      // Standard types or custom types
      let fieldType = this.inputFieldTypes[this.pascalCase(item.type)]
        || this.pascalCase(item.type) + (create ? 'CreateInput' : 'Input');
      fieldType = this.modelFieldTypes[item.type]
        ? this.modelFieldTypes[item.type]
        : fieldType;
      return fieldType;
    }
  }

  /**
   * Determine TypeScript property type for Input/CreateInput classes
   */
  getInputClassType(item: ServerProps, options?: { create?: boolean }): string {
    const { create } = { create: false, ...options };
    const reference = item.reference?.trim() ? this.pascalCase(item.reference.trim()) : '';
    const schema = item.schema?.trim() ? this.pascalCase(item.schema.trim()) : '';
    const enumRef = item.enumRef?.trim() ? this.pascalCase(item.enumRef.trim()) : '';

    if (schema) {
      // SubObject → Schema + Input/CreateInput suffix
      return schema + (create ? 'CreateInput' : 'Input');
    } else if (reference) {
      // ObjectId/Reference → string for IDs
      return 'string';
    } else if (enumRef) {
      // Enum → use enum name
      return enumRef;
    } else {
      // Standard types or custom types
      return this.inputClassTypes[this.pascalCase(item.type)]
        || (this.standardTypes.includes(item.type)
          ? item.type
          : this.pascalCase(item.type) + (create ? 'CreateInput' : 'Input'));
    }
  }

  /**
   * Determine GraphQL Field type for UnifiedField decorator in Model
   */
  getModelFieldType(item: ServerProps): string {
    const reference = item.reference?.trim() ? this.pascalCase(item.reference.trim()) : '';
    const schema = item.schema?.trim() ? this.pascalCase(item.schema.trim()) : '';
    const enumRef = item.enumRef?.trim() ? this.pascalCase(item.enumRef.trim()) : '';

    if (reference) {
      return reference;
    } else if (schema) {
      return schema;
    } else if (enumRef) {
      return enumRef;
    } else {
      return this.modelFieldTypes[this.pascalCase(item.type)] || this.pascalCase(item.type);
    }
  }

  /**
   * Determine TypeScript property type for Model class
   */
  getModelClassType(item: ServerProps): string {
    const reference = item.reference?.trim() ? this.pascalCase(item.reference.trim()) : '';
    const schema = item.schema?.trim() ? this.pascalCase(item.schema.trim()) : '';
    const enumRef = item.enumRef?.trim() ? this.pascalCase(item.enumRef.trim()) : '';

    if (reference) {
      return reference;
    } else if (schema) {
      return schema;
    } else if (enumRef) {
      return enumRef;
    } else {
      return this.modelClassTypes[this.pascalCase(item.type)]
        || (this.standardTypes.includes(item.type) ? item.type : this.pascalCase(item.type));
    }
  }

  /**
   * Generate enum configuration for UnifiedField decorator
   */
  getEnumConfig(item: ServerProps): string {
    const enumRef = item.enumRef?.trim() ? this.pascalCase(item.enumRef.trim()) : '';
    if (!enumRef) {
      return '';
    }

    return item.isArray
      ? `enum: { enum: ${enumRef}, options: { each: true } },\n    `
      : `enum: { enum: ${enumRef} },\n    `;
  }

  /**
   * Generate type configuration for UnifiedField decorator
   */
  getTypeConfig(fieldType: string, isArray: boolean): string {
    // Type is always needed for all properties
    return `type: () => ${isArray ? '[' : ''}${fieldType}${isArray ? ']' : ''}`;
  }

  /**
   * Create template string for properties in model
   */
  propsForModel(
    props: Record<string, ServerProps>,
    options?: { modelName?: string; useDefault?: boolean },
  ): { imports: string; mappings: string; props: string } {
    // Preparations
    const config = { useDefault: true, ...options };
    const { modelName, useDefault } = config;
    // Only use = undefined when useDefineForClassFieldsActivated is false or override/declare keyword is set
    const undefinedString = this.useDefineForClassFieldsActivated() ? ';' : ' = undefined;';
    let result = '';

    // Check parameters
    if (!props || !(typeof props !== 'object') || !Object.keys(props).length) {
      if (!useDefault) {
        return { imports: '', mappings: 'this;', props: '' };
      }

      // Use default
      if (!Object.keys(props).length && useDefault) {
        return {
          imports: '',
          mappings: 'mapClasses(input, {user: User}, this);',
          props: `
  /**
   * Description of properties
   */
  @Restricted(RoleEnum.ADMIN, RoleEnum.S_CREATOR)
  @Field(() => [String], { description: 'Properties of ${this.pascalCase(modelName)}', nullable: 'items'})
  @UnifiedField({
    description: 'Properties of ${this.pascalCase(modelName)}',
    isOptional: false,
    mongoose: [String],
    roles: RoleEnum.S_EVERYONE,
    type: () => [String],
  })
  properties: string[]${undefinedString}

  /**
   * User who has tested the ${this.pascalCase(modelName)}
   */
  @UnifiedField({
    description: 'User who has tested the ${this.pascalCase(modelName)}',
    isOptional: true,
    mongoose: { type: Schema.Types.ObjectId, ref: 'User' },
    roles: RoleEnum.S_EVERYONE,
    type: () => User,
  })
  testedBy: User${undefinedString}
  `,
        };
      }
    }

    // Process configuration
    const imports = {};
    const mappings = {};
    for (const [name, item] of Object.entries<ServerProps>(props)) {
      const propName = this.camelCase(name);
      const reference = item.reference?.trim() ? this.pascalCase(item.reference.trim()) : '';
      const schema = item.schema?.trim() ? this.pascalCase(item.schema.trim()) : '';
      const enumRef = item.enumRef?.trim() ? this.pascalCase(item.enumRef.trim()) : '';

      // Use utility functions to determine types
      const modelFieldType = this.getModelFieldType(item);
      const modelClassType = this.getModelClassType(item);
      const isArray = item.isArray;

      const type = this.standardTypes.includes(item.type) ? item.type : this.pascalCase(item.type);
      if (!this.standardTypes.includes(type) && type !== 'ObjectId' && type !== 'Enum' && type !== 'Json') {
        mappings[propName] = type;
      }
      if (reference) {
        mappings[propName] = reference;
      }
      if (schema) {
        mappings[propName] = schema;
      }
      if (this.imports[modelClassType]) {
        imports[modelClassType] = this.imports[modelClassType];
      }

      // Use utility functions for enum and type config
      const enumConfig = this.getEnumConfig(item);
      const typeConfig = this.getTypeConfig(modelFieldType, isArray);

      // Build mongoose configuration
      const mongooseConfig = reference
        ? `${isArray ? '[' : ''}{ ref: '${reference}', type: Schema.Types.ObjectId }${isArray ? ']' : ''}`
        : schema
          ? `${isArray ? '[' : ''}{ type: ${schema}Schema }${isArray ? ']' : ''}`
          : enumRef
            ? `${isArray ? '[' : ''}{ enum: ${item.nullable ? `Object.values(${enumRef}).concat([null])` : enumRef}, type: String }${isArray ? ']' : ''}`
            : type === 'Json'
              ? `${isArray ? '[' : ''}{ type: Object }${isArray ? ']' : ''}`
              : 'true';

      result += `
  /**
   * ${this.pascalCase(propName) + (modelName ? ` of ${this.pascalCase(modelName)}` : '')}
   */
  @UnifiedField({
    description: '${this.pascalCase(propName) + (modelName ? ` of ${this.pascalCase(modelName)}` : '')}',
    ${enumConfig}isOptional: ${item.nullable},
    mongoose: ${mongooseConfig},
    roles: RoleEnum.S_EVERYONE,
    ${typeConfig}
  })
  ${propName}: ${(reference ? reference : schema ? schema : enumRef || modelClassType) + (isArray ? '[]' : '')}${undefinedString}
  `;
    }

    // Process imports
    let importsResult = '';
    for (const value of Object.values(imports)) {
      importsResult += `\n${value}`;
    }

    // Process mappings
    const mappingsResult = [];
    for (const [key, value] of Object.entries(mappings)) {
      mappingsResult.push(`${key}: ${value}`);
    }

    // Return template data
    return {
      imports: importsResult,
      mappings: mappingsResult.length ? `mapClasses(input, { ${mappingsResult.join(', ')} }, this);` : 'this;',
      props: result,
    };
  }

  /**
   * Create template string for properties in input
   */
  propsForInput(
    props: Record<string, ServerProps>,
    options?: { create?: boolean; modelName?: string; nullable?: boolean },
  ): { imports: string; props: string } {
    // Preparations
    const config = { useDefault: true, ...options };
    const { create, modelName, nullable, useDefault } = config;
    // Only use = undefined when useDefineForClassFieldsActivated is false or override keyword is set
    const undefinedString = this.useDefineForClassFieldsActivated() ? ';' : ' = undefined;';
    let result = '';

    // Check parameters
    if (!props || !(typeof props !== 'object') || !Object.keys(props).length) {
      if (!useDefault) {
        return { imports: '', props: '' };
      }

      // Use default
      if (!Object.keys(props).length && useDefault) {
        return {
          imports: '',
          props: `
  /**
   * Description of properties
   */
  @Restricted(RoleEnum.ADMIN, RoleEnum.S_CREATOR)
  @Field(() => [String], { description: 'Properties of ${this.pascalCase(modelName)}', nullable: ${
            config.nullable ? config.nullable : '\'items\''
          }})
  properties: string[]${undefinedString}

  /**
   * User who has tested the ${this.pascalCase(modelName)}
   */
  @UnifiedField({
    description: 'User who has tested the ${this.pascalCase(modelName)}',
    isOptional: ${config.nullable},
  })
  testedBy: User${undefinedString}
  `,
        };
      }

      // Process configuration
      const imports = {};
      for (const [name, item] of Object.entries<ServerProps>(props)) {
        // Skip optional properties in CreateInput (they are inherited from Input)
        if (create && item.nullable) {
          continue;
        }

        // Use utility functions to determine types
        const inputFieldType = this.getInputFieldType(item, { create });
        const inputClassType = this.getInputClassType(item, { create });
        const propertySuffix = this.propertySuffixTypes[this.pascalCase(item.type)] || '';

        // Use override (not declare) for decorator properties when useDefineForClassFieldsActivated is true
        const overrideString = this.useDefineForClassFieldsActivated() ? 'override ' : '';
        const overrideFlag = create ? overrideString : '';
        // When override is set, always use = undefined
        const propertyUndefinedString = overrideFlag ? ' = undefined;' : undefinedString;

        if (this.imports[inputFieldType]) {
          imports[inputFieldType] = this.imports[inputFieldType];
        }
        if (this.imports[inputClassType]) {
          imports[inputClassType] = this.imports[inputClassType];
        }

        // Use utility functions for enum and type config
        const enumConfig = this.getEnumConfig(item);
        const typeConfig = this.getTypeConfig(inputFieldType, item.isArray);

        result += `
  /**
   * ${this.pascalCase(name) + propertySuffix + (modelName ? ` of ${this.pascalCase(modelName)}` : '')}
   */
  @UnifiedField({
    description: '${this.pascalCase(name) + propertySuffix + (modelName ? ` of ${this.pascalCase(modelName)}` : '')}',
    ${enumConfig}isOptional: ${nullable || item.nullable},
    roles: RoleEnum.S_EVERYONE,
    ${typeConfig}
  })
  ${overrideFlag + this.camelCase(name)}${nullable || item.nullable ? '?' : ''}: ${inputClassType}${item.isArray ? '[]' : ''}${propertyUndefinedString}
  `;
      }

      // Process imports
      let importsResult = '';
      for (const value of Object.values(imports)) {
        importsResult += `\n${value}`;
      }

      // Return template data
      return {
        imports: importsResult,
        props: result,
      };
    }
  }

  /**
   * Replace secret or private keys in string (e.g. for config files)
   */
  replaceSecretOrPrivateKeys(configContent: string): string {
    // Match all occurrences of SECRET_OR_PRIVATE_KEY with optional suffix (e.g., _CI, _DEV_REFRESH)
    // This regex matches the pattern within quotes: 'SECRET_OR_PRIVATE_KEY...'
    const regex = /'SECRET_OR_PRIVATE_KEY[^']*'/g;

    const matches = configContent.match(regex);

    if (!matches || matches.length === 0) {
      return configContent;
    }

    // Create a map to store unique secrets for each unique placeholder
    const secretMap = new Map<string, string>();

    return configContent.replace(regex, (match) => {
      // Remove quotes to get the placeholder
      const placeholder = match.slice(1, -1);

      // If we haven't generated a secret for this placeholder yet, create one
      if (!secretMap.has(placeholder)) {
        secretMap.set(placeholder, crypto.randomBytes(512).toString('base64'));
      }

      // Return the secret with quotes
      return `'${secretMap.get(placeholder)}'`;
    });
  }

}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.server = new Server(toolbox);
};
