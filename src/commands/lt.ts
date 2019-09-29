import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

/**
 * Welcome to lenne.Tech CLI
 */
module.exports = {
  name: 'lt',
  description: 'Welcome to lenne.Tech CLI',
  hidden: true,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    const { helper } = toolbox;
    await helper.commandSelector(toolbox, {
      level: 0,
      welcome: 'Welcome to lenne.Tech CLI ' + toolbox.meta.version()
    });
    return 'lt';
  }
};
