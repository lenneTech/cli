import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox'

/**
 * Welcome to lenne.Tech CLI
 */
module.exports = {
  name: 'lt',
  description: 'Welcome to lenne.Tech CLI',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const { print } = toolbox
    print.info(print.colors.cyan('Welcome to lenne.Tech CLI'))
    print.printHelp(toolbox)
  }
}
