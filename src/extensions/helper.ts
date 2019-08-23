import * as fs from 'fs'
import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox'

/**
 * Common helper functions
 */
export class Helper {
  /**
   * Constructor for integration of toolbox
   */
  constructor(protected toolbox: ExtendedGluegunToolbox) {}

  /**
   * Get input if not set
   */
  public async getInput(
    input: string,
    options?: {
      initial?: string
      name?: string
      errorMessage?: string
      showError?: boolean
    }
  ) {
    // Process options
    const opts = Object.assign(
      {
        initial: '',
        name: 'name',
        showError: false
      },
      options
    )
    if (!opts.errorMessage) {
      opts.errorMessage = `You must provide a valid ${opts.name}!`
    }

    // Toolbox features
    const {
      print: { error },
      prompt: { ask }
    } = this.toolbox

    // Get input
    if (!input || !this.trim(input)) {
      const answers = await ask({
        initial: opts.initial,
        type: 'input',
        name: 'input',
        message: `Enter ${opts.name}`
      })
      input = answers.input
      if (!input && opts.showError) {
        error(opts.errorMessage)
      }

      // Return input
      return input
    }
  }

  /**
   * String with minutes and seconds
   */
  public msToMinutesAndSeconds(ms: number) {
    const minutes = Math.floor((ms / 1000 / 60) << 0)
    const seconds = Math.floor((ms / 1000) % 60)
    return minutes + ':' + (seconds < 10 ? '0' : '') + seconds
  }

  /**
   * Read a file
   */
  public readFile(path: string) {
    return new Promise((resolve, reject) => {
      fs.readFile(path, (err, data) => {
        if (err) {
          reject(err)
        } else {
          if (path.endsWith('.json')) {
            resolve(JSON.parse(data.toString()))
          } else {
            resolve(data)
          }
        }
      })
    })
  }

  /**
   * Trim and remove linebreaks from input
   */
  public trim(input: string) {
    // Check input
    if (!input) {
      return input
    }

    // Trim input
    return input.trim().replace(/(\r\n|\n|\r)/gm, '')
  }

  /**
   * Command selector
   *
   * Hint: this doesn't exists in this context!
   * If you want to use external functions, use toolbox instead (e.g. toolbox.helper.trim)
   */
  public async commandSelector(
    toolbox: ExtendedGluegunToolbox,
    options?: {
      level?: number
      parentCommand?: string
      welcome?: string
    }
  ) {
    // Toolbox feature
    const {
      helper,
      print,
      prompt,
      runtime: { commands }
    } = toolbox

    // Prepare parent command
    const pC = options.parentCommand ? options.parentCommand.trim() : ''

    // Process options
    const { level, parentCommand, welcome } = Object.assign(
      {
        level: pC ? pC.split(' ').length : 0,
        parentCommand: '',
        welcome: pC
          ? pC.charAt(0).toUpperCase() + pC.slice(1) + ' commands'
          : ''
      },
      options
    )

    // Welcome
    if (welcome) {
      print.info(print.colors.cyan(welcome))
    }

    // Get main commands
    let mainCommands = commands
      .filter(
        c =>
          c.commandPath.length === level + 1 &&
          c.commandPath.join(' ').startsWith(parentCommand) &&
          !['lt', 'help'].includes(c.commandPath[0])
      )
      .map(
        c => c.commandPath[level] + (c.description ? ` (${c.description})` : '')
      )
      .sort()

    // Additions commands
    mainCommands = ['[ help ]'].concat(mainCommands)
    if (level) {
      mainCommands.push('[ back ]')
    }
    mainCommands.push('[ cancel ]')

    // Select command
    const { commandName } = await prompt.ask({
      type: 'select',
      name: 'commandName',
      message: 'Select command',
      choices: mainCommands.slice(0)
    })

    // Check command
    if (!commandName) {
      print.error('No command selected!')
      return
    }

    switch (commandName) {
      case '[ back ]': {
        await helper.commandSelector(toolbox, {
          parentCommand: parentCommand.substr(0, parentCommand.lastIndexOf(' '))
        })
        return
      }
      case '[ cancel ]': {
        print.info('Take care :-)')
        return
      }
      case '[ help ]': {
        ;(print.printCommands as any)(
          toolbox,
          level ? parentCommand.split(' ') : undefined
        )
        break
      }
      default: {
        // Get command
        const command = commands.filter(
          c =>
            c.commandPath.join(' ') ===
            `${parentCommand} ${commandName}`.trim().replace(/\s\(.*\)$/, '')
        )[0]

        // Run command
        command.run(toolbox)
      }
    }
  }
}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.helper = new Helper(toolbox)
}
