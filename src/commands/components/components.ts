import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox';

/**
 * Components commands
 */
module.exports = {
    alias: ['n'],
    description: 'Base components for Nuxt',
    hidden: true,
    name: 'components',
    run: async (toolbox: ExtendedGluegunToolbox) => {
        await toolbox.helper.showMenu('components');
        return 'components';
    },
};
