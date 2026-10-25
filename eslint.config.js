import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';

const typedRules = {
  '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/await-thenable': 'error',
  '@typescript-eslint/require-await': 'off',
  '@typescript-eslint/switch-exhaustiveness-check': 'error'
};

const commonRules = {
  eqeqeq: ['error', 'always'],
  'no-console': 'error',
  'no-var': 'error',
  'prefer-const': 'error',
  'object-shorthand': 'error',
  'no-restricted-syntax': [
    'error',
    {
      selector: "CallExpression[callee.object.name='process'][callee.property.name='env']",
      message: 'Read configuration through AppConfig, never process.env directly.'
    }
  ],
  'import/no-cycle': ['error', { maxDepth: Infinity }],
  'import/no-self-import': 'error',
  'import/no-duplicates': 'error'
};

export default [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'bun.lockb'] },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin
    },
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.json' }
      }
    },
    rules: commonRules
  },
  {
    files: ['src/**/*.ts'],
    rules: typedRules
  },
  {
    files: ['src/**/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', '@mikro-orm/*', '@aws-sdk/*', '**/infrastructure/**', '**/presentation/**'],
              message: 'The domain layer must not depend on frameworks, ORM, AWS SDK or outer layers.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/**/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@mikro-orm/*', '@aws-sdk/*', '**/infrastructure/**', '**/presentation/**'],
              message: 'Application layer depends on ports, not on infrastructure or presentation.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['test/**/*.ts', 'src/scripts/**/*.ts', 'src/migrations/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'import/no-cycle': 'off'
    }
  },
  {
    files: ['src/main.ts', 'src/scripts/**/*.ts', 'src/config/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  }
];
