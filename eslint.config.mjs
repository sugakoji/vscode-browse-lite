// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    ignores: [
      'build',
      'node_modules',
      'assets',
      'public',
    ],
  },
  {
    rules: {
      'unused-imports/no-unused-vars': 0,
      'eqeqeq': 0,
      'node/prefer-global/process': 0,
      'ts/ban-ts-comment': 0,
      'unicorn/prefer-node-protocol': 0,
    },
  },
)
