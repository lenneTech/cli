import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * Npm commands
 */
module.exports = {
  name: 'npm',
  alias: ['n'],
  description: 'Npm commands',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper: { commandSelector }
    } = toolbox
    await commandSelector(toolbox, { parentCommand: 'npm' })
    return 'npm'
  }
}
