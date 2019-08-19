import { GluegunToolbox } from 'gluegun'

/**
 * Common helper functions
 */
export class Helper {
  /**
   * String with minutes and seconds
   */
  public msToMinutesAndSeconds(ms: number) {
    const minutes = Math.floor((ms / 1000 / 60) << 0)
    const seconds = Math.floor((ms / 1000) % 60)
    return minutes + ':' + (seconds < 10 ? '0' : '') + seconds
  }
}

/**
 * Extend toolbox
 */
export default (toolbox: GluegunToolbox) => {
  toolbox.helper = new Helper()
}
