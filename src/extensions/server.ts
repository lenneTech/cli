import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';
import { ServerProps } from '../interfaces/ServerProps.interface';

/**
 * Server helper functions
 */
export class Server {
  // String manipulation functions
  camelCase: (value: string) => string;
  kebabCase: (value: string) => string;
  pascalCase: (value: string) => string;

  // Specific imports for default modells
  imports: Record<string, string> = {
    CoreFileInfo: "import { CoreFileInfo } from '@lenne.tech/nest-server';",
    GraphQLUpload: "import * as GraphQLUpload from 'graphql-upload/GraphQLUpload.js';",
    FileUpload: "import type { FileUpload } from 'graphql-upload/processRequest.js';",
    'Record<string, unknown>' : "import { JSON } from '@lenne.tech/nest-server';",
  };

  // Specific types for properties in input fields
  inputFieldTypes: Record<string, string> = {
    Boolean: 'Boolean',
    Date: 'number',
    File: 'GraphQLUpload',
    FileInfo: 'GraphQLUpload',
    Id: 'String',
    ID: 'String',
    Json: 'JSON',
    JSON: 'JSON',
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
    Id: 'string',
    ID: 'string',
    Json: 'Record<string, unknown>',
    JSON: 'Record<string, unknown>',
    Number: 'number',
    ObjectId: 'string',
    String: 'string',
    Upload: 'FileUpload',
  };

  // Specific types for properties in model fields
  modelFieldTypes: Record<string, string> = {
    Boolean: 'Boolean',
    Date: 'Number',
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
    Id: 'Id',
    ID: 'Id',
    ObjectId: 'Id',
  };

  // Standard types: primitives and default JavaScript classes
  standardTypes: string[] = ['boolean', 'string', 'number', 'Date'];

  /**
   * Constructor for integration of toolbox
   */
  constructor(protected toolbox: ExtendedGluegunToolbox) {
    this.camelCase = toolbox.strings.camelCase;
    this.kebabCase = toolbox.strings.kebabCase;
    this.pascalCase = toolbox.strings.pascalCase;
  }

  /**
   * Create template string for properties in model
   */
  propsForModel(
    props: Record<string, ServerProps>,
    options?: { modelName?: string; useDefault?: boolean }
  ): { mappings: string; imports: string; props: string } {
    // Preparations
    const config = { useDefault: true, ...options };
    const { modelName, useDefault } = config;
    let result = '';

    // Check parameters
    if (!props || !(typeof props !== 'object') || !Object.keys(props).length) {
      if (!useDefault) {
        return { props: '', imports: '', mappings: 'this;' };
      }

      // Use default
      if (!Object.keys(props).length && useDefault) {
        return {
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
          imports: '',
          mappings: 'mapClasses(input, {user: User}, this);',
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
      const modelClassType =
        this.modelClassTypes[this.pascalCase(item.type)] ||
        (this.standardTypes.includes(item.type) ? item.type : this.pascalCase(item.type));
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
   * ${this.pascalCase(propName) + (modelName ? ' of ' + this.pascalCase(modelName) : '')}
   */
  @Restricted(RoleEnum.S_EVERYONE)
  @Field(() => ${(isArray ? '[' : '') + (reference ? reference : modelFieldType) + (isArray ? ']' : '')}, {
    description: '${this.pascalCase(propName) + (modelName ? ' of ' + this.pascalCase(modelName) : '')}',
    nullable: ${item.nullable},
  })
  @Prop(${
    reference
      ? (isArray ? '[' : '') + `{ ref: '${reference}', type: Schema.Types.ObjectId }` + (isArray ? ']' : '')
      : schema
      ? (isArray ? '[' : '') + `{ type: ${schema}Schema }` + (isArray ? ']' : '')
      : enumRef
      ? (isArray ? '[' : '') + `{ enum: ${item.nullable ? `Object.values(${enumRef}).concat([null])` : enumRef}, type: String }` + (isArray ? ']' : '')
      : type === 'Json'
      ? (isArray ? '[' : '') + `{ type: Object }` + (isArray ? ']' : '')
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
      props: result,
      imports: importsResult,
      mappings: mappingsResult.length ? `mapClasses(input, { ${mappingsResult.join(', ')} }, this);` : 'this;',
    };
  }

  /**
   * Create template string for properties in input
   */
  propsForInput(
    props: Record<string, ServerProps>,
    options?: { modelName?: string; nullable?: boolean; create?: boolean }
  ): { props: string; imports: string } {
    // Preparations
    const config = { useDefault: true, ...options };
    const { modelName, nullable, create, useDefault } = config;
    let result = '';

    // Check parameters
    if (!props || !(typeof props !== 'object') || !Object.keys(props).length) {
      if (!useDefault) {
        return { props: '', imports: '' };
      }

      // Use default
      if (!Object.keys(props).length && useDefault) {
        return {
          props: `
  /**
   * Description of properties
   */
  @Restricted(RoleEnum.ADMIN, RoleEnum.S_CREATOR)
  @Field(() => [String], { description: 'Properties of ${this.pascalCase(modelName)}', nullable: ${
            config.nullable ? config.nullable : `'items'`
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
          imports: '',
        };
      }

      // Process configuration
      const imports = {};
      for (const [name, item] of Object.entries<ServerProps>(props)) {
        let inputFieldType =
          this.inputFieldTypes[this.pascalCase(item.type)] ||
          (item.enumRef
            ? this.pascalCase(item.enumRef)
            : this.pascalCase(item.type) + (create ? 'CreateInput' : 'Input'));
        inputFieldType = this.modelFieldTypes[item.type]
          ? this.modelFieldTypes[item.type]
          : inputFieldType;
        const inputClassType =
          this.inputClassTypes[this.pascalCase(item.type)] ||
          (this.standardTypes.includes(item.type)
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
   * ${this.pascalCase(name) + propertySuffix + (modelName ? ' of ' + this.pascalCase(modelName) : '')}
   */
  @Restricted(RoleEnum.S_EVERYONE)
  @Field(() => ${(item.isArray ? '[' : '') + inputFieldType + (item.isArray ? ']' : '')}, {
    description: '${this.pascalCase(name) + propertySuffix + (modelName ? ' of ' + this.pascalCase(modelName) : '')}',
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
        props: result,
        imports: importsResult,
      };
    }
  }
}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.server = new Server(toolbox);
};
