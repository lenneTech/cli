import { GluegunCommand } from 'gluegun';
import { ExtendedGluegunToolbox } from './extended-gluegun-toolbox';

export interface ExtendedGluegunCommand extends GluegunCommand {
  run: (toolbox: ExtendedGluegunToolbox, refArr?: string[], currentRef?: string) => void;
}
