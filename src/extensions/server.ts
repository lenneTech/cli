import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';
import { ServerProps } from '../interfaces/ServerProps.interface';

/**
 * Server helper functions
 */
export class Server {
  camelCase: (value: string) => string;
  kebabCase: (value: string) => string;
  pascalCase: (value: string) => string;

  imports: Record<string, string> = {
    CoreFileInfo: "import { CoreFileInfo } from '@lenne.tech/nest-server';",
    GraphQLUpload: "import * as GraphQLUpload from 'graphql-upload/GraphQLUpload.js';",
    FileUpload: "import type { FileUpload } from 'graphql-upload/processRequest.js';",
  };

  inputFieldTypes: Record<string, string> = {
    File: 'GraphQLUpload',
    FileInfo: 'GraphQLUpload',
    Id: 'String',
    ID: 'String',
    ObjectId: 'String',
    Upload: 'GraphQLUpload',
  };

  inputClassTypes: Record<string, string> = {
    File: 'FileUpload',
    FileInfo: 'FileUpload',
    Id: 'String',
    ID: 'String',
    ObjectId: 'String',
    Upload: 'FileUpload',
  };

  modelClassTypes: Record<string, string> = {
    File: 'CoreFileInfo',
    FileInfo: 'CoreFileInfo',
    ID: 'Types.ObjectId',
    Id: 'Types.ObjectId',
    ObjectId: 'Types.ObjectId',
    Upload: 'CoreFileInfo',
  };

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
  ): { props: string; imports: string } {
    // Preparations
    const config = { useDefault: true, ...options };
    const { modelName, useDefault } = config;
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
        };
      }
    }

    // Process configuration
    const imports = {};
    for (const [name, item] of Object.entries<ServerProps>(props)) {
      const modelClassType = this.modelClassTypes[this.pascalCase(item.type)] || this.pascalCase(item.type);
      if (this.imports[modelClassType]) {
        imports[modelClassType] = this.imports[modelClassType];
      }
      result += `  
  /**
   * ${this.pascalCase(name) + (modelName ? ' of ' + this.pascalCase(modelName) : '')}
   */
  @Field(() => ${(item.isArray ? '[' : '') + modelClassType + (item.isArray ? ']' : '')}, {
    description: '${this.pascalCase(name) + (modelName ? ' of ' + this.pascalCase(modelName) : '')}',
    nullable: ${item.nullable},
  })
  @Prop(${item.reference ? `{ type: Schema.Types.ObjectId, ref: '${modelClassType}' }` : ''})
  ${this.camelCase(name)}: ${modelClassType + (item.isArray ? '[]' : '')} = undefined;
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
        };
      }

      // Process configuration
      const imports = {};
      for (const [name, item] of Object.entries<ServerProps>(props)) {
        const inputFieldType = this.inputFieldTypes[this.pascalCase(item.type)] || this.pascalCase(item.type);
        const inputClassType = this.inputClassTypes[this.pascalCase(item.type)] || this.pascalCase(item.type);
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
