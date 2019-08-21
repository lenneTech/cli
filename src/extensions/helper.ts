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
}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.helper = new Helper(toolbox)
}
