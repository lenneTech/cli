import { GluegunToolbox } from 'gluegun'

/**
 * Welcome to lenne.Tech CLI
 */
module.exports = {
  name: 'lt',
  description: 'Welcome to lenne.Tech CLI',
  hidden: true,
  run: async (toolbox: GluegunToolbox) => {
    const { print } = toolbox
    print.info(print.colors.cyan('Welcome to lenne.Tech CLI'));
    print.printHelp(toolbox);
  },
}
