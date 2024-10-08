import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox';

/**
 * Welcome to lenne.Tech CLI
 */
module.exports = {
  description: 'Welcome to lenne.Tech CLI',
  hidden: true,
  name: 'lt',
  run: async (toolbox: ExtendedGluegunToolbox) => {
    await toolbox.helper.showMenu(null, { headline: `Welcome to lenne.Tech CLI ${toolbox.meta.version()}` });
    return 'lt';
  },
};
