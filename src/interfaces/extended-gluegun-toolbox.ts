import { IHelperExtendedGluegunToolbox } from '@lenne.tech/cli-plugin-helper';
import { GluegunParameters } from 'gluegun';

import { ApiMode } from '../extensions/api-mode';
import { Config } from '../extensions/config';
import { FrontendHelper } from '../extensions/frontend-helper';
import { Git } from '../extensions/git';
import { History } from '../extensions/history';
import { Logger } from '../extensions/logger';
import { PackageManager } from '../extensions/package-manager';
import { ParsedPropsResult } from '../extensions/parse-properties';
import { Server } from '../extensions/server';
import { TemplateHelper } from '../extensions/template';
import { Tools } from '../extensions/tools';
import { Typescript } from '../extensions/typescript';

/**
 * Extended GluegunToolbox
 */
export interface ExtendedGluegunToolbox extends IHelperExtendedGluegunToolbox {
  apiMode: ApiMode;
  config: Config;
  frontendHelper: FrontendHelper;
  git: Git;
  history: History;
  logger: Logger;
  parseProperties: (options?: {
    argProps?: string[];
    objectsToAdd?: { object: string; property: string }[];
    parameters?: GluegunParameters;
    referencesToAdd?: { property: string; reference: string }[];
    server?: Server;
  }) => Promise<ParsedPropsResult>;
  pm: PackageManager;
  server: Server;
  templateHelper: TemplateHelper;
  tools: Tools;
  typescript: Typescript;
}
