// The rules of @lenne.tech/eslint-config-ts 2.3.0, held here so the CLI can drop
// eslint-plugin-import-x: its latest release imports `makeRe` from minimatch, which
// minimatch 11 removed, so it pinned the tree to a minimatch with GHSA-g3hv-75wg-m249
// (2026-11-03). It contributed four rules here: `import/default` and `import/export`
// (tsc reports both), `import/no-duplicates` (now the core `no-duplicate-imports`) and
// `import/no-mutable-exports` (src has no `export let`). The markdown, yml and jsonc
// plugins went with it: `npm run lint` only covers `src/**/*.{ts,js,vue}`.
import eslintcomments from '@eslint-community/eslint-plugin-eslint-comments';
import stylistic from '@stylistic/eslint-plugin';
import typescript from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import eslintConfigPrettier from 'eslint-config-prettier';
import noonlytests from 'eslint-plugin-no-only-tests';
import perfectionist from 'eslint-plugin-perfectionist';
import unusedImportPlugin from 'eslint-plugin-unused-imports';

console.log('Linting TypeScript...');

/** Re-key a shipped config's rules from the fork's prefix to the key it is registered under. */
const rekey = (rules, fromPrefix, toPrefix) =>
  Object.fromEntries(
    Object.entries(rules).map(([key, value]) => [
      key.startsWith(fromPrefix) ? toPrefix + key.slice(fromPrefix.length) : key,
      value,
    ]),
  );

export default [
  {
    // Vendor-script templates are copied verbatim into generated projects
    // and are intended to run there, not in the CLI itself. Don't lint them.
    ignores: ['dist/', 'node_modules/', 'extras/', 'src/templates/**', 'build/**', '__tests__/fixtures/**'],
  },
  {
    files: ['*.ts', '*.js', '**/*.ts', '**/*.js'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      '@stylistic': stylistic,
      '@typescript-eslint': typescript,
      'eslint-comments': eslintcomments,
      'no-only-tests': noonlytests,
      perfectionist,
      typescript,
      'unused-imports': unusedImportPlugin,
    },
    rules: {
      ...perfectionist.configs['recommended-natural'].rules,
      ...typescript.configs['eslint-recommended'].rules,
      ...typescript.configs['recommended'].rules,
      ...rekey(eslintcomments.configs['recommended'].rules, '@eslint-community/eslint-comments/', 'eslint-comments/'),

      'perfectionist/sort-classes': 'off',
      'perfectionist/sort-imports': 'error',

      // TS
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': 'allow-with-description' }],
      '@stylistic/member-delimiter-style': [
        'error',
        {
          multiline: {
            delimiter: 'semi',
            requireLast: true,
          },
          multilineDetection: 'brackets',
          singleline: {
            delimiter: 'semi',
            requireLast: false,
          },
        },
      ],
      '@stylistic/type-annotation-spacing': ['error', {}],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/prefer-ts-expect-error': 'error',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': ['warn', { allowShortCircuit: true, allowTernary: true }],
      // Override JS
      'no-useless-constructor': 'off',
      'no-invalid-this': 'off',
      '@typescript-eslint/no-invalid-this': 'error',
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'error',
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': ['error', { classes: false, functions: false, variables: true }],
      'brace-style': 'off',
      '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: false }],
      'comma-dangle': 'off',
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      'object-curly-spacing': 'off',
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/quotes': ['error', 'single'],
      'space-before-blocks': 'off',
      '@stylistic/space-before-blocks': ['error', 'always'],
      'space-before-function-paren': 'off',
      '@stylistic/space-before-function-paren': [
        'error',
        {
          anonymous: 'always',
          asyncArrow: 'always',
          named: 'never',
        },
      ],
      'space-infix-ops': 'off',
      '@stylistic/space-infix-ops': 'error',
      'keyword-spacing': 'off',
      '@stylistic/keyword-spacing': ['error', { after: true, before: true }],
      'comma-spacing': 'off',
      '@stylistic/comma-spacing': ['error', { after: true, before: false }],
      'no-extra-parens': 'off',
      '@stylistic/no-extra-parens': ['error', 'functions'],
      'no-dupe-class-members': 'off',
      '@typescript-eslint/no-dupe-class-members': 'error',
      'no-loss-of-precision': 'off',
      '@typescript-eslint/no-loss-of-precision': 'error',
      'lines-between-class-members': 'off',
      '@stylistic/lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: true }],
      '@stylistic/indent': ['error', 2],

      // off
      '@typescript-eslint/consistent-indexed-object-style': 'off',
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-member-accessibility': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/parameter-properties': 'off',
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/ban-ts-ignore': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/ban-types': 'off',
      '@typescript-eslint/triple-slash-reference': 'off',
      '@typescript-eslint/no-unused-vars': 'off', // handled by unused-imports/no-unused-vars

      // imports (eslint-plugin-import-x's `import/no-duplicates`, see the header)
      'no-duplicate-imports': ['warn', { allowSeparateTypeImports: true }],

      // Common
      semi: ['error', 'always'],
      curly: ['error', 'all'],
      quotes: ['error', 'single'],
      'quote-props': ['error', 'consistent-as-needed'],

      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['warn', { caughtErrors: 'none' }],

      'no-param-reassign': 'off',
      'array-bracket-spacing': ['error', 'never'],
      'block-spacing': ['error', 'always'],
      camelcase: 'off',
      'comma-style': ['error', 'last'],
      'no-constant-condition': 'warn',
      'no-debugger': 'error',
      'no-console': ['error', { allow: ['debug', 'info', 'warn', 'error'] }],
      'no-cond-assign': ['error', 'always'],
      'func-call-spacing': 'off',
      'key-spacing': ['error', { afterColon: true, beforeColon: false }],
      'no-restricted-syntax': ['error', 'DebuggerStatement', 'LabeledStatement', 'WithStatement'],
      'no-return-await': 'off',
      'no-restricted-globals': [
        'error',
        { message: 'Use `globalThis` instead.', name: 'global' },
        { message: 'Use `globalThis` instead.', name: 'self' },
      ],
      'no-restricted-properties': [
        'error',
        { message: 'Use `Object.getPrototypeOf` or `Object.setPrototypeOf` instead.', property: '__proto__' },
        { message: 'Use `Object.defineProperty` instead.', property: '__defineGetter__' },
        { message: 'Use `Object.defineProperty` instead.', property: '__defineSetter__' },
        { message: 'Use `Object.getOwnPropertyDescriptor` instead.', property: '__lookupGetter__' },
        { message: 'Use `Object.getOwnPropertyDescriptor` instead.', property: '__lookupSetter__' },
      ],

      // es6
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all', ignoreReadBeforeAssign: true }],
      'prefer-arrow-callback': ['error', { allowNamedFunctions: false, allowUnboundThis: true }],
      'object-shorthand': ['error', 'always', { avoidQuotes: true, ignoreConstructors: false }],
      'prefer-exponentiation-operator': 'error',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'prefer-template': 'error',
      'template-curly-spacing': 'error',
      'arrow-parens': ['error', 'as-needed', { requireForBlockBody: true }],
      'generator-star-spacing': 'off',
      'spaced-comment': [
        'error',
        'always',
        {
          block: {
            balanced: true,
            exceptions: ['*'],
            markers: ['!'],
          },
          line: {
            exceptions: ['/', '#'],
            markers: ['/'],
          },
        },
      ],

      // best-practice
      'array-callback-return': 'error',
      'block-scoped-var': 'error',
      'consistent-return': 'off',
      complexity: 'off',
      indent: 'off', // Disallows inconsistent indentation
      eqeqeq: ['error', 'smart'],
      'no-alert': 'warn',
      'no-case-declarations': 'error',
      'no-multi-spaces': 'error',
      'no-multi-str': 'error',
      'no-with': 'error',
      'no-void': 'error',
      'no-useless-escape': 'off',
      'vars-on-top': 'error',
      'require-await': 'off',
      'no-return-assign': 'off',
      'operator-linebreak': ['error', 'before'],
      'max-statements-per-line': ['error', { max: 1 }],

      // node
      'eslint-comments/disable-enable-pair': 'off',
    },
  },
  // Prettier config must be last to override conflicting rules
  eslintConfigPrettier,
];
