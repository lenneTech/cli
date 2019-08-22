import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * Server commands
 */
module.exports = {
  name: 'server',
  description: 'Server commands',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper: { commandSelector }
    } = toolbox
    await commandSelector(toolbox, {
      level: 1,
      parentCommand: 'server',
      welcome: 'Server commands'
    })
    return 'server'
  }
}
