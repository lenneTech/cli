import * as config from '../package.json';

const { system, filesystem } = require('gluegun');

const src = filesystem.path(__dirname, '..');

const cli = async cmd =>
  system.run('node ' + filesystem.path(src, 'bin', 'lt') + ` ${cmd}`);

test('outputs version', async () => {
  const output = await cli('--version');
  expect(output).toContain(config.version);
});

test('outputs help', async () => {
  const output = await cli('--help');
  expect(output).toContain(config.version);
});

/*
test('generates file', async () => {
  const output = await cli('generate foo')

  expect(output).toContain('Generated file at models/foo-model.ts')
  const foomodel = filesystem.read('models/foo-model.ts')

  expect(foomodel).toContain(`module.exports = {`)
  expect(foomodel).toContain(`name: 'foo'`)

  // cleanup artifact
  filesystem.remove('models')
})
*/
