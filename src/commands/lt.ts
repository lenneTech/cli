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
      helper,
      updateHelper,
      prompt: { ask },
      print: { info }
    } = toolbox

    const updateAvailable = await toolbox.meta.checkForUpdate()

    if (updateAvailable) {
      info(`Update available: ${updateAvailable}`)

      let update = (await ask({
        type: 'select',
        name: 'update',
        message: 'Do you want to update @lenne.tech/cli?',
        choices: ['Yeah, I cant wait to see it.', 'Nope, Im busy right now.']
      })).update

      if (update && update.includes('Yeah')) {
        await updateHelper.runUpdate()
        return
      } else if (update && update.includes('Nope')) {
        info(`Bad choice, please reconsider. 😢`)
      }
    }

    await helper.commandSelector(toolbox, {
      level: 0,
      welcome: 'Welcome to lenne.Tech CLI ' + toolbox.meta.version()
    })
    return 'lt'
  }
}
