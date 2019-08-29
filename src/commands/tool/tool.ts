import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * Tool commands
 */
module.exports = {
  name: 'tool',
  alias: ['t'],
  description: 'Tool commands',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper: { commandSelector }
    } = toolbox
    await commandSelector(toolbox, { parentCommand: 'tool' })
    return 'tool'
  }
}
