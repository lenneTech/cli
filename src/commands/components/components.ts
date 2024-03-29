import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Components commands
 */
module.exports = {
    name: 'components',
    alias: ['n'],
    description: 'Base components for Nuxt',
    hidden: true,
    run: async (toolbox: ExtendedGluegunToolbox) => {
        await toolbox.helper.showMenu('components');
        return 'components';
    },
};
