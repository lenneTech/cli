import { IHelperExtendedGluegunToolbox } from '@lenne.tech/cli-plugin-helper';

import { Git } from '../extensions/git';
import { Server } from '../extensions/server';
import { Tools } from '../extensions/tools';
import { Typescript } from '../extensions/typescript';

/**
 * Extended GluegunToolbox
 */
export interface ExtendedGluegunToolbox extends IHelperExtendedGluegunToolbox {
  git: Git;
  server: Server;
  tools: Tools;
  typescript: Typescript;
}
