import { GluegunCommand } from 'gluegun'
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * Create a new branch
 */
const NewCommand: GluegunCommand = {
  name: 'playground',
  alias: ['pg'],
  description: 'Create a new typescript playground',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      typescript,
      print: { error },
      prompt: { ask }
    } = toolbox

    const choices = [
      'StackBlitz (online)',
      'Web-Maker (download)',
      'Simple typescript project'
    ]

    // Select type
    const { type } = await ask({
      type: 'select',
      name: 'type',
      message: 'Select',
      choices: choices.slice(0)
    })

    switch (type) {
      case choices[0]: {
        await typescript.stackblitz()
        break
      }
      case choices[1]: {
        await typescript.webmaker()
        break
      }
      case choices[2]: {
        await typescript.create()
        break
      }
      default: {
        error('No option selected!' + type)
        return
      }
    }

    // For tests
    return `typescript`
  }
}

export default NewCommand
