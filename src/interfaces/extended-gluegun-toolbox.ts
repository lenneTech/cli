import { IHelperExtendedGluegunToolbox } from '@lenne.tech/cli-plugin-helper';
import { GluegunParameters } from 'gluegun';

import { Git } from '../extensions/git';
import { ParsedPropsResult } from '../extensions/parse-properties';
import { Server } from '../extensions/server';
import { Tools } from '../extensions/tools';
import { Typescript } from '../extensions/typescript';

/**
 * Extended GluegunToolbox
 */
export interface ExtendedGluegunToolbox extends IHelperExtendedGluegunToolbox {
  git: Git;
  parseProperties: (options?: {
    argProps?: string[];
    objectsToAdd?: { object: string; property: string }[];
    parameters?: GluegunParameters;
    referencesToAdd?: { property: string; reference: string }[];
    server?: Server;
  }) => Promise<ParsedPropsResult>;
  server: Server;
  tools: Tools;
  typescript: Typescript;
}
