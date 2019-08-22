import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * TypeScript commands
 */
module.exports = {
  name: 'ts',
  description: 'Typescript commands',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper: { commandSelector }
    } = toolbox
    await commandSelector(toolbox, {
      level: 1,
      parentCommand: 'ts',
      welcome: 'TypeScript commands'
    })
    return 'ts'
  }
}
