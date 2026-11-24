import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const f1Ignores = [
  'docs/**',
  'workspace/**',
  'dist/**',
  'node_modules/**',
  'evals/**',
  'rules/**',
  'tests/acceptance/**',
  'tests/fixtures/**',
  'public/**',
  'THIRD_PARTY_LICENSES/**',
  'package-lock.json',
  'AGENTS.md',
  'README.md',
  'DESIGN.md',
  '.github/**',
  '.githooks/**',
  '.agents/**',
  '**/*.tsbuildinfo',
  '.scratch/**',
  '.scratch-*/**',
  '.test-*/**',
  '.rn-*/**',
  '**/*.ps1',
  '**/*.py',
  'index.html',
  '.env*',
  '.git*',
  '**/*.pdf',
  '**/*.docx',
  '**/*.png',
  '**/*.txt',
];

export default [
  { ignores: f1Ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ['app/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: [
      'server/**/*.{ts,mts,js,mjs}',
      'services/**/*.{ts,mts,js,mjs}',
      'scripts/**/*.{ts,tsx,mts,js,mjs}',
      'vite.config.ts',
      'eslint.config.js',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['tests/**/*.{ts,tsx,mts,js,mjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  prettier,
  {
    rules: {
      // ENG05：以下 6 条已清零规则已从降级表移除，恢复推荐集默认 error 级别防回退：
      // react-hooks/refs、react-hooks/immutability、no-irregular-whitespace、
      // preserve-caught-error、no-useless-assignment、no-unsafe-finally
      // 其余 10 条存量违规规则维持 warn（含下方 TS 作用域 prefer-const），全仓合计 761 条告警：
      '@typescript-eslint/no-explicit-any': 'warn', // 存量 522 处
      '@typescript-eslint/no-unused-vars': 'warn', // 存量 124 处
      'react-hooks/set-state-in-effect': 'warn', // 存量 30 处（React Compiler 规则：effect 内同步 setState/加载重置）
      'react-hooks/exhaustive-deps': 'warn', // 预设默认 warn，存量 22 处
      'no-control-regex': 'warn', // 存量 18 处（文本清洗与控制字符过滤正则）
      'no-useless-escape': 'warn', // 存量 10 处
      'no-empty': 'warn', // 存量 5 处
      'no-useless-catch': 'warn', // 存量 2 处
      '@typescript-eslint/no-unused-expressions': 'warn', // 存量 1 处
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    rules: {
      // 跟随 typescript-eslint/eslint-recommended 作用域（仅 TS 文件）降级为 warn
      'prefer-const': 'warn', // 存量 27 处
    },
  },
];
