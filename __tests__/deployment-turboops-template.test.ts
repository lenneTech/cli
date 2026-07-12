import * as ejs from 'ejs';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * `.turboops.json` is read by `turbo deploy` in CI, so the template must always
 * emit valid JSON.
 *
 * gluegun renders templates via `ejs.render(content, data)`, and EJS's `<%= %>`
 * tag HTML-escapes its output. Using it here silently mangled the project slug
 * (`o'brien` → `o&#39;brien`) and a backslash could even produce invalid JSON.
 * The template therefore uses `<%- JSON.stringify(...) %>`, which is the only
 * JSON-correct form. These tests lock that in.
 */
const TEMPLATE_PATH = join(__dirname, '..', 'src', 'templates', 'deployment', 'turboops.json.ejs');

describe('deployment/turboops.json.ejs', () => {
  const render = (project: string): string =>
    ejs.render(readFileSync(TEMPLATE_PATH, 'utf8'), { props: { project } });

  test('renders a normal slug', () => {
    expect(JSON.parse(render('my-project'))).toEqual({ project: 'my-project' });
  });

  test('does not HTML-escape the value', () => {
    // `<%= %>` would turn these into `o&#39;brien &amp; co`.
    expect(JSON.parse(render("o'brien & co"))).toEqual({ project: "o'brien & co" });
  });

  test('stays valid JSON for quotes and backslashes', () => {
    expect(JSON.parse(render('a"b\\c'))).toEqual({ project: 'a"b\\c' });
  });

  test('emits exactly one `project` key', () => {
    expect(Object.keys(JSON.parse(render('svl')))).toEqual(['project']);
  });
});
