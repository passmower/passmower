import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'
import globals from 'globals'

// Flat config (ESLint 9+). Replaces the previous .eslintrc.cjs:
//   eslint:recommended            -> js.configs.recommended
//   plugin:vue/vue3-essential     -> pluginVue.configs['flat/essential']
//   @vue/.../skip-formatting       -> skipFormatting (lets Prettier own formatting)
export default [
  {
    name: 'app/files-to-lint',
    files: ['**/*.{js,mjs,cjs,jsx,vue}'],
  },
  {
    name: 'app/files-to-ignore',
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    // Browser app: declare the browser globals (window, fetch, console, …).
    // Flat config's equivalent of the old eslintrc `env: { browser: true }`.
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  skipFormatting,
]
