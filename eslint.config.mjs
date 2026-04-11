import typescript from '@lenne.tech/eslint-config-ts'

export default [
  {
    // Vendor-script templates are copied verbatim into generated projects
    // and are intended to run there, not in the CLI itself. Don't lint them.
    ignores: [
      "src/templates/**",
      "build/**",
      "__tests__/fixtures/**",
    ],
  },
  ...typescript,
  {
    rules: {
      "unused-imports/no-unused-vars": [
        "warn",
        {
          "caughtErrors": "none"
        },
      ],
    }
  }
]
