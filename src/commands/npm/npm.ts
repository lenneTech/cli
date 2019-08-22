import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * Npm commands
 */
module.exports = {
  name: 'npm',
  description: 'Npm commands',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper: { commandSelector }
    } = toolbox
    await commandSelector(toolbox, {
      level: 1,
      parentCommand: 'npm',
      welcome: 'Npm commands'
    })
    return 'npm'
  }
}
