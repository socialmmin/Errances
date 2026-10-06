module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
  testRegex: 'src/.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
};
