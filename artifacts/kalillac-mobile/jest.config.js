module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true, tsconfig: { outDir: './dist', rootDir: './' } }],
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
};
