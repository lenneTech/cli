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
}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.helper = new Helper(toolbox)
}
