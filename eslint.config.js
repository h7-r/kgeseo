import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier/flat'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '**/dist', '**/dist-*', '.claude', 'web-hero/vendor', 'naju01/src/models/baked', 'tools/regression/.cache']),
  {
    // 설정 파일과 Node 도구. page.evaluate 안의 코드는 브라우저에서 돈다.
    files: ['*.js', 'tools/**/*.mjs', 'naju01/tools/**/*.mjs'],
    extends: [js.configs.recommended, prettierConfig],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: [
      'website/**/*.{ts,tsx}',
      'src/**/*.{ts,tsx}',
      'naju01/src/**/*.{ts,tsx}',
      'naju01/tools/**/*.{ts,tsx}',
      'naju01/vite/**/*.ts',
      '*.config.ts',
      'naju01/*.config.ts',
    ],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      // 서식은 Prettier 가 맡는다. 겹치는 ESLint 서식 규칙을 끈다.
      prettierConfig,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // r3f 는 useFrame 안에서 카메라·장면·uniform 을 매 프레임 직접 바꾸는 것이 정석이다.
    // React 상태가 아닌 three.js 객체라 React Compiler 의 불변성 규칙이 맞지 않는다.
    files: ['website/src/three/**/*.tsx', 'src/**/*.{ts,tsx}', 'naju01/src/**/*.{ts,tsx}', 'naju01/tools/**/*.{ts,tsx}'],
    rules: { 'react-hooks/immutability': 'off' },
  },
])
