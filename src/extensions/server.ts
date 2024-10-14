import * as crypto from 'crypto';
import { GluegunFilesystem } from 'gluegun';
import { PromptOptions } from 'gluegun/build/types/toolbox/prompt-enquirer-types';
import { GluegunAskResponse, GluegunEnquirer } from 'gluegun/build/types/toolbox/prompt-types';
import { join } from 'path';

import { ServerProps } from '../interfaces/ServerProps.interface';
import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

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
  }

  /**
   * Construct the addition for the create.input.ts
   */
  constructCreateInputPatchString(propObj: ServerProps, moduleToEdit: string): string {
    return `\n
  /**
   * ${this.pascalCase(propObj.name)} of ${this.pascalCase(moduleToEdit)}
   */
  @Restricted(RoleEnum.ADMIN)
  @Field(() => ${propObj.isArray ? `[${propObj.type
  === 'ObjectId' ? propObj.reference : this.pascalCase(propObj.type)}]` : propObj.type
  === 'ObjectId' ? propObj.reference : this.pascalCase(propObj.type)}, {
    description: '${this.pascalCase(propObj.name)} of ${this.pascalCase(moduleToEdit)}',
    nullable: ${propObj.nullable},
  })
  ${propObj.nullable ? '@IsOptional()' : ''}${propObj.nullable ? '\n' : ''}  override ${propObj.name}${propObj.nullable ? '?' : ''}: ${propObj.isArray ? `${propObj.type
  === 'ObjectId' ? propObj.reference : this.pascalCase(propObj.type)}[]` : propObj.type
  === 'ObjectId' ? propObj.reference : this.pascalCase(propObj.type)} = undefined;`;
  }

  /**
   * Construct the Addition for the normal input.ts
   */
  constructInputPatchString(propObj: ServerProps, moduleToEdit: string): string {

    const fieldType = propObj.isArray
      ? `[${propObj.type === 'ObjectId' ? propObj.reference : this.pascalCase(propObj.type)}]`
      : propObj.type === 'ObjectId'
        ? propObj.reference
        : this.pascalCase(propObj.type);

    return `\n
  /**
   * ${this.pascalCase(propObj.name)} of ${this.pascalCase(moduleToEdit)}
   */
  @Restricted(RoleEnum.ADMIN)
  @Field(() => ${fieldType}, {
    description: '${this.pascalCase(propObj.name)} of ${this.pascalCase(moduleToEdit)}',
    nullable: ${propObj.nullable},
  })
  ${propObj.nullable ? '@IsOptional()' : ''}${propObj.nullable ? '\n' : ''}  override ${propObj.name}${propObj.nullable ? '?' : ''}: ${propObj.isArray ? `${propObj.type
    === 'ObjectId' ? propObj.reference : this.pascalCase(propObj.type)}[]` : propObj.type
    === 'ObjectId' ? propObj.reference : this.pascalCase(propObj.type)} = undefined;
  `;
  }

  /**
   * Construct the addition for the Model
   */
  constructModelPatchString(propObj: ServerProps, moduleToEdit: string): string {
    return `\n
  /**
   * ${this.pascalCase(propObj.name)} of ${this.pascalCase(moduleToEdit)}
   */
  @Restricted(RoleEnum.ADMIN)
  @Field(() => ${propObj.isArray ? `[${propObj.type
    === 'ObjectId' ? propObj.reference : this.pascalCase(propObj.type)}]` : propObj.type
    === 'ObjectId' ? propObj.reference : this.pascalCase(propObj.type)}, {
    description: '${this.pascalCase(propObj.name)} of ${this.pascalCase(moduleToEdit)}',
    nullable: ${propObj.nullable},
  })
  @Prop(${propObj.type === 'ObjectId' ? `{ ref: ${propObj.reference}, type: Schema.Types.ObjectId }` : ''})
  ${propObj.name}: ${propObj.isArray ? `${propObj.type
    === 'ObjectId' ? propObj.reference : this.pascalCase(propObj.type)}[]` : propObj.type
    === 'ObjectId' ? propObj.reference : this.pascalCase(propObj.type)} = undefined;`;
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
  @Prop([String])
  properties: string[] = undefined;

  /**
   * User how has tested the ${this.pascalCase(modelName)}
   */
  @Field(() => User, {
    description: 'User who has tested the ${this.pascalCase(modelName)}',
    nullable: true,
  })
  @Prop({ type: Schema.Types.ObjectId, ref: 'User' })
  testedBy: User = undefined;
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
      const modelFieldType = enumRef
        ? 'String'
        : this.modelFieldTypes[this.pascalCase(item.type)] || this.pascalCase(item.type);
      const isArray = item.isArray;
      const modelClassType
        = this.modelClassTypes[this.pascalCase(item.type)]
        || (this.standardTypes.includes(item.type) ? item.type : this.pascalCase(item.type));
      const type = this.standardTypes.includes(item.type) ? item.type : this.pascalCase(item.type);
      if (!this.standardTypes.includes(type) && type !== 'ObjectId' && type !== 'Enum' && type !== 'Json') {
        mappings[propName] = type;
      }
      if (reference) {
        mappings[propName] = reference;
      }
      if (this.imports[modelClassType]) {
        imports[modelClassType] = this.imports[modelClassType];
      }
      result += `
  /**
   * ${this.pascalCase(propName) + (modelName ? ` of ${this.pascalCase(modelName)}` : '')}
   */
  @Restricted(RoleEnum.S_EVERYONE)
  @Field(() => ${(isArray ? '[' : '') + (reference ? reference : modelFieldType) + (isArray ? ']' : '')}, {
    description: '${this.pascalCase(propName) + (modelName ? ` of ${this.pascalCase(modelName)}` : '')}',
    nullable: ${item.nullable},
  })
  @Prop(${
        reference
          ? `${isArray ? '[' : ''}{ ref: '${reference}', type: Schema.Types.ObjectId }${isArray ? ']' : ''}`
          : schema
            ? `${isArray ? '[' : ''}{ type: ${schema}Schema }${isArray ? ']' : ''}`
            : enumRef
              ? `${isArray ? '[' : ''}{ enum: ${item.nullable ? `Object.values(${enumRef}).concat([null])` : enumRef}, type: String }${isArray ? ']' : ''}`
              : type === 'Json'
                ? `${isArray ? '[' : ''}{ type: Object }${isArray ? ']' : ''}`
                : ''
      })
  ${propName}: ${
        (reference ? reference : enumRef || modelClassType) + (isArray ? '[]' : '')
        // (reference ? ' | ' + reference + (isArray ? '[]' : '') : '')
      } = undefined;
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
  properties: string[] = undefined;

  /**
   * User how has tested the ${this.pascalCase(modelName)}
   */
  @Field(() => User, {
    description: 'User who has tested the ${this.pascalCase(modelName)}',
    nullable: ${config.nullable},
  })
  testedBy: User = undefined;
  `,
        };
      }

      // Process configuration
      const imports = {};
      for (const [name, item] of Object.entries<ServerProps>(props)) {
        let inputFieldType
          = this.inputFieldTypes[this.pascalCase(item.type)]
          || (item.enumRef
            ? this.pascalCase(item.enumRef)
            : this.pascalCase(item.type) + (create ? 'CreateInput' : 'Input'));
        inputFieldType = this.modelFieldTypes[item.type]
          ? this.modelFieldTypes[item.type]
          : inputFieldType;
        const inputClassType
          = this.inputClassTypes[this.pascalCase(item.type)]
          || (this.standardTypes.includes(item.type)
            ? item.type
            : item.enumRef
              ? this.pascalCase(item.enumRef)
              : this.pascalCase(item.type) + (create ? 'CreateInput' : 'Input'));
        const propertySuffix = this.propertySuffixTypes[this.pascalCase(item.type)] || '';
        const overrideFlag = create ? 'override ' : '';
        if (this.imports[inputFieldType]) {
          imports[inputFieldType] = this.imports[inputFieldType];
        }
        if (this.imports[inputClassType]) {
          imports[inputClassType] = this.imports[inputClassType];
        }
        result += `
  /**
   * ${this.pascalCase(name) + propertySuffix + (modelName ? ` of ${this.pascalCase(modelName)}` : '')}
   */
  @Restricted(RoleEnum.S_EVERYONE)
  @Field(() => ${(item.isArray ? '[' : '') + inputFieldType + (item.isArray ? ']' : '')}, {
    description: '${this.pascalCase(name) + propertySuffix + (modelName ? ` of ${this.pascalCase(modelName)}` : '')}',
    nullable: ${nullable || item.nullable},
  })${nullable || item.nullable ? '\n  @IsOptional()' : ''}
  ${overrideFlag + this.camelCase(name)}${nullable || item.nullable ? '?' : ''}: ${
          inputClassType + (item.isArray ? '[]' : '')
        } = undefined;
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
    // Matches SECRET_OR_PRIVATE_KEY then any amount of anything until there is a '
    const regex = /SECRET_OR_PRIVATE_KEY[^']*/gm;

    const count = (str, pattern) => {
      const re = new RegExp(pattern, 'gi');
      return ((str || '').match(re) || []).length;
    };

    const secretArr: string[] = [];

    // -1 because we don't need to replace the first occurrence.
    for (let i = 0; i < count(configContent, regex) - 1; i++) {
      secretArr.push(crypto.randomBytes(512).toString('base64'));
    }

    // Getting the config content and using native ts to replace the content, patching.update doesn't accept regex
    let secretIndex = 0;
    let occurrenceCount = 0;

    return configContent.replace(regex, (match) => {
      occurrenceCount++;

      // Skip the first occurrence
      if (occurrenceCount === 1) {
        return match;
      }

      const secret = secretArr[secretIndex];
      secretIndex++;
      return secret;
    });
  }

}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.server = new Server(toolbox);
};
