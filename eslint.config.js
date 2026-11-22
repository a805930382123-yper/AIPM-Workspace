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
      // ENG04 阶段 A 基线分级：仅将有存量违规的推荐规则设为 warn 并登记数量，0 违规推荐规则保持 error
      '@typescript-eslint/no-explicit-any': 'warn', // 基线 523 处
      '@typescript-eslint/no-unused-vars': 'warn', // 基线 125 处（含 107 处 _ 前缀占位与 18 处未使用绑定）
      'react-hooks/exhaustive-deps': 'warn', // 预设默认 warn，基线 38 处
      'react-hooks/set-state-in-effect': 'warn', // 基线 36 处（React Compiler 规则：effect 内同步 setState/加载重置）
      'react-hooks/refs': 'warn', // 基线 28 处（render 期读写 ref，含疑似缺陷清单项）
      'no-control-regex': 'warn', // 基线 18 处（文本清洗与控制字符过滤正则）
      'no-useless-escape': 'warn', // 基线 10 处
      'no-empty': 'warn', // 基线 5 处
      'no-useless-assignment': 'warn', // 基线 5 处
      'react-hooks/immutability': 'warn', // 基线 2 处（声明前访问回调，见疑似缺陷清单）
      '@typescript-eslint/no-unused-expressions': 'warn', // 基线 2 处
      'preserve-caught-error': 'warn', // 基线 2 处（catch 重抛未附带 cause，见疑似缺陷清单）
      'no-useless-catch': 'warn', // 基线 2 处
      'no-irregular-whitespace': 'warn', // 基线 2 处（文件中间残留 U+FEFF BOM）
      'no-unsafe-finally': 'warn', // 基线 2 处（finally 中 throw 可能掩盖异常，见疑似缺陷清单）
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    rules: {
      // 跟随 typescript-eslint/eslint-recommended 作用域（仅 TS 文件）降级为 warn
      'prefer-const': 'warn', // 基线 27 处
    },
  },
];
