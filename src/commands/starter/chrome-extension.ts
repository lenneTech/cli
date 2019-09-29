import { GluegunCommand } from 'gluegun'
import { ExtendedGluegunToolbox } from '../../interfaces/extended-gluegun-toolbox'

/**
 * Create a new TypeScript project
 */
const NewCommand: GluegunCommand = {
  name: 'chrome-extension',
  alias: ['ce'],
  description: 'Creates a new Chrome extension',
  hidden: false,
  run: async (toolbox: ExtendedGluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      git,
      helper,
      meta,
      parameters,
      patching,
      print: { error, info, spin, success },
      strings: { kebabCase },
      system
    } = toolbox

    // Start timer
    const timer = system.startTimer()

    // Info
    info('Create a new Chrome extension project')

    // Check git
    if (!(await git.gitInstalled())) {
      return
    }

    // Get name
    const name = await helper.getInput(parameters.first, {
      name: 'Project name',
      showError: true
    })
    if (!name) {
      return
    }

    // Set project directory
    const projectDir = kebabCase(name)

    // Check if directory already exists
    if (filesystem.exists(projectDir)) {
      info(``)
      error(`There's already a folder named "${projectDir}" here.`)
      return undefined
    }

    // Clone git repository
    const cloneSpinner = spin(
      'Clone https://github.com/lenneTech/chrome-extension-angular-starter.git'
    )
    await system.run(
      `git clone https://github.com/lenneTech/chrome-extension-angular-starter.git ${projectDir}`
    )
    if (filesystem.isDirectory(`./${projectDir}`)) {
      filesystem.remove(`./${projectDir}/.git`)
      cloneSpinner.succeed(
        'Repository cloned from https://github.com/lenneTech/chrome-extension-angular-starter.git'
      )
    }

    // Check directory
    if (!filesystem.isDirectory(`./${projectDir}`)) {
      error(`The directory "${projectDir}" could not be created.`)
      return undefined
    }

    // Get author
    const author = await helper.getInput(parameters.second, {
      name: 'Author',
      showError: false
    })

    const prepareSpinner = spin('Prepare files')

    // Set up initial props (to pass into templates)
    const nameKebab = kebabCase(name)

    // Patch readme
    await patching.replace(
      `./${projectDir}/README.md`,
      '# Starter for Chrome Extension via Angular',
      `# ${name}`
    )
    await patching.replace(
      `./${projectDir}/README.md`,
      'This is the lenne.Tech starter for new Chrome Extension via Angular.',
      ''
    )

    // Set package.json
    await patching.update(`./${projectDir}/package.json`, config => {
      config.author = author
      config.bugs = {
        url: ''
      }
      config.description = name
      config.homepage = ''
      config.name = nameKebab
      config.repository = {
        type: 'git',
        url: ''
      }
      config.version = '0.0.1'
      return config
    })

    // Set package.json
    await patching.update(`./${projectDir}/package-lock.json`, config => {
      config.name = nameKebab
      config.version = '0.0.1'
      return config
    })

    // Set manifest.json
    await patching.update(
      `./${projectDir}/angular/src/manifest.json`,
      config => {
        config.name = name
        config.short_name = name
        config.description = ''
        return config
      }
    )

    // Patch app component
    await patching.replace(
      `./${projectDir}/angular/src/app/app.component.html`,
      'Chrome Extension Starter',
      name
    )
    await patching.replace(
      `./${projectDir}/angular/src/app/app.component.html`,
      'Chrome Extension starter',
      name
    )

    prepareSpinner.succeed('Files prepared')

    // Init npm
    const installSpinner = spin('Install npm packages')
    await system.run(`cd ${projectDir} && npm i`)
    installSpinner.succeed('NPM packages installed')

    // Init git
    const initGitSpinner = spin('Initialize git')
    await system.run(
      `cd ${projectDir} && git init && git add . && git commit -am "Init via lenne.Tech CLI ${meta.version()}"`
    )
    initGitSpinner.succeed('Git initialized')

    // We're done, so show what to do next
    info(``)
    success(
      `Generated ${name} with lenne.Tech CLI ${meta.version()} in ${helper.msToMinutesAndSeconds(
        timer()
      )}m.`
    )
    info(``)

    // For tests
    return `project ${name} created`
  }
}

export default NewCommand
