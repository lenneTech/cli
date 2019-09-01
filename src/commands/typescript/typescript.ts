import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * TypeScript commands
 */
module.exports = {
  name: 'typescript',
  alias: ['ts'],
  description: 'Typescript commands',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper: { commandSelector }
    } = toolbox
    await commandSelector(toolbox, {
      parentCommand: 'typescript',
      welcome: 'TypeScript commands'
    })
    return 'typescript'
  }
}
