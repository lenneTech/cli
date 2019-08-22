import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox'

/**
 * Welcome to lenne.Tech CLI
 */
module.exports = {
  name: 'lt',
  description: 'Welcome to lenne.Tech CLI',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const {
      helper: { commandSelector }
    } = toolbox
    await commandSelector(toolbox, {
      level: 0,
      welcome: 'Welcome to lenne.Tech CLI ' + toolbox.meta.version()
    })
    return 'lt'
  }
}
