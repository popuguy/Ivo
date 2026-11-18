import js from '@eslint/js';
import globals from 'globals';
export default [
  {
    ignores: [
      'dist/**',
      'release/**',
      'node_modules/**',
      'ios/**',
      'public/**',
      'research-private/**',
      'src/shared/ui/reference-art-data.js',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.es2025 },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['src/**/*.js', 'tests/runtime/**/*.js', 'tests/prototypes/**/*.js', 'tools/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      'desktop/**/*.{mjs,cjs}',
      'scripts/*.mjs',
      'tests/unit/*.js',
      'tests/native/*.js',
      'tests/runtime/**/*.mjs',
      'tests/prototypes/**/*.mjs',
      'eslint.config.js',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/domain/**/*.js'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'localStorage',
        'sessionStorage',
        'Worker',
        'requestAnimationFrame',
        'HTMLElement',
        'Node',
        'NodeFilter',
      ],
    },
  },
  {
    files: ['src/features/graph/physics-worker.js', 'sw.js'],
    languageOptions: { globals: globals.worker },
  },
];
