import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

// Covers the full-stack frontends, the standalone editions, tests and Node scripts. The rule set
// is ESLint's recommended rules plus React's rules of hooks; formatting is not enforced.
export default [
  {
    ignores: ['**/node_modules/', '**/dist/', '**/vendor/', 'output/', 'public/', 'tmp/', '.runtime/', 'playwright-report/', 'test-results/', '**/test-results/', '**/.vite/']
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, CESIUM_BASE_URL: 'readonly' }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // Several effects intentionally list fewer dependencies (for example, run on selection
      // change only); the warnings stay visible without failing the build.
      'react-hooks/exhaustive-deps': 'warn',
      // React's automatic JSX runtime does not reference the React import.
      'no-unused-vars': ['error', { varsIgnorePattern: '^React$', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  }
];
