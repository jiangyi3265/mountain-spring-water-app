import js from '@eslint/js'
import globals from 'globals'
import vue from 'eslint-plugin-vue'
import tsParser from '@typescript-eslint/parser'

export default [
  { ignores: ['dist/**', 'unpackage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...vue.configs['flat/essential'],
  { files: ['**/*.vue'], languageOptions: { parserOptions: { parser: tsParser, extraFileExtensions: ['.vue'] } } },
  {
    files: ['**/*.{js,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, uni: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-irregular-whitespace': 'off',
      'vue/multi-word-component-names': 'off',
    },
  },
]
