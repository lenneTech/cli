import * as crypto from 'crypto';
import { GluegunFilesystem } from 'gluegun';
import { PromptOptions } from 'gluegun/build/types/toolbox/prompt-enquirer-types';
import { GluegunAskResponse, GluegunEnquirer } from 'gluegun/build/types/toolbox/prompt-types';
import { join } from 'path';
import * as ts from 'typescript';

import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';
import { ServerProps } from '../interfaces/ServerProps.interface';
import { formatMarkdownTable } from '../lib/markdown-table';

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
      /**
       * Experimental nest-base template (Bun + Prisma + Postgres + Better-Auth).
       * Skips all nest-server-starter specific post-processing.
       */
      experimental?: boolean;
      /**
       * Framework consumption mode. See `setupServerForFullstack` for the
       * full explanation; the semantics here are identical — standalone
       * `lt server create` now supports vendor mode too.
       */
      frameworkMode?: 'npm' | 'vendor';
      /** Branch, tag or commit of upstream nest-server in vendor mode. */
      frameworkUpstreamBranch?: string;
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
      experimental = false,
      frameworkMode = 'npm',
      frameworkUpstreamBranch,
      linkPath,
      name,
      projectDir,
      skipInstall = false,
      skipPatching = false,
    } = options;

    const repoUrl = experimental
      ? 'https://github.com/lenneTech/nest-base.git'
      : 'https://github.com/lenneTech/nest-server-starter.git';

    // Setup template
    const result = await templateHelper.setup(dest, {
      branch,
      copyPath,
      linkPath,
      repoUrl,
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
        if (!experimental) {
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
        }

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

        if (!experimental) {
          // Update meta.json if exists
          if (this.filesystem.exists(`${dest}/src/meta`)) {
            await patching.update(`${dest}/src/meta`, (config: Record<string, unknown>) => {
              config.name = name;
              config.description = description;
              return config;
            });
          }
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

    // Vendor-mode transformation — identical to setupServerForFullstack, so
    // a standalone `lt server create --framework-mode vendor` produces the
    // same project layout as `lt fullstack init --framework-mode vendor`.
    // Essentials list is captured BEFORE processApiMode deletes the
    // manifest (same dance as in setupServerForFullstack).
    let standaloneVendorUpstreamDeps: Record<string, string> = {};
    let standaloneVendorCoreEssentials: string[] = [];
    if (!experimental && frameworkMode === 'vendor') {
      try {
        const converted = await this.convertCloneToVendored({
          dest,
          projectName: name,
          upstreamBranch: frameworkUpstreamBranch,
        });
        standaloneVendorUpstreamDeps = converted.upstreamDeps;
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }
      standaloneVendorCoreEssentials = this.readApiModeGraphqlEssentials(dest);
    }

    // Process API mode (before install so package.json is correct)
    if (!experimental && apiMode) {
      try {
        await apiModeHelper.processApiMode(dest, apiMode);
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }
    }

    // Restore core essentials after processApiMode stripped them (vendor + REST only).
    if (!experimental && frameworkMode === 'vendor' && apiMode === 'Rest') {
      try {
        this.restoreVendorCoreEssentials({
          dest,
          essentials: standaloneVendorCoreEssentials,
          upstreamDeps: standaloneVendorUpstreamDeps,
        });
      } catch {
        // Non-fatal.
      }
    }

    // Patch CLAUDE.md with API mode info
    if (!experimental) {
      this.patchClaudeMdApiMode(dest, apiMode);
    }

    // Install packages
    if (!skipInstall && !experimental) {
      try {
        const { pm } = this.toolbox;
        await system.run(`cd "${dest}" && ${pm.install(pm.detect(dest))}`);
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }

      // Post-install format pass. processApiMode may have left whitespace
      // artifacts (multi-line arrays/imports) that the formatter flags in
      // format:check; oxfmt is only available after install, so we run it
      // here.
      if (apiMode) {
        await apiModeHelper.formatProject(dest);
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
      /**
       * Experimental nest-base template (Bun + Prisma + Postgres + Better-Auth).
       * Skips all nest-server-starter specific post-processing.
       */
      experimental?: boolean;
      frameworkMode?: 'npm' | 'vendor';
      /**
       * Branch, tag, or commit of the upstream @lenne.tech/nest-server repo
       * to use when vendoring the framework core (vendor mode only).
       * Default: repository HEAD.
       */
      frameworkUpstreamBranch?: string;
      linkPath?: string;
      name: string;
      projectDir: string;
    },
  ): Promise<{ method: 'clone' | 'copy' | 'link'; path: string; success: boolean }> {
    const { apiMode: apiModeHelper, templateHelper } = this.toolbox;
    const {
      apiMode,
      branch,
      copyPath,
      experimental = false,
      frameworkMode = 'npm',
      frameworkUpstreamBranch,
      linkPath,
      name,
      projectDir,
    } = options;

    const repoUrl = experimental
      ? 'https://github.com/lenneTech/nest-base.git'
      : 'https://github.com/lenneTech/nest-server-starter';

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
      repoUrl,
    });

    if (!result.success) {
      return { method: result.method, path: result.path, success: false };
    }

    // Link mode: skip all post-processing
    if (result.method === 'link') {
      return { method: 'link', path: result.path, success: true };
    }

    // Apply minimal patches for fullstack
    if (!experimental) {
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
    } else {
      try {
        await this.toolbox.patching.update(`${dest}/package.json`, (config: Record<string, unknown>) => {
          config.name = projectDir;
          config.description = `API for ${name} app`;
          config.version = '0.0.0';
          return config;
        });
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }
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
    //
    // We capture the framework package.json snapshot from the temp clone so
    // the post-apiMode step can restore upstream-declared core essentials
    // without hard-coding package lists.
    let vendorUpstreamDeps: Record<string, string> = {};
    let vendorCoreEssentials: string[] = [];
    if (!experimental && frameworkMode === 'vendor') {
      try {
        const converted = await this.convertCloneToVendored({
          dest,
          projectName: name,
          upstreamBranch: frameworkUpstreamBranch,
        });
        vendorUpstreamDeps = converted.upstreamDeps;
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }

      // Read the graphql-only package list from the starter's
      // api-mode.manifest.json BEFORE processApiMode runs and deletes it.
      // These are exactly the packages processApiMode will strip in REST
      // mode — and in vendor mode they must come back afterwards, because
      // src/core/** still imports them even when the consumer project is
      // REST-only (e.g. PubSub in core-auth.module.ts, GraphQLUpload in
      // core-file.service.ts). List is dynamic; new additions surface
      // automatically.
      vendorCoreEssentials = this.readApiModeGraphqlEssentials(dest);
    }

    // Process API mode (before install which happens at monorepo level)
    if (!experimental && apiMode) {
      try {
        await apiModeHelper.processApiMode(dest, apiMode);
      } catch (err) {
        return { method: result.method, path: dest, success: false };
      }
    }

    // In vendor mode + REST, re-add the graphql essentials that
    // processApiMode just stripped. Both and GraphQL keep all packages
    // by construction and don't need restoration.
    if (!experimental && frameworkMode === 'vendor' && apiMode === 'Rest') {
      try {
        this.restoreVendorCoreEssentials({
          dest,
          essentials: vendorCoreEssentials,
          upstreamDeps: vendorUpstreamDeps,
        });
      } catch (err) {
        // Non-fatal — install may still succeed if the core never imports
        // the restored packages at the current version.
      }
    }

    // Patch CLAUDE.md with API mode info
    if (!experimental) {
      this.patchClaudeMdApiMode(dest, apiMode);
    }

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
   * `src/core.module.ts`, `src/test/`, `src/types/`, `LICENSE`,
   * `bin/migrate.js`) into the project at `src/core/` applying the
   * flatten-fix, place upstream `src/templates/` at `<project>/src/templates/`
   * (outside core/ so the runtime resolver finds it at the same relative
   * path as in npm mode), remove `@lenne.tech/nest-server` from the
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
  protected async convertCloneToVendored(options: {
    /** Absolute path of the project's api root (where package.json lives). */
    dest: string;
    /** Project name. Currently used only for logging/diagnostics. */
    projectName?: string;
    /** Branch, tag or commit to check out from the upstream repo. Default: HEAD. */
    upstreamBranch?: string;
    /** Override the upstream framework repo URL (for testing / forks). */
    upstreamRepoUrl?: string;
  }): Promise<{ upstreamDeps: Record<string, string>; upstreamDevDeps: Record<string, string> }> {
    const { dest, upstreamBranch, upstreamRepoUrl = 'https://github.com/lenneTech/nest-server.git' } = options;

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
    const branchArg = upstreamBranch ? `--branch ${upstreamBranch} ` : '';
    try {
      await system.run(`git clone --depth 1 ${branchArg}${upstreamRepoUrl} ${tmpClone}`);
    } catch (err) {
      // Clone failures usually boil down to one of four causes — network,
      // auth, unknown ref, or a pre-existing tmp dir. Give the user a
      // pointed error message rather than the raw `git clone` stderr.
      const raw = (err as Error).message || '';
      const hints: string[] = [];
      if (/Could not resolve host|getaddrinfo|ECONNREFUSED|Network is unreachable/i.test(raw)) {
        hints.push('Network issue reaching github.com — check your connection or proxy settings.');
      }
      if (/Permission denied|authentication failed|publickey|403|401/i.test(raw)) {
        hints.push('Authentication issue — the CLI uses an anonymous HTTPS clone; verify GitHub is reachable.');
      }
      if (upstreamBranch && /Remote branch .* not found|did not match any file\(s\) known to git/i.test(raw)) {
        hints.push(
          `Upstream ref "${upstreamBranch}" does not exist. Check ${upstreamRepoUrl}/tags or /branches for valid refs. ` +
            'Note: nest-server tags have NO "v" prefix — use e.g. "11.24.1", not "v11.24.1".',
        );
      }
      if (/already exists and is not an empty/i.test(raw)) {
        hints.push(
          `Target directory ${tmpClone} already exists. This usually indicates a stale previous run — rm -rf /tmp/lt-vendor-nest-server-* and retry.`,
        );
      }
      const hintBlock = hints.length > 0 ? `\n  Hints:\n    - ${hints.join('\n    - ')}` : '';
      throw new Error(
        `Failed to clone ${upstreamRepoUrl}${upstreamBranch ? ` (branch/tag: ${upstreamBranch})` : ''}.\n  Raw git error: ${raw.trim()}${hintBlock}`,
      );
    }

    // Snapshot upstream package.json before cleanup so we can merge its
    // transitive deps into the project's package.json (step 5 below).
    let upstreamDeps: Record<string, string> = {};
    let upstreamDevDeps: Record<string, string> = {};
    let upstreamVersion = '';
    try {
      const upstreamPkg = filesystem.read(`${tmpClone}/package.json`, 'json') as Record<string, any>;
      if (upstreamPkg && typeof upstreamPkg === 'object') {
        upstreamDeps = (upstreamPkg.dependencies as Record<string, string>) || {};
        upstreamDevDeps = (upstreamPkg.devDependencies as Record<string, string>) || {};
        upstreamVersion = (upstreamPkg.version as string) || '';
      }
    } catch {
      // Best-effort — if we can't read upstream pkg, the starter's own
      // deps should still cover most of the framework's needs.
    }

    // Snapshot the upstream CLAUDE.md for section-merge into projects/api/CLAUDE.md.
    // The nest-server CLAUDE.md contains framework-specific instructions that
    // Claude Code needs to work correctly with the vendored source (API conventions,
    // UnifiedField usage, CrudService patterns, etc.). We capture it before the
    // temp clone is deleted and merge it after the vendor-marker block.
    let upstreamClaudeMd = '';
    try {
      const claudeMdContent = filesystem.read(`${tmpClone}/CLAUDE.md`);
      if (typeof claudeMdContent === 'string') {
        upstreamClaudeMd = claudeMdContent;
      }
    } catch {
      // Non-fatal — if missing, the project CLAUDE.md just won't get upstream sections.
    }

    // Snapshot the upstream commit SHA for traceability in VENDOR.md.
    let upstreamCommit = '';
    try {
      const sha = await system.run(`git -C ${tmpClone} rev-parse HEAD`);
      upstreamCommit = (sha || '').trim();
    } catch {
      // Non-fatal — VENDOR.md will just show an empty SHA.
    }

    try {
      // ── 2. Copy framework kernel into project src/core/ (flatten-fix) ──
      //
      // Upstream layout: src/core/ (framework sub-dir) + src/index.ts +
      // src/core.module.ts + src/test/ + src/templates/ + src/types/.
      // Target layout: most things flat under <project>/src/core/, with
      // one exception: src/templates/ stays at the same upstream location
      // (<project>/src/templates/) because the runtime email-template
      // resolver uses __dirname-relative lookup that must match npm mode.
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
        // src/templates/ stays OUTSIDE src/core/ at its upstream location so
        // the runtime template resolver (which computes
        // `__dirname + '../../../templates'` from within
        // src/core/modules/better-auth/) finds E-Mail templates at the same
        // relative path as in npm mode (node_modules/@lenne.tech/nest-server/
        // src/templates/). Keeping templates as first-class project files
        // outside core/ also lets projects customize them without touching
        // the vendored framework tree.
        [`${tmpClone}/src/templates`, `${dest}/src/templates`],
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
      // Overwrite existing file if present (convert-mode on existing project).
      if (filesystem.exists(`${tmpClone}/bin/migrate.js`)) {
        if (filesystem.exists(`${dest}/bin/migrate.js`)) {
          filesystem.remove(`${dest}/bin/migrate.js`);
        }
        filesystem.copy(`${tmpClone}/bin/migrate.js`, `${dest}/bin/migrate.js`);
      }

      // Copy migration-guides for vendor-sync agent reference (optional
      // but useful — small overhead, big value for the updater agent).
      // Preserve any project-specific guides by merging instead of overwriting.
      if (filesystem.exists(`${tmpClone}/migration-guides`)) {
        if (filesystem.exists(`${dest}/migration-guides`)) {
          // Project already has migration-guides (maybe custom ones) — merge
          // upstream files into the existing directory without removing locals.
          const upstreamGuides =
            filesystem.find(`${tmpClone}/migration-guides`, {
              matching: '*.md',
              recursive: false,
            }) || [];
          for (const guide of upstreamGuides) {
            const basename = require('node:path').basename(guide);
            const source = `${tmpClone}/migration-guides/${basename}`;
            const target = `${dest}/migration-guides/${basename}`;
            if (filesystem.exists(target)) {
              filesystem.remove(target);
            }
            if (filesystem.exists(source)) {
              filesystem.copy(source, target);
            }
          }
        } else {
          filesystem.copy(`${tmpClone}/migration-guides`, `${dest}/migration-guides`);
        }
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

    // Edge: express exports Request/Response as TYPE-ONLY. In npm-mode this
    // was not a problem because the framework shipped as pre-compiled dist/
    // and type imports were erased before runtime. In vendor-mode, vitest/vite
    // evaluates the TypeScript source directly and chokes with:
    //   "The requested module 'express' does not provide an export named 'Response'"
    // Fix: convert `import { Request, Response } from 'express'` (and variants
    // with NextFunction etc.) to type-only imports wherever they appear in the
    // vendored core. This is safe because the core code uses Request/Response
    // only as type annotations — any runtime `new Request(...)` calls refer
    // to the global Fetch API Request, not the express one.
    const expressImportRegex = /^import\s+\{([^}]*)\}\s+from\s+['"]express['"]\s*;?\s*$/gm;
    const vendoredTsFiles =
      filesystem.find(coreDir, {
        matching: '**/*.ts',
        recursive: true,
      }) || [];
    for (const filePath of vendoredTsFiles) {
      // filesystem.find returns paths relative to jetpack cwd — use absolute resolution
      const absPath = filePath.startsWith('/') ? filePath : require('node:path').resolve(filePath);
      if (!filesystem.exists(absPath)) continue;
      const content = filesystem.read(absPath) || '';
      if (!content.includes("from 'express'") && !content.includes('from "express"')) continue;
      const patched = content.replace(expressImportRegex, (_match, names) => {
        const cleanNames = names
          .split(',')
          .map((n: string) => n.trim())
          .filter((n: string) => n.length > 0 && n !== 'type')
          // Strip any pre-existing 'type ' prefix on individual names
          .map((n: string) => n.replace(/^type\s+/, ''))
          .join(', ');
        return `import type { ${cleanNames} } from 'express';`;
      });
      if (patched !== content) {
        filesystem.write(absPath, patched);
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
        relToCore = `./${relToCore}`;
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
              relToCore = `./${relToCore}`;
            }
            const patched = content
              .replace(/require\(['"]@lenne\.tech\/nest-server['"]\)/g, `require('${relToCore}')`)
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

    // Explicit rewrite of migrations-utils/migrate.js — the generic codemod
    // above works indirectly (via `bin/migrate.js` loading ts-node first),
    // but it's fragile: if somebody invokes migrate.js standalone, `require
    // ('../src/core')` would crash because Node cannot load TypeScript.
    // Replace the file with the explicit, imo-pilot-proven variant that
    // registers ts-node itself BEFORE requiring the vendored core and
    // points at the specific migration.helper path (not the index hub).
    const migrateJsPath = `${dest}/migrations-utils/migrate.js`;
    filesystem.write(
      migrateJsPath,
      [
        '// The vendored core is TypeScript-only (no prebuilt dist/). Register ts-node (via our',
        '// custom bootstrap) before requiring any vendor module, so that .ts source files are',
        '// transparently compiled on demand. Uses the same compiler config as the migrate CLI.',
        "require('./ts-compiler');",
        '',
        "const { createMigrationStore } = require('../src/core/modules/migrate/helpers/migration.helper');",
        "const config = require('../src/config.env');",
        '',
        'module.exports = createMigrationStore(',
        '  config.default.mongoose.uri,',
        "  'migrations' // optional, default is 'migrations'",
        ');',
        '',
      ].join('\n'),
    );

    // ── 4b. (removed) ─────────────────────────────────────────────────────
    //
    // Previous versions copied three maintenance scripts into
    // `scripts/vendor/` (check-vendor-freshness.mjs, sync-from-upstream.ts,
    // propose-upstream-pr.ts). The sync + propose scripts duplicated what
    // the lt-dev Claude Code agents (nest-server-core-updater and
    // nest-server-core-contributor) do natively — they were dead weight.
    //
    // The freshness check is now an inline one-liner in package.json
    // (see step 5 below). VENDOR.md is the sole vendor-specific file.

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
        //
        // Fully dynamic: we pull in EVERY upstream dependency that the
        // project doesn't already have. No hard-coded package lists —
        // additions to upstream's package.json surface automatically on
        // the next vendor-init or vendor-sync.
        if (!pkg.dependencies) pkg.dependencies = {};
        const deps = pkg.dependencies as Record<string, string>;
        for (const [depName, depVersion] of Object.entries(upstreamDeps)) {
          if (depName === '@lenne.tech/nest-server') continue;
          if (!(depName in deps)) {
            deps[depName] = depVersion;
          }
        }

        // Merge upstream devDependencies that a consumer project actually
        // needs at compile time. Rather than hard-coding a list of types
        // packages (which would drift as upstream evolves), we accept any
        // `@types/*` package whose base package is present in the merged
        // runtime deps (e.g. if `bcrypt` is in deps, `@types/bcrypt` is
        // accepted). This scales to new upstream additions automatically.
        //
        // Additionally, any upstream devDependency that the CLI knows is
        // used at runtime by the framework (via the dedicated
        // `vendorRuntimeDevDeps` predicate below) is promoted into
        // `dependencies`, because after vendoring the framework code lives
        // in the project and needs its runtime helpers available in prod.
        if (!pkg.devDependencies) pkg.devDependencies = {};
        const devDeps = pkg.devDependencies as Record<string, string>;
        for (const [depName, depVersion] of Object.entries(upstreamDevDeps)) {
          // Runtime-needed devDeps → promote to dependencies
          if (this.isVendorRuntimeDep(depName) && !(depName in deps)) {
            deps[depName] = depVersion;
            continue;
          }
          // @types/<pkg> where <pkg> is a runtime dep → accept as devDep
          if (depName.startsWith('@types/')) {
            const basePkg = depName.slice('@types/'.length);
            const matchesRuntime =
              basePkg in deps ||
              basePkg === 'node' ||
              // scoped types: @types/foo__bar ↔ @foo/bar
              (basePkg.includes('__') && `@${basePkg.replace('__', '/')}` in deps);
            if (matchesRuntime && !(depName in devDeps) && !(depName in deps)) {
              devDeps[depName] = depVersion;
            }
          }
        }

        // Add a script to run the local bin/migrate.js. The starter's
        // existing migrate:* scripts are already correct for npm mode; we
        // need them pointing at the local bin + local ts-compiler.
        //
        // Wire the inline vendor-freshness check and hook it into
        // `check` / `check:fix` / `check:naf` as a non-blocking first step.
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

          // Vendor freshness check: reads VENDOR.md baseline version and
          // compares against npm registry. Non-blocking (always exits 0).
          // Uses a short inline script — no external file needed.
          // The heredoc-style approach avoids quote-escaping nightmares.
          scripts['check:vendor-freshness'] = [
            'node -e "',
            "var f=require('fs'),h=require('https');",
            "try{var c=f.readFileSync('src/core/VENDOR.md','utf8')}catch(e){process.exit(0)}",
            'var m=c.match(/Baseline-Version[^0-9]*(\\d+\\.\\d+\\.\\d+)/);',
            "if(!m){process.stderr.write(String.fromCharCode(9888)+' vendor-freshness: no baseline\\n');process.exit(0)}",
            'var v=m[1];',
            "h.get('https://registry.npmjs.org/@lenne.tech/nest-server/latest',function(r){",
            "var d='';r.on('data',function(c){d+=c});r.on('end',function(){",
            'try{var l=JSON.parse(d).version;',
            "if(v===l)console.log('vendor core up-to-date (v'+v+')');",
            "else process.stderr.write('vendor core v'+v+', latest v'+l+'\\n')",
            "}catch(e){}})}).on('error',function(){});",
            'setTimeout(function(){process.exit(0)},5000)',
            '"',
          ].join('');

          // Hook vendor-freshness as the first step of check / check:fix /
          // check:naf. Non-blocking (exit 0 even on mismatch), so it just
          // surfaces the warning at the top of the log.
          const hookFreshness = (scriptName: string) => {
            const existing = scripts[scriptName];
            if (!existing) return;
            if (existing.includes('check:vendor-freshness')) return;
            const installPrefix = 'pnpm install && ';
            if (existing.startsWith(installPrefix)) {
              scripts[scriptName] =
                `${installPrefix}pnpm run check:vendor-freshness && ${existing.slice(installPrefix.length)}`;
            } else {
              scripts[scriptName] = `pnpm run check:vendor-freshness && ${existing}`;
            }
          };
          hookFreshness('check');
          hookFreshness('check:fix');
          hookFreshness('check:naf');
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

    // ── 6b. extras/sync-packages.mjs: replace with vendor-aware stub ─────
    //
    // The starter's `extras/sync-packages.mjs` pulls the latest deps of
    // `@lenne.tech/nest-server` from the npm registry and merges them into
    // the project's package.json. In vendor mode the framework is no
    // longer an npm dependency, so the script has nothing meaningful to
    // sync and would either no-op or error out.
    //
    // Replace it with a small informational stub that points the user at
    // the canonical vendor-update path (the `nest-server-core-updater`
    // Claude Code agent). Keeps `pnpm run update` from dead-exiting with
    // a confusing message.
    const syncPackagesPath = `${dest}/extras/sync-packages.mjs`;
    if (filesystem.exists(syncPackagesPath)) {
      filesystem.write(
        syncPackagesPath,
        [
          '#!/usr/bin/env node',
          '',
          "'use strict';",
          '',
          '/**',
          ' * Vendor-mode stub for extras/sync-packages.mjs.',
          ' *',
          ' * The original script is designed for npm-mode projects where',
          ' * `@lenne.tech/nest-server` is an installed dependency and',
          ' * `pnpm run update` pulls the latest upstream deps into the',
          ' * project package.json.',
          ' *',
          ' * This project runs in VENDOR mode: the framework core/ tree is',
          ' * copied directly into src/core/ and there is no framework npm',
          ' * dep to sync. To update the vendored core, use the',
          ' * `nest-server-core-updater` Claude Code agent.',
          ' */',
          '',
          "console.warn('');",
          "console.warn('⚠  pnpm run update is a no-op in vendor mode.');",
          "console.warn('   Framework source lives directly in src/core/ and is updated');",
          "console.warn('   via the nest-server-core-updater agent:');",
          "console.warn('');",
          "console.warn('     /lt-dev:backend:update-nest-server-core');",
          "console.warn('');",
          "console.warn('   See src/core/VENDOR.md for the current baseline and sync history.');",
          "console.warn('');",
          'process.exit(0);',
          '',
        ].join('\n'),
      );
    }

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

    // ── 9b. Prepend a vendor-mode block to projects/api/CLAUDE.md ────────
    //
    // Claude Code's project-level CLAUDE.md is the single source of truth
    // for "what kind of project is this". Prepending a short vendor block
    // tells any downstream agent (backend-dev, generating-nest-servers,
    // nest-server-updater, …) that the framework lives at src/core/ and
    // that generated imports must use relative paths, before they even
    // read the rest of the file.
    const apiClaudeMdPath = `${dest}/CLAUDE.md`;
    if (filesystem.exists(apiClaudeMdPath)) {
      const existing = filesystem.read(apiClaudeMdPath) || '';
      const marker = '<!-- lt-vendor-marker -->';
      if (!existing.includes(marker)) {
        const vendorBlock = [
          marker,
          '',
          '# Vendor-Mode Notice',
          '',
          'This api project runs in **vendor mode**: the `@lenne.tech/nest-server`',
          'core/ tree has been copied directly into `src/core/` as first-class',
          'project code. There is **no** `@lenne.tech/nest-server` npm dependency.',
          '',
          '- **Read framework code from `src/core/**`** — not from `node_modules/`.',
          '- **Generated imports use relative paths** to `src/core`, e.g.',
          "  `import { CrudService } from '../../../core';`",
          '  The exact depth depends on the file location. `lt server module`',
          '  computes it automatically.',
          '- **Baseline + patch log** live in `src/core/VENDOR.md`. Log any',
          '  substantial local change there so the `nest-server-core-updater`',
          '  agent can classify it at sync time.',
          '- **Update flow:** run `/lt-dev:backend:update-nest-server-core` (the',
          '  agent clones upstream, computes a delta, and presents a review).',
          '- **Contribute back:** run `/lt-dev:backend:contribute-nest-server-core`',
          '  to propose local fixes as upstream PRs.',
          '- **Freshness check:** `pnpm run check:vendor-freshness` warns (non-',
          '  blockingly) when upstream has a newer release than the baseline.',
          '',
          '---',
          '',
        ].join('\n');
        filesystem.write(apiClaudeMdPath, vendorBlock + existing);
      }
    }

    // ── 9c. Merge nest-server CLAUDE.md sections into project CLAUDE.md ──
    //
    // The nest-server CLAUDE.md contains framework-specific instructions for
    // Claude Code (API conventions, UnifiedField usage, CrudService patterns,
    // etc.). We merge its H2 sections into the project's CLAUDE.md so that
    // downstream agents (backend-dev, code-reviewer, nest-server-updater)
    // have accurate framework knowledge out of the box.
    //
    // Merge strategy (matches /lt-dev:fullstack:sync-claude-md):
    // - Section in upstream but NOT in project → ADD at end
    // - Section in BOTH → KEEP project version (may have customizations)
    // - Section only in project → KEEP (project-specific content)
    if (upstreamClaudeMd && filesystem.exists(apiClaudeMdPath)) {
      const projectContent = filesystem.read(apiClaudeMdPath) || '';
      const upstreamSections = this.parseH2Sections(upstreamClaudeMd);
      const projectSections = this.parseH2Sections(projectContent);

      const newSections: string[] = [];
      for (const [heading, body] of upstreamSections) {
        if (!projectSections.has(heading)) {
          newSections.push(`## ${heading}\n\n${body.trim()}`);
        }
      }

      if (newSections.length > 0) {
        const separator = projectContent.endsWith('\n') ? '\n' : '\n\n';
        filesystem.write(apiClaudeMdPath, `${projectContent}${separator}${newSections.join('\n\n')}\n`);
      }
    }

    // ── 10. VENDOR.md baseline ───────────────────────────────────────────
    //
    // Record the exact upstream version + commit SHA we vendored from, so
    // the `nest-server-core-updater` agent has a reliable base for
    // computing upstream deltas on the next sync.
    const vendorMdPath = `${dest}/src/core/VENDOR.md`;
    if (!filesystem.exists(vendorMdPath)) {
      const today = new Date().toISOString().slice(0, 10);
      const versionLine = upstreamVersion
        ? `- **Baseline-Version:** ${upstreamVersion}`
        : '- **Baseline-Version:** (not detected — run `/lt-dev:backend:update-nest-server-core` to record)';
      const commitLine = upstreamCommit
        ? `- **Baseline-Commit:** \`${upstreamCommit}\``
        : '- **Baseline-Commit:** (not detected)';
      const syncHistoryTo = upstreamVersion
        ? `${upstreamVersion}${upstreamCommit ? ` (\`${upstreamCommit.slice(0, 10)}\`)` : ''}`
        : 'initial import';
      filesystem.write(
        vendorMdPath,
        [
          '# @lenne.tech/nest-server – core (vendored)',
          '',
          'This directory is a curated vendor copy of the `core/` tree from',
          '@lenne.tech/nest-server. It is first-class project code, not a',
          'node_modules shadow copy — but it is **not a fork**. The copy',
          'exists so Claude Code (and humans) can read framework internals',
          'directly. Log substantial local changes in the "Local changes"',
          'table below so the `nest-server-core-updater` agent can classify',
          'them at sync time.',
          '',
          'The flatten-fix was applied during `lt fullstack init`: the',
          'upstream `src/index.ts`, `src/core.module.ts`, `src/test/`,',
          '`src/types/`, and `LICENSE` were moved under `src/core/` and',
          'their relative `./core/…` specifiers were stripped. The upstream',
          '`src/templates/` tree (E-Mail templates) was placed at the',
          'project root `src/templates/` (outside `src/core/`) so the',
          'runtime template resolver finds them at the same relative path',
          'as in npm mode. See the init code in',
          '`lenneTech/cli/src/extensions/server.ts#convertCloneToVendored`.',
          '',
          '## Modification Policy',
          '',
          'Edit `src/core/` **only** when the change is generally useful to every',
          '@lenne.tech/nest-server consumer:',
          '',
          '- Bugfixes that apply to every consumer',
          '- Broad framework enhancements',
          '- Security vulnerability fixes',
          '- Build/TypeScript compatibility fixes every consumer would hit',
          '',
          'Everything else stays **outside** `src/core/`. Project-specific',
          'business rules, customer enums, and proprietary integrations',
          'belong in project code via modification, inheritance, extension,',
          'or `ICoreModuleOverrides`.',
          '',
          'Generally-useful changes **MUST** be submitted as an upstream PR',
          'to https://github.com/lenneTech/nest-server. Run',
          '`/lt-dev:backend:contribute-nest-server-core` to prepare it — the',
          'agent filters cosmetic commits, categorizes local changes as',
          'upstream-candidate vs. project-specific, and writes PR drafts for',
          "human review. Letting useful fixes rot in one project's vendor",
          'tree is an anti-pattern: they belong upstream so every consumer',
          'benefits and the local patch disappears on the next sync.',
          '',
          'When in doubt, ask before editing `src/core/`.',
          '',
          '## Baseline',
          '',
          '- **Upstream-Repo:** https://github.com/lenneTech/nest-server',
          versionLine,
          commitLine,
          `- **Vendored am:** ${today}`,
          `- **Vendored von:** lt CLI (\`lt fullstack init --framework-mode vendor\`)`,
          '',
          '## Sync history',
          '',
          ...formatMarkdownTable(
            ['Date', 'From', 'To', 'Notes'],
            [[today, '—', syncHistoryTo, 'scaffolded by lt CLI']],
          ),
          '',
          '## Local changes',
          '',
          ...formatMarkdownTable(
            ['Date', 'Commit', 'Scope', 'Reason', 'Status'],
            [['—', '—', '(none, pristine)', 'initial vendor', '—']],
          ),
          '',
          '## Upstream PRs',
          '',
          ...formatMarkdownTable(['PR', 'Title', 'Commits', 'Status'], [['—', '(none yet)', '—', '—']]),
        ].join('\n'),
      );
    }

    // ── Post-conversion verification ──────────────────────────────────────
    //
    // Scan all consumer files for stale bare-specifier imports that the
    // codemod should have rewritten. A single miss causes a compile error,
    // so catching it here with a clear message saves the user debugging time.
    const staleImports = this.findStaleImports(dest, '@lenne.tech/nest-server');
    if (staleImports.length > 0) {
      const { print } = this.toolbox;
      print.warning(
        `⚠ ${staleImports.length} file(s) still contain '@lenne.tech/nest-server' imports after vendor conversion:`,
      );
      for (const f of staleImports.slice(0, 10)) {
        print.info(`  ${f}`);
      }
      if (staleImports.length > 10) {
        print.info(`  ... and ${staleImports.length - 10} more`);
      }
      print.info('These imports must be manually rewritten to relative paths pointing to src/core.');
    }

    return { upstreamDeps, upstreamDevDeps };
  }

  /**
   * Cached set of upstream devDeps that are actually runtime-needed after
   * vendoring. Populated lazily from `src/config/vendor-runtime-deps.json`
   * so new helpers can be added without touching this file.
   */
  private _vendorRuntimeHelpers?: Set<string>;

  /**
   * Predicate: is a given upstream `devDependencies` key actually a runtime
   * dep in disguise that needs to live in `dependencies` after vendoring?
   *
   * `@lenne.tech/nest-server` keeps a few packages in devDependencies that
   * the framework code imports at runtime (e.g. `find-file-up` in its
   * config loader). When we vendor the framework source into a consumer
   * project, those must end up in `dependencies` so the compiled/dist
   * runtime has them available.
   *
   * The list of such helpers lives in `src/config/vendor-runtime-deps.json`
   * under the `runtimeHelpers` key. Adding a new helper is a data-only
   * change (no CLI release required). If the config file is missing or
   * unreadable, the predicate safely returns `false` for everything.
   */
  protected isVendorRuntimeDep(pkgName: string): boolean {
    if (!this._vendorRuntimeHelpers) {
      try {
        const path = require('path');
        const configPath = path.join(__dirname, '..', 'config', 'vendor-runtime-deps.json');
        const raw = this.filesystem.read(configPath, 'json') as undefined | { runtimeHelpers?: string[] };
        const list = Array.isArray(raw?.runtimeHelpers) ? raw!.runtimeHelpers : [];
        this._vendorRuntimeHelpers = new Set(list.filter((e) => typeof e === 'string'));
      } catch {
        this._vendorRuntimeHelpers = new Set();
      }
    }
    return this._vendorRuntimeHelpers.has(pkgName);
  }

  /**
   * Reads the GraphQL-only package list from the starter's
   * `api-mode.manifest.json`. Must be called BEFORE `processApiMode`
   * runs, because `processApiMode` deletes the manifest at the end of
   * its REST-mode pass.
   *
   * Returns a flat list of package names that the manifest declares as
   * GraphQL-specific (both `packages` and `devPackages` arrays from the
   * `graphql` mode config). Empty list if the manifest is missing or
   * malformed.
   */
  protected readApiModeGraphqlEssentials(dest: string): string[] {
    const manifestPath = `${dest}/api-mode.manifest.json`;
    if (!this.filesystem.exists(manifestPath)) return [];
    try {
      const manifest = this.filesystem.read(manifestPath, 'json') as any;
      const gqlMode = manifest?.modes?.graphql;
      if (!gqlMode || typeof gqlMode !== 'object') return [];
      const packages: string[] = [];
      if (Array.isArray(gqlMode.packages)) packages.push(...gqlMode.packages);
      if (Array.isArray(gqlMode.devPackages)) packages.push(...gqlMode.devPackages);
      return packages.filter((p) => typeof p === 'string' && p.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Restores framework-core-essential dependencies that the
   * `api-mode.manifest.json` of the starter strips when running in
   * REST-only mode. The vendored framework core at `src/core/` always
   * imports these packages (e.g. `core-auth.module.ts` imports
   * `graphql-subscriptions`), so even a pure REST project needs them
   * available at compile time.
   *
   * The essentials list is captured BEFORE `processApiMode` runs (via
   * `readApiModeGraphqlEssentials`) and passed in here. Versions come
   * from the upstream `@lenne.tech/nest-server` package.json snapshot
   * (passed in via `upstreamDeps`). No hard-coded package lists or
   * versions — drift between starter and upstream is handled automatically
   * at the next init.
   */
  protected restoreVendorCoreEssentials(options: {
    /** Absolute path of the project's api root. */
    dest: string;
    /** Essential package names (captured before processApiMode). */
    essentials: string[];
    /** Upstream `@lenne.tech/nest-server` dependencies snapshot (for pinning). */
    upstreamDeps?: Record<string, string>;
  }): void {
    const { dest, essentials, upstreamDeps = {} } = options;
    if (!essentials || essentials.length === 0) return;

    const pkgPath = `${dest}/package.json`;
    if (!this.filesystem.exists(pkgPath)) return;
    const pkg = this.filesystem.read(pkgPath, 'json') as Record<string, any>;
    if (!pkg || typeof pkg !== 'object') return;

    if (!pkg.dependencies) pkg.dependencies = {};
    const deps = pkg.dependencies as Record<string, string>;

    for (const name of essentials) {
      if (deps[name]) continue;
      // Prefer the upstream-pinned version when available, else leave
      // unversioned (`latest`) — install will resolve either way.
      const version = upstreamDeps[name] ?? 'latest';
      deps[name] = version;
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
    const EXCLUDE_ENTRIES = ['src/core/modules/migrate/templates/**/*.template.ts', 'src/core/test/**/*.ts'];
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
   * Parse a markdown file into a Map of H2 sections.
   * Key = heading text (without `## `), Value = body text after the heading.
   * Content before the first H2 heading is stored under key `__preamble__`.
   */
  private parseH2Sections(content: string): Map<string, string> {
    const sections = new Map<string, string>();
    const lines = content.split('\n');
    let currentHeading = '__preamble__';
    let currentBody: string[] = [];

    for (const line of lines) {
      const match = /^## (.+)$/.exec(line);
      if (match) {
        sections.set(currentHeading, currentBody.join('\n'));
        currentHeading = match[1].trim();
        currentBody = [];
      } else {
        currentBody.push(line);
      }
    }
    sections.set(currentHeading, currentBody.join('\n'));
    return sections;
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

  // ═══════════════════════════════════════════════════════════════════════
  // Public mode-conversion API (called by `lt server convert-mode`)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Convert an existing npm-mode API project to vendor mode.
   *
   * This is a wrapper around {@link convertCloneToVendored} for use on
   * projects that were **already created** (not during `lt fullstack init`).
   * The method detects the currently installed `@lenne.tech/nest-server`
   * version and vendors from that tag unless `upstreamBranch` overrides it.
   */
  async convertToVendorMode(options: {
    dest: string;
    upstreamBranch?: string;
    upstreamRepoUrl?: string;
  }): Promise<void> {
    const { dest, upstreamBranch, upstreamRepoUrl } = options;
    const { isVendoredProject } = require('../lib/framework-detection');

    if (isVendoredProject(dest)) {
      throw new Error('Project is already in vendor mode (src/core/VENDOR.md exists).');
    }

    // Verify @lenne.tech/nest-server is currently a dependency
    const pkg = this.filesystem.read(`${dest}/package.json`, 'json') as Record<string, any>;
    if (!pkg) {
      throw new Error('Cannot read package.json');
    }
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (!allDeps['@lenne.tech/nest-server']) {
      throw new Error(
        '@lenne.tech/nest-server is not in dependencies or devDependencies. ' +
          'Is this an npm-mode lenne.tech API project?',
      );
    }

    await this.convertCloneToVendored({
      dest,
      upstreamBranch,
      upstreamRepoUrl,
    });
  }

  /**
   * Convert an existing vendor-mode API project back to npm mode.
   *
   * Performs the inverse of {@link convertCloneToVendored}:
   * 1. Read baseline version from VENDOR.md
   * 2. Delete `src/core/` (the vendored framework)
   * 3. Rewrite all consumer imports from relative paths back to `@lenne.tech/nest-server`
   * 4. Restore `@lenne.tech/nest-server` dependency in package.json
   * 5. Restore migrate scripts to npm paths
   * 6. Remove vendor-specific scripts and artifacts
   * 7. Clean up CLAUDE.md vendor marker
   * 8. Restore tsconfig to npm-mode defaults
   */
  async convertToNpmMode(options: { dest: string; targetVersion?: string }): Promise<void> {
    const { dest, targetVersion } = options;
    const path = require('path');
    const { Project, SyntaxKind } = require('ts-morph');

    const { isVendoredProject } = require('../lib/framework-detection');

    if (!isVendoredProject(dest)) {
      throw new Error('Project is not in vendor mode (src/core/VENDOR.md not found).');
    }

    const filesystem = this.filesystem;
    const srcDir = `${dest}/src`;
    const coreDir = `${srcDir}/core`;

    // ── 1. Determine target version + warn about local patches ──────────
    const vendorMd = filesystem.read(`${coreDir}/VENDOR.md`) || '';

    let version = targetVersion;
    if (!version) {
      const match = vendorMd.match(/Baseline-Version:\*{0,2}\s+(\d+\.\d+\.\d+\S*)/);
      if (match) {
        version = match[1];
      }
    }
    if (!version) {
      throw new Error('Cannot determine target version. Specify --version or ensure VENDOR.md has a Baseline-Version.');
    }

    // Warn if VENDOR.md documents local patches that will be lost
    const localChangesSection = vendorMd.match(/## Local changes[\s\S]*?(?=## |$)/i);
    if (localChangesSection) {
      const hasRealPatches =
        localChangesSection[0].includes('|') &&
        !localChangesSection[0].includes('(none, pristine)') &&
        /\|\s*\d{4}-/.test(localChangesSection[0]);
      if (hasRealPatches) {
        const { print } = this.toolbox;
        print.warning('');
        print.warning('⚠  VENDOR.md documents local patches in src/core/ that will be LOST:');
        // Extract non-header table rows
        const rows = localChangesSection[0].split('\n').filter((l: string) => /^\|\s*\d{4}-/.test(l));
        for (const row of rows.slice(0, 5)) {
          print.info(`  ${row.trim()}`);
        }
        if (rows.length > 5) {
          print.info(`  ... and ${rows.length - 5} more`);
        }
        print.warning('Consider running /lt-dev:backend:contribute-nest-server-core first to upstream them.');
        print.warning('');
      }
    }

    // ── 2. Rewrite consumer imports: relative → @lenne.tech/nest-server ─
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const globs = [
      `${srcDir}/server/**/*.ts`,
      `${srcDir}/main.ts`,
      `${srcDir}/config.env.ts`,
      `${dest}/tests/**/*.ts`,
      `${dest}/migrations/**/*.ts`,
      `${dest}/migrations-utils/*.ts`,
      `${dest}/scripts/**/*.ts`,
    ];
    for (const glob of globs) {
      project.addSourceFilesAtPaths(glob);
    }

    const targetSpecifier = '@lenne.tech/nest-server';
    const coreAbsPath = path.resolve(coreDir);

    for (const sourceFile of project.getSourceFiles()) {
      let modified = false;

      // Static imports + re-exports
      for (const decl of [...sourceFile.getImportDeclarations(), ...sourceFile.getExportDeclarations()]) {
        const spec = decl.getModuleSpecifierValue();
        if (!spec) continue;
        // Check if this import resolves to src/core (the vendored framework)
        if (this.isVendoredCoreImport(spec, sourceFile.getFilePath(), coreAbsPath)) {
          decl.setModuleSpecifier(targetSpecifier);
          modified = true;
        }
      }

      // Dynamic imports + CJS require
      sourceFile.forEachDescendant((node: any) => {
        if (node.getKind() === SyntaxKind.CallExpression) {
          const expr = node.getExpression().getText();
          if (expr === 'require' || expr === 'import') {
            const args = node.getArguments();
            if (args.length > 0) {
              const argText = args[0].getText().replace(/['"]/g, '');
              if (this.isVendoredCoreImport(argText, sourceFile.getFilePath(), coreAbsPath)) {
                args[0].replaceWithText(`'${targetSpecifier}'`);
                modified = true;
              }
            }
          }
        }
      });

      if (modified) {
        sourceFile.saveSync();
      }
    }

    // Also rewrite .js files in migrations-utils/
    const jsFiles = filesystem.find(`${dest}/migrations-utils`, { matching: '*.js' }) || [];
    for (const jsFile of jsFiles) {
      const content = filesystem.read(jsFile) || '';
      // Replace any relative require/import that points to src/core
      const replaced = content.replace(
        /require\(['"]([^'"]*\/core(?:\/index)?)['"]\)/g,
        `require('${targetSpecifier}')`,
      );
      if (replaced !== content) {
        filesystem.write(jsFile, replaced);
      }
    }

    // ── 3. Delete src/core/ (vendored framework) ────────────────────────
    filesystem.remove(coreDir);

    // ── 4. Restore @lenne.tech/nest-server dep + clean package.json ─────
    const pkg = filesystem.read(`${dest}/package.json`, 'json') as Record<string, any>;
    if (pkg) {
      // Add @lenne.tech/nest-server as dependency
      pkg.dependencies = pkg.dependencies || {};
      pkg.dependencies['@lenne.tech/nest-server'] = version;

      // Remove vendor-specific deps that are transitive via nest-server
      // (they'll come back via node_modules when nest-server is installed)
      // We only remove deps that are ALSO in nest-server's package.json.
      // For safety, we don't remove any dep the consumer might use directly.

      // Remove vendor-specific scripts
      const scripts = pkg.scripts || {};
      delete scripts['check:vendor-freshness'];
      delete scripts['vendor:sync'];
      delete scripts['vendor:propose-upstream'];

      // Unhook vendor-freshness from check / check:fix / check:naf
      for (const key of ['check', 'check:fix', 'check:naf']) {
        if (scripts[key] && typeof scripts[key] === 'string') {
          scripts[key] = scripts[key].replace(/pnpm run check:vendor-freshness && /g, '');
        }
      }

      // Restore migrate scripts to npm-mode paths
      const migrateCompiler =
        'ts:./node_modules/@lenne.tech/nest-server/dist/core/modules/migrate/helpers/ts-compiler.js';
      const migrateStore = '--store ./migrations-utils/migrate.js --migrations-dir ./migrations';
      const migrateTemplate =
        './node_modules/@lenne.tech/nest-server/dist/core/modules/migrate/templates/migration-project.template.ts';

      scripts['migrate:create'] =
        `f() { migrate create "$1" --template-file ${migrateTemplate} --migrations-dir ./migrations --compiler ${migrateCompiler}; }; f`;
      scripts['migrate:up'] = `migrate up ${migrateStore} --compiler ${migrateCompiler}`;
      scripts['migrate:down'] = `migrate down ${migrateStore} --compiler ${migrateCompiler}`;
      scripts['migrate:list'] = `migrate list ${migrateStore} --compiler ${migrateCompiler}`;

      // Env-prefixed migrate scripts
      for (const env of ['develop', 'test', 'preview', 'prod']) {
        const nodeEnv = env === 'prod' ? 'production' : env;
        scripts[`migrate:${env}:up`] = `NODE_ENV=${nodeEnv} migrate up ${migrateStore} --compiler ${migrateCompiler}`;
      }

      filesystem.write(`${dest}/package.json`, pkg);
    }

    // ── 5. Remove vendor artifacts ──────────────────────────────────────
    if (filesystem.exists(`${dest}/scripts/vendor`)) {
      filesystem.remove(`${dest}/scripts/vendor`);
    }
    if (filesystem.exists(`${dest}/bin/migrate.js`)) {
      filesystem.remove(`${dest}/bin/migrate.js`);
      // Remove bin/ dir if empty
      const binContents = filesystem.list(`${dest}/bin`) || [];
      if (binContents.length === 0) {
        filesystem.remove(`${dest}/bin`);
      }
    }
    if (filesystem.exists(`${dest}/migration-guides`)) {
      filesystem.remove(`${dest}/migration-guides`);
    }

    // Remove migrations-utils/ts-compiler.js (vendor-mode bootstrap)
    const tsCompilerPath = `${dest}/migrations-utils/ts-compiler.js`;
    if (filesystem.exists(tsCompilerPath)) {
      const content = filesystem.read(tsCompilerPath) || '';
      // Only remove if it's the vendor-mode bootstrap (contains ts-node reference)
      if (content.includes('ts-node') || content.includes('tsconfig-paths')) {
        filesystem.remove(tsCompilerPath);
      }
    }

    // Restore extras/sync-packages.mjs if it was replaced with a stub
    const syncPkgPath = `${dest}/extras/sync-packages.mjs`;
    if (filesystem.exists(syncPkgPath)) {
      const content = filesystem.read(syncPkgPath) || '';
      if (content.includes('vendor mode') || content.includes('vendor:sync')) {
        // It's the vendor stub — remove it. The user can re-fetch from starter.
        filesystem.remove(syncPkgPath);
      }
    }

    // ── 6. Clean CLAUDE.md vendor marker ────────────────────────────────
    const claudeMdPath = `${dest}/CLAUDE.md`;
    if (filesystem.exists(claudeMdPath)) {
      let content = filesystem.read(claudeMdPath) || '';
      const marker = '<!-- lt-vendor-marker -->';
      if (content.includes(marker)) {
        // Remove everything from marker to the first `---` separator (end of vendor block)
        content = content.replace(
          new RegExp(`${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?---\\s*\\n?`, ''),
          '',
        );
        // Remove leading whitespace/newlines
        content = content.replace(/^\n+/, '');
        filesystem.write(claudeMdPath, content);
      }
    }

    // ── 7. Restore tsconfig excludes ────────────────────────────────────
    // tsconfig files use JSONC (comments + trailing commas), so we cannot
    // use `filesystem.read(path, 'json')` which calls strict `JSON.parse`.
    // Instead we do a regex-based removal of vendor-specific exclude entries.
    for (const tsconfigName of ['tsconfig.json', 'tsconfig.build.json']) {
      const tsconfigPath = `${dest}/${tsconfigName}`;
      if (!filesystem.exists(tsconfigPath)) continue;

      let raw = filesystem.read(tsconfigPath) || '';

      // Remove vendor-specific exclude entries (the string literal + optional trailing comma)
      raw = raw.replace(/,?\s*"src\/core\/modules\/migrate\/templates\/\*\*\/\*\.template\.ts"/g, '');
      raw = raw.replace(/,?\s*"src\/core\/test\/\*\*\/\*\.ts"/g, '');

      // Clean up potential double commas or trailing commas before ]
      raw = raw.replace(/,\s*,/g, ',');
      raw = raw.replace(/,\s*]/g, ']');

      filesystem.write(tsconfigPath, raw);
    }

    // ── 8. Remove .gitignore vendor entries ──────────────────────────────
    const gitignorePath = `${dest}/.gitignore`;
    if (filesystem.exists(gitignorePath)) {
      let content = filesystem.read(gitignorePath) || '';
      content = content
        .split('\n')
        .filter(
          (line: string) =>
            !line.includes('scripts/vendor/sync-results') && !line.includes('scripts/vendor/upstream-candidates'),
        )
        .join('\n');
      filesystem.write(gitignorePath, content);
    }

    // ── Post-conversion verification ──────────────────────────────────────
    //
    // Scan all consumer files for stale relative imports that still resolve
    // to the (now deleted) src/core/ directory. These would be silent
    // compile errors.
    const staleRelativeImports = this.findStaleImports(
      dest,
      '../core',
      /['"]\.\.?\/[^'"]*core['"]|from\s+['"]\.\.?\/[^'"]*core['"]/,
    );
    if (staleRelativeImports.length > 0) {
      const { print } = this.toolbox;
      print.warning(
        `⚠ ${staleRelativeImports.length} file(s) still contain relative core imports after npm conversion:`,
      );
      for (const f of staleRelativeImports.slice(0, 10)) {
        print.info(`  ${f}`);
      }
      print.info("These imports must be manually rewritten to '@lenne.tech/nest-server'.");
    }
  }

  /**
   * Scans consumer source files for import specifiers that should have been
   * rewritten by a mode conversion. Returns a list of file paths that still
   * contain matches.
   *
   * @param dest      Project root directory
   * @param needle    Literal string to search for (used when no regex provided)
   * @param pattern   Optional regex for more flexible matching
   */
  private findStaleImports(dest: string, needle: string, pattern?: RegExp): string[] {
    const globs = [
      `${dest}/src/server/**/*.ts`,
      `${dest}/src/main.ts`,
      `${dest}/src/config.env.ts`,
      `${dest}/tests/**/*.ts`,
      `${dest}/migrations/**/*.ts`,
      `${dest}/scripts/**/*.ts`,
    ];
    const stale: string[] = [];
    for (const glob of globs) {
      const files =
        this.filesystem.find(dest, {
          matching: glob.replace(`${dest}/`, ''),
          recursive: true,
        }) || [];
      for (const file of files) {
        const content = this.filesystem.read(file) || '';
        if (pattern ? pattern.test(content) : content.includes(needle)) {
          stale.push(file.replace(`${dest}/`, ''));
        }
      }
    }
    return stale;
  }

  /**
   * Checks whether an import specifier resolves to the vendored core directory.
   * Used during vendor→npm import rewriting.
   */
  private isVendoredCoreImport(specifier: string, fromFilePath: string, coreAbsPath: string): boolean {
    if (!specifier.startsWith('.')) return false;
    const path = require('path');
    const resolved = path.resolve(path.dirname(fromFilePath), specifier);
    // Match if the resolved path IS the core dir or is inside it
    // (e.g., '../../../core' resolves to src/core, '../../../core/index' resolves to src/core/index)
    return resolved === coreAbsPath || resolved.startsWith(coreAbsPath + path.sep);
  }
}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.server = new Server(toolbox);
};
