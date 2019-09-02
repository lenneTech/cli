import { Git } from '../extensions/git'
import { Npm } from '../extensions/npm'
import { Typescript } from '../extensions/typescript'
import { UpdateHelper } from '../extensions/updateHelper'
import { IHelperExtendedGluegunToolbox } from '@lenne.tech/cli-helper/src'

/**
 * Extended GluegunToolbox
 */
export interface ExtendedGluegunToolbox extends IHelperExtendedGluegunToolbox {
  git: Git
  npm: Npm
  typescript: Typescript
  updateHelper: UpdateHelper
}
