import { GluegunCommand, GluegunToolbox } from 'gluegun'
import { join } from 'path'

/**
 * Create a new server module
 */
const NewCommand: GluegunCommand = {
  name: 'module',
  alias: ['m'],
  description: 'Creates a new server module',
  hidden: false,
  run: async (toolbox: GluegunToolbox) => {
    // Retrieve the tools we need
    const {
      filesystem,
      helper,
      parameters,
      patching,
      print: { error, info, spin, success },
      strings: { kebabCase, pascalCase, camelCase },
      system,
      template
    } = toolbox

    // Start timer
    const timer = system.startTimer()

    // Info
    info('Create a new server module')

    // Check name
    if (!parameters.first) {
      error('You must provide a valid server module name.')
      error('Example: lt server module MyNewModule')
      return undefined
    }

    // Set up initial props (to pass into templates)
    const nameCamel = camelCase(parameters.first)
    const nameKebab = kebabCase(parameters.first)
    const namePascal = pascalCase(parameters.first)

    // Check if directory
    const cwd = filesystem.cwd()
    const path = cwd.substr(0, cwd.lastIndexOf('src'))
    if (!filesystem.exists(join(path, 'src'))) {
      info(``)
      error(`No src directory in "${path}".`)
      return undefined
    }
    const moduleDir = join(path, 'src', 'server', 'modules', nameKebab)
    if (filesystem.exists(moduleDir)) {
      info(``)
      error(`Module directory "${moduleDir}" already exists.`)
      return undefined
    }

    const generateSpinner = spin('Generate files')

    // nest-server-module/inputs/xxx.input.ts
    await template.generate({
      template: 'nest-server-module/inputs/template.input.ts.ejs',
      target: join(moduleDir, 'inputs', nameKebab + '.input.ts'),
      props: { nameCamel, nameKebab, namePascal }
    })

    // nest-server-module/inputs/xxx-create.input.ts
    await template.generate({
      template: 'nest-server-module/inputs/template-create.input.ts.ejs',
      target: join(moduleDir, 'inputs', nameKebab + '-create.input.ts'),
      props: { nameCamel, nameKebab, namePascal }
    })

    // nest-server-module/xxx.model.ts
    await template.generate({
      template: 'nest-server-module/template.model.ts.ejs',
      target: join(moduleDir, nameKebab + '.model.ts'),
      props: { nameCamel, nameKebab, namePascal }
    })

    // nest-server-module/xxx.module.ts
    await template.generate({
      template: 'nest-server-module/template.module.ts.ejs',
      target: join(moduleDir, nameKebab + '.module.ts'),
      props: { nameCamel, nameKebab, namePascal }
    })

    // nest-server-module/xxx.resolver.ts
    await template.generate({
      template: 'nest-server-module/template.resolver.ts.ejs',
      target: join(moduleDir, nameKebab + '.resolver.ts'),
      props: { nameCamel, nameKebab, namePascal }
    })

    // nest-server-module/xxx.service.ts
    await template.generate({
      template: 'nest-server-module/template.service.ts.ejs',
      target: join(moduleDir, nameKebab + '.service.ts'),
      props: { nameCamel, nameKebab, namePascal }
    })

    const prettier = join(path, 'node_modules', '.bin', 'prettier')
    if (filesystem.exists(prettier)) {
      await system.run(prettier + ' ' + join(moduleDir, '**', '*.ts'))
    }

    generateSpinner.succeed('Files generated')

    const serverModule = join(path, 'src', 'server.module.ts')
    if (filesystem.exists(serverModule)) {
      const includeSpinner = spin('Include module into server')
      await patching.patch(join(path, 'src', 'server.module.ts'), {
        insert: `import { ${namePascal}Module } from './server/modules/${nameKebab}/${nameKebab}.module';\n`,
        before: 'import'
      })
      await patching.patch(join(path, 'src', 'server.module.ts'), {
        insert: `    ${namePascal}Module,\n`,
        after: new RegExp('imports:[^\\]]*', 'm')
      })
      if (filesystem.exists(prettier)) {
        await system.run(prettier + ' ' + serverModule)
      }
      includeSpinner.succeed('Module included')
    } else {
      info("Don't forget to include the module into your main module.")
    }

    // We're done, so show what to do next
    info(``)
    success(
      `Generated ${namePascal}Module in ${helper.msToMinutesAndSeconds(
        timer()
      )}.`
    )
    info(``)

    // For tests
    return `new module ${toolbox.parameters.first}`
  }
}

export default NewCommand
