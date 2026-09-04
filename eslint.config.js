const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'prefer-const': 'warn',
    },
  },
  {
    ignores: [
      'node_modules/**',
      '.browser-data/**',
      'screenshots/**',
      'backup/**',
      '*.log',
      'package-lock.json',
    ],
  },
];
