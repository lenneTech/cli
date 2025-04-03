import typescript from '@lenne.tech/eslint-config-ts'

export default [
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
