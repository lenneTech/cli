import { GluegunToolbox } from 'gluegun'

/**
 * Common helper functions
 */
module.exports = (toolbox: GluegunToolbox) => {
  toolbox.helper = {
    msToMinutesAndSeconds: (ms) => {
      const minutes = Math.floor((ms/1000/60) << 0);
      const seconds = Math.floor((ms/1000) % 60);
      return minutes + ":" + (seconds < 10 ? '0' : '') + seconds;
    }
  }

  // enable this if you want to read configuration in from
  // the current folder's package.json (in a "lt" property),
  // lt.config.json, etc.
  // toolbox.config = {
  //   ...toolbox.config,
  //   ...toolbox.config.loadConfig(process.cwd(), "lt")
  // }
}
