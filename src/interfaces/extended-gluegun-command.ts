import { GluegunCommand } from 'gluegun';

import { ExtendedGluegunToolbox } from './extended-gluegun-toolbox';

export interface ExtendedGluegunCommand extends GluegunCommand {
  run: (
    toolbox: ExtendedGluegunToolbox,
    options?: {
      currentItem?: string;
      objectsToAdd?: { object: string; property: string }[];
      preventExitProcess?: boolean;
      referencesToAdd?: { property: string; reference: string }[];
    },
  ) => Promise<any>;
}
