import { GluegunToolbox } from 'gluegun'
import { Git } from '../extensions/git'
import { Helper } from '../extensions/helper'

/**
 * Extended GluegunToolbox
 */
export interface ExtendedGluegunToolbox extends GluegunToolbox {
  git: Git
  helper: Helper
}
