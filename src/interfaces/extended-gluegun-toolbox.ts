import { Helper } from '@lenne.tech/cli-plugin-helper'
import { GluegunToolbox } from 'gluegun'
import { Git } from '../extensions/git'
import { Npm } from '../extensions/npm'
import { Typescript } from '../extensions/typescript'

/**
 * Extended GluegunToolbox
 */
export interface ExtendedGluegunToolbox extends GluegunToolbox {
  git: Git
  helper: Helper
  npm: Npm
  typescript: Typescript
}
