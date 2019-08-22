import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * Git commands
 */
module.exports = {
  name: 'git',
  description: 'Git commands',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper: { commandSelector }
    } = toolbox
    await commandSelector(toolbox, {
      level: 1,
      parentCommand: 'git',
      welcome: 'Git commands'
    })
    return 'git'
  }
}
