import * as crypto from 'crypto';
import { GluegunFilesystem } from 'gluegun';
import { PromptOptions } from 'gluegun/build/types/toolbox/prompt-enquirer-types';
import { GluegunAskResponse, GluegunEnquirer } from 'gluegun/build/types/toolbox/prompt-types';
import { join } from 'path';
import * as ts from 'typescript';

import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';
import { ServerProps } from '../interfaces/ServerProps.interface';

type GluegunPromptAsk = <T = GluegunAskResponse>(
  questions:
    | (((this: GluegunEnquirer) => PromptOptions) | PromptOptions)[]
    | ((this: GluegunEnquirer) => PromptOptions)
    | PromptOptions,
) => Promise<T>;
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
    CoreFileInfo: "import { CoreFileInfo } from '@lenne.tech/nest-server';",
    FileUpload: "import type { FileUpload } from 'graphql-upload/processRequest.js';",
    GraphQLUpload: "import * as GraphQLUpload from 'graphql-upload/GraphQLUpload.js';",
    'Record<string, unknown>': "import { JSON } from '@lenne.tech/nest-server';",
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
            choices: [
              'boolean',
              'string',
              'number',
              'ObjectId / Reference',
              'Date',
              'enum',
              'SubObject',
              'Use own',
              'JSON / any',
            ],
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

          if (createObjAfter && !objectsToAdd.find((obj) => obj.object === this.kebabCase(type))) {
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

          if (createRefAfter && !referencesToAdd.find((ref) => ref.reference === this.kebabCase(reference))) {
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
    // Walk UP from the current working directory to find the nearest
    // tsconfig.json. gluegun's `filesystem.resolve('tsconfig.json')` resolves
    // relative to cwd without checking existence, so it breaks when `lt
    // server module` is invoked from inside `src/` (where no tsconfig lives)
    // — it would then silently return `false`, causing the generator to
    // emit class fields without the `override` modifier that the project's
    // `noImplicitOverride` rule requires.
    const path = require('path');
    let current = this.filesystem.cwd();
    const root = path.parse(current).root;
    let tsConfigPath: null | string = null;
    while (current && current !== root) {
      const candidate = path.join(current, 'tsconfig.json');
      if (this.filesystem.exists(candidate)) {
        tsConfigPath = candidate;
        break;
      }
      current = path.dirname(current);
    }
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
      let fieldType =
        this.inputFieldTypes[this.pascalCase(item.type)] ||
        this.pascalCase(item.type) + (create ? 'CreateInput' : 'Input');
      fieldType = this.modelFieldTypes[item.type] ? this.modelFieldTypes[item.type] : fieldType;
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
      return (
        this.inputClassTypes[this.pascalCase(item.type)] ||
        (this.standardTypes.includes(item.type)
          ? item.type
          : this.pascalCase(item.type) + (create ? 'CreateInput' : 'Input'))
      );
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
      return (
        this.modelClassTypes[this.pascalCase(item.type)] ||
        (this.standardTypes.includes(item.type) ? item.type : this.pascalCase(item.type))
      );
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
      // For enums, only use enum property (not type property)
      const enumConfig = this.getEnumConfig(item);
      const typeConfig = enumConfig ? '' : this.getTypeConfig(modelFieldType, isArray);

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
    roles: RoleEnum.S_EVERYONE,${
      typeConfig
        ? `
    ${typeConfig}`
        : ''
    }
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
    config.nullable ? config.nullable : "'items'"
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
        // For enums, only use enum property (not type property)
        const enumConfig = this.getEnumConfig(item);
        const typeConfig = enumConfig ? '' : this.getTypeConfig(inputFieldType, item.isArray);

        result += `
  /**
   * ${this.pascalCase(name) + propertySuffix + (modelName ? ` of ${this.pascalCase(modelName)}` : '')}
   */
  @UnifiedField({
    description: '${this.pascalCase(name) + propertySuffix + (modelName ? ` of ${this.pascalCase(modelName)}` : '')}',
    ${enumConfig}isOptional: ${nullable || item.nullable},
    roles: RoleEnum.S_EVERYONE,${
      typeConfig
        ? `
    ${typeConfig}`
        : ''
    }
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
   * Setup a new server project
   * Handles template setup and file patching (config.env.ts, package.json, main.ts, meta.json)
   *
   * @param dest - Destination directory path
   * @param options - Setup options
   * @returns Setup result with success status
   */
  async setupServer(
    dest: string,
    options: {
      apiMode?: 'Both' | 'GraphQL' | 'Rest';
      author?: string;
      branch?: string;
      copyPath?: string;
      description?: string;
      linkPath?: string;
      name: string;
      projectDir: string;
      skipInstall?: boolean;
      skipPatching?: boolean;
    },
  ): Promise<{ method: 'clone' | 'copy' | 'link'; path: string; success: boolean }> {
    const { apiMode: apiModeHelper, patching, system, template, templateHelper } = this.toolbox;
    const {
      apiMode,
      author = '',
      branch,
      copyPath,
      description = '',
      linkPath,
      name,
      projectDir,
      skipInstall = false,
      skipPatching = false,
    } = options;

    // Setup template
    const result = await templateHelper.setup(dest, {
      branch,
      copyPath,
      linkPath,
      repoUrl: 'https://github.com/lenneTech/nest-server-starter.git',
    });

    if (!result.success) {
      return { method: result.method, path: result.path, success: false };
    }

    // Link mode: skip all post-processing
    if (result.method === 'link') {
      return { method: 'link', path: result.path, success: true };
    }

    // Apply patches (config.env.ts, package.json, main.ts, meta.json)
    if (!skipPatching) {
      try {
        // Generate README
        await template.generate({
          props: { description, name },
          target: `${dest}/README.md`,
          template: 'nest-server-starter/README.md.ejs',
        });

        // Replace secret or private keys and update database names via AST
        this.patchConfigEnvTs(`${dest}/src/config.env.ts`, projectDir);

        // Update Swagger configuration in main.ts
        await patching.update(`${dest}/src/main.ts`, (content: string) =>
          content
            .replace(/\.setTitle\('.*?'\)/, `.setTitle('${name}')`)
            .replace(/\.setDescription\('.*?'\)/, `.setDescription('${description || name}')`),
        );

        // Update package.json
        await patching.update(`${dest}/package.json`, (config: Record<string, unknown>) => {
          config.author = author;
          config.bugs = { url: '' };
          config.description = description || name;
          config.homepage = '';
          config.name = projectDir;
          config.repository = { type: 'git', url: '' };
          config.version = '0.0.1';
          return config;
        });

        // Update meta.json if exists
        if (this.filesystem.exists(`${dest}/src/meta`)) {
          await patching.update(`${dest}/src/meta`, (config: Record<string, unknown>) => {
            config.name = name;
            config.description = description;
            return config;
          });
        }
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }
    }

    // Clean up copied template artifacts (prevents install issues with stale node_modules)
    if (result.method === 'copy') {
      this.filesystem.remove(`${dest}/node_modules`);
      this.filesystem.remove(`${dest}/package-lock.json`);
      this.filesystem.remove(`${dest}/pnpm-lock.yaml`);
      this.filesystem.remove(`${dest}/yarn.lock`);
      this.filesystem.remove(`${dest}/.yalc`);
      this.filesystem.remove(`${dest}/yalc.lock`);
    }

    // Process API mode (before install so package.json is correct)
    if (apiMode) {
      try {
        await apiModeHelper.processApiMode(dest, apiMode);
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }
    }

    // Patch CLAUDE.md with API mode info
    this.patchClaudeMdApiMode(dest, apiMode);

    // Install packages
    if (!skipInstall) {
      try {
        const { pm } = this.toolbox;
        await system.run(`cd "${dest}" && ${pm.install(pm.detect(dest))}`);
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }
    }

    return { method: result.method, path: dest, success: true };
  }

  /**
   * Setup server for fullstack project (simplified version without package.json/main.ts patching)
   *
   * @param dest - Destination directory path
   * @param options - Setup options
   * @returns Setup result with success status
   */
  async setupServerForFullstack(
    dest: string,
    options: {
      apiMode?: 'Both' | 'GraphQL' | 'Rest';
      branch?: string;
      copyPath?: string;
      frameworkMode?: 'npm' | 'vendor';
      linkPath?: string;
      name: string;
      projectDir: string;
    },
  ): Promise<{ method: 'clone' | 'copy' | 'link'; path: string; success: boolean }> {
    const { apiMode: apiModeHelper, templateHelper } = this.toolbox;
    const { apiMode, branch, copyPath, frameworkMode = 'npm', linkPath, name, projectDir } = options;

    // Both npm and vendor mode clone nest-server-starter as the base. The
    // starter ships the minimal consumer conventions a project needs
    // (src/server/common/models/persistence.model.ts, src/server/modules/user/,
    // file/, meta/, tests/, migrations/, env files, etc.).
    //
    // In vendor mode we additionally clone @lenne.tech/nest-server to
    // obtain the framework `core/` tree, copy it into the project at
    // src/core/ (with the flatten-fix), remove the `@lenne.tech/nest-server`
    // npm dependency, merge its transitive deps into the project
    // package.json, and run a codemod that rewrites every
    // `from '@lenne.tech/nest-server'` import to a relative path pointing
    // at the vendored core.
    //
    // See convertCloneToVendored() below for the exact transformation.
    // Setup template
    const result = await templateHelper.setup(dest, {
      branch,
      copyPath,
      linkPath,
      repoUrl: 'https://github.com/lenneTech/nest-server-starter',
    });

    if (!result.success) {
      return { method: result.method, path: result.path, success: false };
    }

    // Link mode: skip all post-processing
    if (result.method === 'link') {
      return { method: 'link', path: result.path, success: true };
    }

    // Apply minimal patches for fullstack
    try {
      // Write meta.json
      this.filesystem.write(`${dest}/src/meta.json`, {
        description: `API for ${name} app`,
        name: `${name}-api-server`,
        version: '0.0.0',
      });

      // Replace secret or private keys and update database names via AST
      this.patchConfigEnvTs(`${dest}/src/config.env.ts`, projectDir);
    } catch (err) {
      return { method: result.method, path: dest, success: false };
    }

    // Clean up copied template artifacts
    if (result.method === 'copy') {
      this.filesystem.remove(`${dest}/node_modules`);
      this.filesystem.remove(`${dest}/package-lock.json`);
      this.filesystem.remove(`${dest}/pnpm-lock.yaml`);
      this.filesystem.remove(`${dest}/yarn.lock`);
      this.filesystem.remove(`${dest}/.yalc`);
      this.filesystem.remove(`${dest}/yalc.lock`);
    }

    // Vendor-mode transformation: strip framework-internal content and wire
    // the remaining files so they behave like a project that consumed the
    // framework's core/ directory directly. Idempotent; safe to skip in
    // npm mode.
    if (frameworkMode === 'vendor') {
      try {
        await this.convertCloneToVendored(dest, name);
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }
    }

    // Process API mode (before install which happens at monorepo level)
    if (apiMode) {
      try {
        await apiModeHelper.processApiMode(dest, apiMode);
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }
    }

    // In vendor mode the processApiMode step may strip GraphQL-related
    // packages that the `api-mode.manifest.json` declares as graphql-only
    // (e.g. graphql-subscriptions, graphql-upload, json-to-graphql-query).
    // That's correct in npm mode because the stripped modules are pruned
    // together; in vendor mode, however, the framework core at src/core/
    // still imports those packages at the top of core-auth.module.ts etc.
    // Restore them unconditionally after the api-mode pass.
    if (frameworkMode === 'vendor' && apiMode === 'Rest') {
      try {
        this.restoreVendorCoreEssentials(dest);
      } catch (err) {
        // Non-fatal — install may still succeed if the core never imports
        // the restored packages at the current version.
      }
    }

    // Patch CLAUDE.md with API mode info
    this.patchClaudeMdApiMode(dest, apiMode);

    return { method: result.method, path: dest, success: true };
  }

  /**
   * Converts a freshly cloned `nest-server-starter` working tree into a
   * vendored-mode consumer project.
   *
   * The starter ships all consumer conventions a project needs (a
   * working `src/server/` with `common/models/persistence.model.ts`,
   * `modules/user/`, `modules/file/`, `modules/meta/`, sample tests,
   * migrations, env files). In npm mode it relies on the
   * `@lenne.tech/nest-server` npm dependency to provide the framework
   * source via `node_modules/@lenne.tech/nest-server/dist/**`.
   *
   * In vendor mode we additionally clone `@lenne.tech/nest-server` to
   * /tmp, copy its framework kernel (`src/core/`, `src/index.ts`,
   * `src/core.module.ts`, `src/test/`, `src/templates/`, `src/types/`,
   * `LICENSE`, `bin/migrate.js`) into the project at `src/core/`
   * applying the flatten-fix, remove `@lenne.tech/nest-server` from the
   * project's `package.json`, merge the framework's transitive deps into
   * the project's own deps, and run an AST-based codemod that rewrites
   * every `from '@lenne.tech/nest-server'` import in consumer code
   * (src/server, src/main.ts, tests/, migrations/, scripts/) to a
   * relative path pointing at the vendored `src/core/`.
   *
   * The resulting tree matches the layout produced by the imo vendoring
   * pilot, so the `nest-server-core-updater` and
   * `nest-server-core-contributor` agents work without any further
   * post-processing.
   *
   * Idempotent — running twice is a no-op.
   */
  protected async convertCloneToVendored(dest: string, _projectName: string): Promise<void> {
    const filesystem = this.filesystem;
    const { system } = this.toolbox;
    const os = require('os');
    const path = require('path');
    const { Project, SyntaxKind } = require('ts-morph');

    const srcDir = `${dest}/src`;
    const coreDir = `${srcDir}/core`;

    // ── 1. Clone @lenne.tech/nest-server into a temp directory ───────────
    //
    // We clone the framework repo shallowly to get the `src/core/` tree,
    // `bin/migrate.js`, and associated meta files. The clone lives in a
    // throw-away tmp dir that gets cleaned up at the end.
    const tmpClone = path.join(os.tmpdir(), `lt-vendor-nest-server-${Date.now()}`);
    try {
      await system.run(`git clone --depth 1 https://github.com/lenneTech/nest-server.git ${tmpClone}`);
    } catch (err) {
      throw new Error(`Failed to clone @lenne.tech/nest-server: ${(err as Error).message}`);
    }

    // Snapshot upstream package.json before cleanup so we can merge its
    // transitive deps into the project's package.json (step 5 below).
    let upstreamDeps: Record<string, string> = {};
    let upstreamDevDeps: Record<string, string> = {};
    try {
      const upstreamPkg = filesystem.read(`${tmpClone}/package.json`, 'json') as Record<string, any>;
      if (upstreamPkg && typeof upstreamPkg === 'object') {
        upstreamDeps = (upstreamPkg.dependencies as Record<string, string>) || {};
        upstreamDevDeps = (upstreamPkg.devDependencies as Record<string, string>) || {};
      }
    } catch {
      // Best-effort — if we can't read upstream pkg, the starter's own
      // deps should still cover most of the framework's needs.
    }

    try {
      // ── 2. Copy framework kernel into project src/core/ (flatten-fix) ──
      //
      // Upstream layout: src/core/ (framework sub-dir) + src/index.ts +
      // src/core.module.ts + src/test/ + src/templates/ + src/types/.
      // Target layout: everything flat under <project>/src/core/.
      //
      // We WIPE the starter's (non-existent in npm mode) src/core/ first
      // just to guarantee idempotency when users run this twice.
      if (filesystem.exists(coreDir)) {
        filesystem.remove(coreDir);
      }

      const copies: [string, string][] = [
        [`${tmpClone}/src/core`, coreDir],
        [`${tmpClone}/src/index.ts`, `${coreDir}/index.ts`],
        [`${tmpClone}/src/core.module.ts`, `${coreDir}/core.module.ts`],
        [`${tmpClone}/src/test`, `${coreDir}/test`],
        [`${tmpClone}/src/templates`, `${coreDir}/templates`],
        [`${tmpClone}/src/types`, `${coreDir}/types`],
        [`${tmpClone}/LICENSE`, `${coreDir}/LICENSE`],
      ];
      for (const [from, to] of copies) {
        if (filesystem.exists(from)) {
          filesystem.copy(from, to);
        }
      }


      // Copy bin/migrate.js so the project has a working migrate CLI
      // independent of node_modules/@lenne.tech/nest-server.
      if (filesystem.exists(`${tmpClone}/bin/migrate.js`)) {
        filesystem.copy(`${tmpClone}/bin/migrate.js`, `${dest}/bin/migrate.js`);
      }

      // Copy migration-guides for vendor-sync agent reference (optional
      // but useful — small overhead, big value for the updater agent).
      if (filesystem.exists(`${tmpClone}/migration-guides`)) {
        filesystem.copy(`${tmpClone}/migration-guides`, `${dest}/migration-guides`);
      }
    } finally {
      // Always clean up the temp clone, even if copy fails midway.
      if (filesystem.exists(tmpClone)) {
        filesystem.remove(tmpClone);
      }
    }

    // ── 3. Apply flatten-fix rewrites on the vendored files ──────────────
    //
    // In `src/core/index.ts` and `src/core/core.module.ts` every relative
    // specifier that used to be `./core/…` (when the file lived on src/)
    // must now drop the `./core/` prefix. All OTHER internal imports
    // within common/, modules/, etc. stay identical because their
    // relative structure is preserved by the copy.
    //
    // Known edge cases from the imo pilot:
    //   - src/core/test/test.helper.ts references '../core/common/helpers/db.helper'
    //     which must become '../common/helpers/db.helper' after the flatten.
    //   - src/core/common/interfaces/core-persistence-model.interface.ts
    //     references '../../..' (three levels up to src/index.ts), which
    //     must become '../..' (two levels up to src/core/index.ts).
    const tsMorphProject = new Project({ skipAddingFilesFromTsConfig: true });

    const flattenTargets = [`${coreDir}/index.ts`, `${coreDir}/core.module.ts`];
    for (const target of flattenTargets) {
      if (!filesystem.exists(target)) continue;
      const sourceFile = tsMorphProject.addSourceFileAtPath(target);
      for (const decl of sourceFile.getImportDeclarations()) {
        const spec = decl.getModuleSpecifierValue();
        if (spec && spec.startsWith('./core/')) {
          decl.setModuleSpecifier(spec.replace(/^\.\/core\//, './'));
        }
      }
      for (const decl of sourceFile.getExportDeclarations()) {
        const spec = decl.getModuleSpecifierValue();
        if (spec && spec.startsWith('./core/')) {
          decl.setModuleSpecifier(spec.replace(/^\.\/core\//, './'));
        }
      }
      sourceFile.saveSync();
    }

    const testHelperPath = `${coreDir}/test/test.helper.ts`;
    if (filesystem.exists(testHelperPath)) {
      const sourceFile = tsMorphProject.addSourceFileAtPath(testHelperPath);
      for (const decl of sourceFile.getImportDeclarations()) {
        const spec = decl.getModuleSpecifierValue();
        if (spec && spec.startsWith('../core/')) {
          decl.setModuleSpecifier(spec.replace(/^\.\.\/core\//, '../'));
        }
      }
      sourceFile.saveSync();
    }

    const persistenceIfacePath = `${coreDir}/common/interfaces/core-persistence-model.interface.ts`;
    if (filesystem.exists(persistenceIfacePath)) {
      const sourceFile = tsMorphProject.addSourceFileAtPath(persistenceIfacePath);
      for (const decl of sourceFile.getImportDeclarations()) {
        const spec = decl.getModuleSpecifierValue();
        if (spec === '../../..') {
          decl.setModuleSpecifier('../..');
        }
      }
      sourceFile.saveSync();
    }

    // Edge: core-better-auth-user.mapper.ts uses `ScryptOptions` as a type
    // annotation without an explicit import. Upstream relies on older
    // @types/node versions where ScryptOptions was a global. With newer
    // @types/node (25+) it must be imported from 'crypto'. Add the import.
    const betterAuthMapperPath = `${coreDir}/modules/better-auth/core-better-auth-user.mapper.ts`;
    if (filesystem.exists(betterAuthMapperPath)) {
      const raw = filesystem.read(betterAuthMapperPath) || '';
      if (raw.includes('ScryptOptions') && !raw.includes('type ScryptOptions')) {
        // Replace the bare `randomBytes, scrypt` crypto import with one
        // that also pulls in the ScryptOptions type.
        const patched = raw.replace(
          /import\s+\{\s*randomBytes\s*,\s*scrypt\s*\}\s+from\s+['"]crypto['"]\s*;/,
          "import { randomBytes, scrypt, type ScryptOptions } from 'crypto';",
        );
        if (patched !== raw) {
          filesystem.write(betterAuthMapperPath, patched);
        }
      }
    }

    // ── 4. Rewrite consumer imports: '@lenne.tech/nest-server' → relative ─
    //
    // Every .ts file in the starter's src/server/, src/main.ts, tests/,
    // migrations/, scripts/, migrations-utils/ currently imports from
    // '@lenne.tech/nest-server'. After vendoring, these must use a
    // relative path to src/core whose depth depends on the file location.
    // We handle static imports, dynamic imports, and CJS require() calls.
    const codemodGlobs = [
      `${dest}/src/server/**/*.ts`,
      `${dest}/src/main.ts`,
      `${dest}/src/config.env.ts`,
      `${dest}/tests/**/*.ts`,
      `${dest}/migrations/**/*.ts`,
      `${dest}/migrations-utils/*.ts`,
      `${dest}/scripts/**/*.ts`,
    ];
    tsMorphProject.addSourceFilesAtPaths(codemodGlobs);
    for (const file of tsMorphProject.getSourceFiles()) {
      const filePath = file.getFilePath();
      // Skip files inside src/core/ — those are the framework itself.
      if (filePath.startsWith(coreDir)) continue;

      const fromDir = path.dirname(filePath);
      let relToCore = path.relative(fromDir, coreDir).split(path.sep).join('/');
      if (!relToCore.startsWith('.')) {
        relToCore = `./${  relToCore}`;
      }

      let touched = false;

      // Static import declarations
      for (const decl of file.getImportDeclarations()) {
        if (decl.getModuleSpecifierValue() === '@lenne.tech/nest-server') {
          decl.setModuleSpecifier(relToCore);
          touched = true;
        }
      }
      // Static export declarations (re-exports)
      for (const decl of file.getExportDeclarations()) {
        if (decl.getModuleSpecifierValue() === '@lenne.tech/nest-server') {
          decl.setModuleSpecifier(relToCore);
          touched = true;
        }
      }
      // Dynamic imports + CJS require('@lenne.tech/nest-server')
      file.forEachDescendant((node) => {
        if (node.getKind() !== SyntaxKind.CallExpression) return;
        const call = node as any;
        const expr = call.getExpression();
        const exprText = expr.getText();
        const args = call.getArguments();
        if (args.length === 0) return;
        const firstArg = args[0];
        if (firstArg.getKind() !== SyntaxKind.StringLiteral) return;
        if (firstArg.getLiteralText() !== '@lenne.tech/nest-server') return;

        if (exprText === 'require' || exprText === 'import' || expr.getKind() === SyntaxKind.ImportKeyword) {
          firstArg.replaceWithText(`'${relToCore}'`);
          touched = true;
        }
      });

      if (touched) {
        file.saveSync();
      }
    }

    // Also patch migrations-utils/*.js (CJS require) via raw string replace
    // because ts-morph doesn't load .js files in our Project instance.
    const migrationsUtilsDir = `${dest}/migrations-utils`;
    if (filesystem.exists(migrationsUtilsDir)) {
      const jsFiles = filesystem.find(migrationsUtilsDir, { matching: '*.js', recursive: false });
      for (const f of jsFiles || []) {
        try {
          const content = filesystem.read(f);
          if (content && content.includes('@lenne.tech/nest-server')) {
            // The migrate helper path is at core/modules/migrate/helpers/migration.helper
            // regardless of mode, so we replace the package root reference
            // with the relative path to the vendored core.
            const fromDir = path.dirname(f);
            let relToCore = path.relative(fromDir, coreDir).split(path.sep).join('/');
            if (!relToCore.startsWith('.')) {
              relToCore = `./${  relToCore}`;
            }
            const patched = content
              .replace(
                /require\(['"]@lenne\.tech\/nest-server['"]\)/g,
                `require('${relToCore}')`,
              )
              .replace(
                /require\(['"]@lenne\.tech\/nest-server\/dist\/([^'"]+)['"]\)/g,
                (_m: string, sub: string) => `require('${relToCore}/${sub}')`,
              );
            if (patched !== content) {
              filesystem.write(f, patched);
            }
          }
        } catch {
          // skip unreadable file
        }
      }
    }

    // ── 5. package.json: remove @lenne.tech/nest-server, add migrate/bin ─
    //
    // Delete the framework dep — it's no longer needed since src/core/
    // carries the code inline. Leave the starter's other deps alone (they
    // already cover everything `@lenne.tech/nest-server` pulled in
    // transitively because the starter pins them via pnpm overrides / direct
    // deps already; see nest-server-starter/package.json).
    const pkgPath = `${dest}/package.json`;
    if (filesystem.exists(pkgPath)) {
      const pkg = filesystem.read(pkgPath, 'json') as Record<string, any>;
      if (pkg && typeof pkg === 'object') {
        if (pkg.dependencies && typeof pkg.dependencies === 'object') {
          delete pkg.dependencies['@lenne.tech/nest-server'];
        }
        if (pkg.devDependencies && typeof pkg.devDependencies === 'object') {
          delete pkg.devDependencies['@lenne.tech/nest-server'];
        }

        // Merge the framework's transitive deps into the project's own deps.
        // The starter lists a minimal subset (express, mongoose, class-validator,
        // etc.) and previously relied on @lenne.tech/nest-server to pull in
        // all the other framework dependencies (@apollo/server, @nestjs/jwt,
        // @nestjs/passport, bcrypt, better-auth, ejs, @tus/server, etc.) as
        // transitive deps. After vendoring we lose that automatic transitivity,
        // so we must add those deps explicitly to the project package.json.
        // We only add deps that the project does NOT already have, to avoid
        // overriding starter-level version pins.
        if (!pkg.dependencies) pkg.dependencies = {};
        const deps = pkg.dependencies as Record<string, string>;
        for (const [depName, depVersion] of Object.entries(upstreamDeps)) {
          if (depName === '@lenne.tech/nest-server') continue;
          if (!(depName in deps)) {
            deps[depName] = depVersion;
          }
        }
        // Merge select devDependencies that are actually needed at compile
        // time in a consumer project (types packages). Avoid adding
        // framework-author-only tools (@compodoc, etc.).
        if (!pkg.devDependencies) pkg.devDependencies = {};
        const devDeps = pkg.devDependencies as Record<string, string>;
        const neededTypePackages = [
          '@types/bcrypt',
          '@types/compression',
          '@types/cookie-parser',
          '@types/ejs',
          '@types/express',
          '@types/lodash',
          '@types/multer',
          '@types/node',
          '@types/nodemailer',
          '@types/passport',
          '@types/passport-jwt',
          '@types/supertest',
        ];
        for (const typePkg of neededTypePackages) {
          if (upstreamDevDeps[typePkg] && !(typePkg in devDeps) && !(typePkg in deps)) {
            devDeps[typePkg] = upstreamDevDeps[typePkg];
          }
        }
        // `find-file-up` is a runtime dep of @lenne.tech/nest-server's
        // config loader; it's in upstream's devDeps but used at runtime.
        if (upstreamDevDeps['find-file-up'] && !deps['find-file-up']) {
          deps['find-file-up'] = upstreamDevDeps['find-file-up'];
        }

        // Add a script to run the local bin/migrate.js. The starter's
        // existing migrate:* scripts are already correct for npm mode; we
        // need them pointing at the local bin + local ts-compiler.
        if (pkg.scripts && typeof pkg.scripts === 'object') {
          const scripts = pkg.scripts as Record<string, string>;
          const migrateArgs =
            '--store ./migrations-utils/migrate.js --migrations-dir ./migrations --compiler ts:./migrations-utils/ts-compiler.js';
          scripts['migrate:create'] =
            `f() { node ./bin/migrate.js create "$1" --template-file ./src/core/modules/migrate/templates/migration-project.template.ts --migrations-dir ./migrations --compiler ts:./migrations-utils/ts-compiler.js; }; f`;
          scripts['migrate:up'] = `node ./bin/migrate.js up ${migrateArgs}`;
          scripts['migrate:down'] = `node ./bin/migrate.js down ${migrateArgs}`;
          scripts['migrate:list'] = `node ./bin/migrate.js list ${migrateArgs}`;
          scripts['migrate:develop:up'] = `NODE_ENV=develop node ./bin/migrate.js up ${migrateArgs}`;
          scripts['migrate:test:up'] = `NODE_ENV=test node ./bin/migrate.js up ${migrateArgs}`;
          scripts['migrate:preview:up'] = `NODE_ENV=preview node ./bin/migrate.js up ${migrateArgs}`;
          scripts['migrate:prod:up'] = `NODE_ENV=production node ./bin/migrate.js up ${migrateArgs}`;
        }

        filesystem.write(pkgPath, pkg, { jsonIndent: 2 });
      }
    }

    // ── 6. migrations-utils/ts-compiler.js bootstrap ─────────────────────
    //
    // The project's tsconfig.json restricts `types` to vitest/globals
    // which hides Node globals (__dirname, require, exports). This
    // bootstrap registers ts-node with an explicit Node-aware config.
    // Always write it fresh in vendor mode — overwrites whatever the
    // starter shipped (which relies on node_modules/@lenne.tech/nest-server).
    const tsCompilerPath = `${dest}/migrations-utils/ts-compiler.js`;
    filesystem.write(
      tsCompilerPath,
      [
        '/**',
        ' * ts-node bootstrap for the migrate CLI (vendor mode).',
        ' *',
        " * The project's tsconfig.json restricts `types` to vitest/globals",
        ' * which hides Node globals (__dirname, require, exports). This',
        ' * bootstrap registers ts-node with an explicit Node-aware config.',
        ' */',
        "const tsNode = require('ts-node');",
        '',
        'tsNode.register({',
        '  transpileOnly: true,',
        '  compilerOptions: {',
        "    module: 'commonjs',",
        "    target: 'es2022',",
        '    esModuleInterop: true,',
        '    experimentalDecorators: true,',
        '    emitDecoratorMetadata: true,',
        '    skipLibCheck: true,',
        "    types: ['node'],",
        '  },',
        '});',
        '',
      ].join('\n'),
    );

    // ── 7. tsconfig.json excludes + Node types ───────────────────────────
    //
    // The vendored migrate template references `from '@lenne.tech/nest-server'`
    // as a placeholder that only makes sense in the *generated* migration
    // file's context. Exclude it from compilation.
    //
    // The starter's tsconfig.json restricts `types` to `['vitest/globals']`
    // because the shipped framework dist was pre-compiled with Node types
    // baked in. In vendor mode we compile the framework source directly,
    // so we MUST also load `@types/node` — otherwise types like
    // `ScryptOptions` in core-better-auth-user.mapper.ts break the build.
    this.widenTsconfigExcludes(`${dest}/tsconfig.json`);
    this.widenTsconfigExcludes(`${dest}/tsconfig.build.json`);
    this.widenTsconfigTypes(`${dest}/tsconfig.json`);
    this.widenTsconfigTypes(`${dest}/tsconfig.build.json`);

    // ── 10. VENDOR.md baseline ───────────────────────────────────────────
    const vendorMdPath = `${dest}/src/core/VENDOR.md`;
    if (!filesystem.exists(vendorMdPath)) {
      const today = new Date().toISOString().slice(0, 10);
      filesystem.write(
        vendorMdPath,
        [
          '# @lenne.tech/nest-server – core (vendored)',
          '',
          'This directory is a curated vendor copy of the `core/` tree from',
          '@lenne.tech/nest-server. It is first-class project code, not a',
          'node_modules shadow copy. Edit freely; log substantial changes in',
          'the "Local changes" table below so the `nest-server-core-updater`',
          'agent can classify them at sync time.',
          '',
          'The flatten-fix was applied during `lt fullstack init`: the',
          'upstream `src/index.ts`, `src/core.module.ts`, `src/test/`,',
          '`src/templates/`, `src/types/`, and `LICENSE` were moved under',
          '`src/core/` and their relative `./core/…` specifiers were',
          'stripped. See the init code in',
          '`lenneTech/cli/src/extensions/server.ts#convertCloneToVendored`.',
          '',
          '## Baseline',
          '',
          '- **Upstream-Repo:** https://github.com/lenneTech/nest-server',
          '- **Baseline-Version:** (detected from clone — run `vendor:sync` to record)',
          `- **Vendored am:** ${today}`,
          `- **Vendored von:** lt CLI (\`lt fullstack init --framework-mode vendor\`)`,
          '',
          '## Sync history',
          '',
          '| Date | From | To | Notes |',
          '| ---- | ---- | -- | ----- |',
          `| ${today} | — | initial import | scaffolded by lt CLI |`,
          '',
          '## Local changes',
          '',
          '| Date | Commit | Scope | Reason | Status |',
          '| ---- | ------ | ----- | ------ | ------ |',
          '| — | — | (none, pristine) | initial vendor | — |',
          '',
          '## Upstream PRs',
          '',
          '| PR | Title | Commits | Status |',
          '| -- | ----- | ------- | ------ |',
          '| — | (none yet) | — | — |',
          '',
        ].join('\n'),
      );
    }
  }

  /**
   * Restores framework-core-essential dependencies that the `api-mode.manifest.json`
   * of the starter strips when running in REST-only mode. The vendored
   * framework core at `src/core/` always imports these packages (e.g.
   * core-auth.module.ts imports `graphql-subscriptions`), so even a pure
   * REST project needs them available at compile time.
   *
   * Pinned versions match the upstream @lenne.tech/nest-server 11.24.1
   * manifest; when the starter is bumped the next vendor-sync will
   * overwrite these with fresher pins.
   */
  protected restoreVendorCoreEssentials(dest: string): void {
    const pkgPath = `${dest}/package.json`;
    if (!this.filesystem.exists(pkgPath)) return;
    const pkg = this.filesystem.read(pkgPath, 'json') as Record<string, any>;
    if (!pkg || typeof pkg !== 'object') return;

    if (!pkg.dependencies) pkg.dependencies = {};
    const deps = pkg.dependencies as Record<string, string>;
    const coreEssentials: Record<string, string> = {
      'graphql-subscriptions': '3.0.0',
      'graphql-upload': '15.0.2',
      'json-to-graphql-query': '2.3.0',
    };
    for (const [name, version] of Object.entries(coreEssentials)) {
      if (!deps[name]) {
        deps[name] = version;
      }
    }
    this.filesystem.write(pkgPath, pkg, { jsonIndent: 2 });
  }

  /**
   * Ensures the given tsconfig contains both `node` and `vitest/globals`
   * in its `types` array.
   *
   * - `node` is required because the vendored framework source uses Node
   *   globals / types like `ScryptOptions` (from `node:crypto`), which
   *   the starter's compiled dist never needed.
   * - `vitest/globals` is required because `src/core/test/test.helper.ts`
   *   uses the global `expect` from vitest, and that file is transitively
   *   pulled into the build via TestHelper consumers. tsconfig `exclude`
   *   doesn't help because exclude is a non-transitive filter.
   *
   * Idempotent. Handles both bracketed arrays and absent keys, and
   * leaves the file untouched if both types are already listed.
   */
  protected widenTsconfigTypes(tsconfigPath: string): void {
    if (!this.filesystem.exists(tsconfigPath)) return;
    try {
      let raw = this.filesystem.read(tsconfigPath) || '';
      const needed = ['node', 'vitest/globals'];
      for (const type of needed) {
        // Already contains this type in some types array — skip it.
        const alreadyRegex = new RegExp(`"types"\\s*:\\s*\\[[^\\]]*"${type.replace(/\//g, '\\/')}"`);
        if (alreadyRegex.test(raw)) continue;

        const typesRegex = /("types"\s*:\s*\[)([^\]]*)(\])/;
        if (typesRegex.test(raw)) {
          raw = raw.replace(typesRegex, (_m, head, body, tail) => {
            const trimmed = (body as string).trim();
            const joiner = trimmed.length > 0 ? ', ' : '';
            return `${head}${body}${joiner}"${type}"${tail}`;
          });
        } else {
          const compilerOptionsRegex = /("compilerOptions"\s*:\s*\{)/;
          if (compilerOptionsRegex.test(raw)) {
            raw = raw.replace(compilerOptionsRegex, `$1\n    "types": ["${type}"],`);
          }
        }
      }
      this.filesystem.write(tsconfigPath, raw);
    } catch {
      // best-effort
    }
  }

  /**
   * Adds the vendored migrate template file AND the vendored `src/core/test/`
   * directory to the `exclude` array of a tsconfig (build or base).
   *
   * - The migrate template file is a text template that references
   *   `@lenne.tech/nest-server` as a placeholder — only meaningful in the
   *   *generated* migration file's context. Exclude from compilation.
   * - `src/core/test/` contains `TestHelper`, which uses vitest globals
   *   (`expect`, etc.) and is not intended for production dist. The
   *   starter's `tsconfig.build.json` overrides `types` to `["node"]`,
   *   which strips vitest globals; compiling `test.helper.ts` there
   *   breaks. Exclude the whole `src/core/test/` subtree from the build.
   *
   * Handles both arrays with pre-existing entries and absent `exclude`
   * keys. Idempotent.
   */
  protected widenTsconfigExcludes(tsconfigPath: string): void {
    if (!this.filesystem.exists(tsconfigPath)) {
      return;
    }
    const EXCLUDE_ENTRIES = [
      'src/core/modules/migrate/templates/**/*.template.ts',
      'src/core/test/**/*.ts',
    ];
    try {
      // The upstream tsconfig files may contain comments — standard JSON parse
      // breaks on them. Use a regex-based patch as a fallback.
      let raw = this.filesystem.read(tsconfigPath) || '';
      for (const entry of EXCLUDE_ENTRIES) {
        if (raw.includes(entry)) continue;
        const excludeRegex = /("exclude"\s*:\s*\[)([^\]]*)(\])/;
        if (excludeRegex.test(raw)) {
          raw = raw.replace(excludeRegex, (_match, head, body, tail) => {
            const trimmed = (body as string).trim();
            const joiner = trimmed.length > 0 ? ', ' : '';
            return `${head}${body}${joiner}"${entry}"${tail}`;
          });
        } else {
          // No exclude key at all — add one before the closing brace.
          const lastBrace = raw.lastIndexOf('}');
          if (lastBrace === -1) continue;
          const before = raw.slice(0, lastBrace);
          const after = raw.slice(lastBrace);
          const separator = before.trimEnd().endsWith(',') || before.trimEnd().endsWith('{') ? '' : ',';
          raw = `${before.trimEnd()}${separator}\n  "exclude": ["${entry}"]\n${after}`;
        }
      }
      this.filesystem.write(tsconfigPath, raw);
    } catch {
      // Best-effort; the project will still work, it just may need a
      // manual `tsconfig.json` exclude when building.
    }
  }

  /**
   * Patch config.env.ts using TypeScript AST manipulation
   * - Replace SECRET_OR_PRIVATE_KEY placeholders with random secrets
   * - Replace database names (nest-server-*) with project-specific names
   */
  patchConfigEnvTs(configPath: string, projectDir: string): void {
    if (!this.filesystem.exists(configPath)) {
      return;
    }

    try {
      const { Project, SyntaxKind } = require('ts-morph');
      const project = new Project({ skipAddingFilesFromTsConfig: true });
      const sourceFile = project.addSourceFileAtPath(configPath);

      const secretMap = new Map<string, string>();

      for (const literal of sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
        const text = literal.getLiteralText();

        // Replace SECRET_OR_PRIVATE_KEY placeholders with random secrets
        if (text.startsWith('SECRET_OR_PRIVATE_KEY')) {
          if (!secretMap.has(text)) {
            secretMap.set(text, crypto.randomBytes(512).toString('base64'));
          }
          literal.setLiteralValue(secretMap.get(text)!);
          continue;
        }

        // Replace database names (nest-server-ci -> projectDir-ci)
        if (text.includes('nest-server-')) {
          literal.setLiteralValue(text.replace(/nest-server-/g, `${projectDir}-`));
        }
      }

      sourceFile.saveSync();
    } catch {
      // Fallback to regex-based approach if ts-morph fails
      let content = this.filesystem.read(configPath);
      if (!content) {
        return;
      }
      content = this.replaceSecretOrPrivateKeys(content);
      content = content.replace(/nest-server-(\w+)/g, `${projectDir}-$1`);
      this.filesystem.write(configPath, content);
    }
  }

  /**
   * Patch CLAUDE.md with API mode information
   * Replaces the generic "API Mode" line with the selected mode and removes the
   * API Mode System section when not in "Both" mode (markers already stripped).
   * @param dest - Target directory containing the CLAUDE.md file
   * @param apiMode - Selected API mode (Rest, GraphQL, or Both)
   */
  private patchClaudeMdApiMode(dest: string, apiMode?: 'Both' | 'GraphQL' | 'Rest'): void {
    const claudeMdPath = `${dest}/CLAUDE.md`;
    if (!this.filesystem.exists(claudeMdPath) || !apiMode) {
      return;
    }

    let content = this.filesystem.read(claudeMdPath);
    if (!content) {
      return;
    }

    // Replace generic API mode placeholder or description
    content = content.replace(/- \*\*API Mode:\*\* REST \(default\) or GraphQL or Both/, `- **API Mode:** ${apiMode}`);

    // When not in "Both" mode, the region markers have been stripped by processApiMode.
    // Replace the API Mode System section with a short note.
    // Lookahead anchors (## Tooling, ## Framework:) match the known next-section headers in the
    // nest-server-starter CLAUDE.md template. The $ fallback ensures the regex terminates even if
    // neither header exists (e.g., template was customized).
    if (apiMode !== 'Both') {
      content = content.replace(
        /## API Mode System[\s\S]*?(?=## Tooling|## Framework:|$)/,
        `## API Mode\n\nThis project uses **${apiMode}** mode (configured during \`lt fullstack init\` / \`lt server create\`).\n\n`,
      );
    }

    this.filesystem.write(claudeMdPath, content);
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
