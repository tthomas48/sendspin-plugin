module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: [
    'lib/**/*.js',
    '!lib/**/*.test.js',
    '!lib/sendspin-js/**' // Exclude submodule
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 10000,
  // Force exit after tests to prevent hanging on open handles
  forceExit: true
};

