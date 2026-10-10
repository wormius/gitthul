import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier/flat';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'src-tauri/**', 'node_modules/**'],
  },

  js.configs.recommended,

  // Las reglas con tipos solo aplican donde hay un tsconfig que las respalde.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Los `_` marcan a propósito lo que no se usa.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // `import type` explícito: lo exige verbatimModuleSyntax.
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },

  // Los archivos de configuración en JS corren en Node y sin tipos.
  {
    files: ['**/*.js'],
    languageOptions: { globals: globals.node },
  },

  // La aplicación: navegador, hooks de React y recarga en caliente.
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  {
    files: ['vite.config.ts'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['**/*.{test,spec}.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Debe ir al final: apaga todo lo que Prettier ya decide.
  prettier,
);
