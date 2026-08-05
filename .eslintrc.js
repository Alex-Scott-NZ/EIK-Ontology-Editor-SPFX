require('@rushstack/eslint-config/patch/modern-module-resolution');

module.exports = {
  extends: ['@microsoft/eslint-config-spfx/lib/profiles/react'],
  parserOptions: { tsconfigRootDir: __dirname },
  ignorePatterns: ['tools/**/*', 'lib/**/*', 'dist/**/*'],
  overrides: [
    {
      files: ['*.ts', '*.tsx'],
      parser: '@typescript-eslint/parser',
      parserOptions: { project: './tsconfig.json' },
      rules: {
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/explicit-function-return-type': [
          'warn',
          { allowExpressions: true, allowTypedFunctionExpressions: true }
        ]
      }
    }
  ]
};
