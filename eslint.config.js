import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'scripts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Effect dependency mistakes caused a refetch loop once; treat them as errors.
      'react-hooks/exhaustive-deps': 'error',
      // API responses are typed in src/services/api-types.ts; keep `any` out of app code.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Test fixtures may build partial objects loosely.
    files: ['**/*.spec.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
