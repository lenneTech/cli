import { GluegunCommand, GluegunToolbox } from 'gluegun'
import { join } from 'path'

/**
 * Reinitialize npm packages
 */
const NewCommand: GluegunCommand = {
  name: 'reinit',
  alias: ['r'],
  description: 'Reinitialize npm packages',
  hidden: false,
  run: async (toolbox: GluegunToolbox) => {
    // Retrieve the tools we need
    const {
      helper,
      filesystem,
      print: { error, spin, success },
      prompt,
      system
    } = toolbox

    // Start timer
    const timer = system.startTimer()

    // Check
    const packagePath = join(filesystem.cwd(), 'package.json')
    if (!filesystem.exists(packagePath)) {
      error('No package.json in current directory')
      return
    }

    // Update packages
    const update = await prompt.confirm(
      'Update package.json before reinitialization?'
    )
    if (update) {
      const updateSpin = spin('Update package.json')
      if (!system.which('ncu')) {
        const installSpin = spin('Install ncu')
        await system.run('npm i -g npm-check-updates')
        installSpin.succeed()
      }
      await system.run('ncu -u --packageFile ' + packagePath)
      updateSpin.succeed()
    }

    // Reinitialize
    const reinitSpin = spin('Reinitialize npm packages')
    try {
      await system.run('npm run reinit')
      reinitSpin.succeed()
    } catch (e) {
      if (system.which('rimraf')) {
        await system.run('npm i -g rimraf')
      }
      await system.run(
        'rimraf package-lock.json && rimraf node_modules && npm cache clean --force && npm i'
      )
      reinitSpin.succeed()
      const testSpin = spin('Run tests')
      try {
        await system.run('npm run test:e2e')
      } catch (e) {
        await system.run('npm run test')
      }
      testSpin.succeed()
    }

    // Success info
    success(
      'Reinitialized npm packages in ' + helper.msToMinutesAndSeconds(timer())
    )

    // For tests
    return `new server ${toolbox.parameters.first}`
  }
}

export default NewCommand
