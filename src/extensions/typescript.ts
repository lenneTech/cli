import * as fs from 'fs'
import { join } from 'path'
import { ExtendedGluegunToolbox } from '../interfaces/extended-gluegun-toolbox'
import * as open from 'open'

/**
 * Common helper functions
 */
export class Typescript {
  /**
   * Constructor for integration of toolbox
   */
  constructor(protected toolbox: ExtendedGluegunToolbox) {}

  /**
   * Create a simple typescript project
   */
  public async create() {
    // Toolbox features
    const {
      filesystem: { cwd, existsAsync },
      helper,
      npm,
      print: { error, info, spin, success },
      system: { run, startTimer, which }
    } = this.toolbox

    // Get project name
    const name = await helper.getInput(null, {
      name: 'project name',
      showError: true
    })
    if (!name) {
      return
    }

    // Check dir
    const dir = join(cwd(), name)
    if (await existsAsync(dir)) {
      error(`Diretory ${dir} exists!`)
    }

    // Start timer
    const timer = startTimer()

    // Init
    const cloneSpin = spin(`Init project ${name}`)

    // Init gts
    fs.mkdirSync(dir)
    await run(
      `cd ${dir} && npm init -y && npx gts init && npm install -D ts-node`
    )

    // Prepare package.json
    const { path, data } = await npm.getPackageJson({
      cwd: dir,
      showError: true
    })
    if (!path) {
      return
    }
    data.scripts.start = 'npx ts-node src/index.ts'
    data.main = 'build/index.js'
    if (!(await npm.setPackageJson(data, { cwd: dir, showError: true }))) {
      return
    }

    // Overwrite index.ts
    const pathOfIndex = join(dir, 'src', 'index.ts')
    fs.unlinkSync(pathOfIndex)
    fs.writeFileSync(
      pathOfIndex,
      "// Write your code here\nconsole.log('hello world!');"
    )

    // Init git
    if (which('git')) {
      await run(`git init`)
    }

    cloneSpin.succeed()

    // Success info
    success(
      `Project ${name} was created in ${helper.msToMinutesAndSeconds(timer())}.`
    )
    info('')
  }

  /**
   * Open stackblitz
   */
  public async stackblitz() {
    return open('https://stackblitz.com/fork/typescript')
  }

  /**
   * Download and install Web-Maker
   */
  public async webmaker() {
    // Toolbox features
    const {
      filesystem: { cwd, existsAsync },
      git,
      helper,
      npm,
      print: { error, spin },
      system: { run }
    } = this.toolbox

    // Check git
    if (!(await git.gitInstalled())) {
      return
    }

    // Get project name
    const name = await helper.getInput(null, {
      name: 'project name',
      showError: true
    })
    if (!name) {
      return
    }

    // Check dir
    const dir = join(cwd(), name)
    if (await existsAsync(dir)) {
      error(`Diretory ${dir} exists!`)
    }

    // Clone
    const repository = 'https://github.com/chinchang/web-maker.git'
    const cloneSpin = spin(`Cloning web-maker: ${repository}`)
    await run(`git clone ${repository} ${dir}`)
    cloneSpin.succeed()

    // Install packages
    if (await npm.install({ cwd: dir, showError: true })) {
      return
    }

    // Start
    await run(`cd ${dir} && npm start`)
  }
}

/**
 * Extend toolbox
 */
export default (toolbox: ExtendedGluegunToolbox) => {
  toolbox.typescript = new Typescript(toolbox)
}
