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
  };

  // Specific types for properties in input fields
  inputFieldTypes: Record<string, string> = {
    File: 'GraphQLUpload',
    FileInfo: 'GraphQLUpload',
    Id: 'String',
    ID: 'String',
    ObjectId: 'String',
    Upload: 'GraphQLUpload',
  };

  // Specific types for properties in input classes
  inputClassTypes: Record<string, string> = {
    File: 'FileUpload',
    FileInfo: 'FileUpload',
    Id: 'string',
    ID: 'string',
    ObjectId: 'string',
    Upload: 'FileUpload',
  };

  // Specific types for properties in model fields
  modelFieldTypes: Record<string, string> = {
    File: 'CoreFileInfo',
    FileInfo: 'CoreFileInfo',
    ID: 'String',
    Id: 'String',
    ObjectId: 'String',
    Upload: 'CoreFileInfo',
  };

  // Specific types for properties in model class
  modelClassTypes: Record<string, string> = {
    File: 'CoreFileInfo',
    FileInfo: 'CoreFileInfo',
    ID: 'string',
    Id: 'string',
    ObjectId: 'string',
    Upload: 'CoreFileInfo',
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
      const isArray = item.isArray;
      const modelClassType =
        this.modelClassTypes[this.pascalCase(item.type)] ||
        (this.standardTypes.includes(item.type) ? item.type : this.pascalCase(item.type));
      const type = this.standardTypes.includes(item.type) ? item.type : this.pascalCase(item.type);
      if (!this.standardTypes.includes(type) && type !== 'ObjectId') {
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
   * ${propName + (modelName ? ' of ' + this.pascalCase(modelName) : '')}
   */
  @Restricted(RoleEnum.S_EVERYONE)
  @Field(() => ${(isArray ? '[' : '') + reference + (isArray ? ']' : '')}, {
    description: '${propName + (modelName ? ' of ' + this.pascalCase(modelName) : '')}',
    nullable: ${item.nullable},
  })
  @Prop(${
    reference
      ? (isArray ? '[' : '') + `{ type: Schema.Types.ObjectId, ref: '${reference}' }` + (isArray ? ']' : '')
      : ''
  })
  ${propName}: ${
        modelClassType + (isArray ? '[]' : '') + (reference ? ' | ' + reference + (isArray ? '[]' : '') : '')
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
      mappings: mappingsResult.length ? `mapClasses(input, {${mappingsResult.join(', ')}}, this);` : 'this;',
    };
  }

  /**
   * Create template string for properties in input
   */
  propsForInput(
    props: Record<string, ServerProps>,
    options?: { modelName?: string; nullable?: boolean }
  ): { props: string; imports: string } {
    // Preparations
    const config = { useDefault: true, ...options };
    const { modelName, nullable, useDefault } = config;
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
        const inputFieldType = this.inputFieldTypes[this.pascalCase(item.type)] || this.pascalCase(item.type);
        const inputClassType =
          this.inputClassTypes[this.pascalCase(item.type)] ||
          (this.standardTypes.includes(item.type) ? item.type : this.pascalCase(item.type));
        if (this.imports[inputFieldType]) {
          imports[inputFieldType] = this.imports[inputFieldType];
        }
        if (this.imports[inputClassType]) {
          imports[inputClassType] = this.imports[inputClassType];
        }
        result += `    
  /**
   * ${this.pascalCase(name) + (modelName ? ' of ' + this.pascalCase(modelName) : '')}
   */
  @Restricted(RoleEnum.S_EVERYONE)
  @Field(() => ${(item.isArray ? '[' : '') + inputFieldType + (item.isArray ? ']' : '')}, {
    description: '${this.pascalCase(name) + (modelName ? ' of ' + this.pascalCase(modelName) : '')}',
    nullable: ${nullable || item.nullable},
  })${nullable || item.nullable ? '\n  @IsOptional()' : ''}
  ${this.camelCase(name)}: ${inputClassType + (item.isArray ? '[]' : '')} = undefined;
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
