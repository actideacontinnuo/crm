/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.js',
    '<rootDir>/tests/integration/**/*.test.js',
  ],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'api/**/*.js',
    'middleware/**/*.js',
    '!api/notion.js',     // módulo de I/O — cubierto por integración
    '!api/_audit.js',
  ],
  // Cobertura mínima obligatoria — si un cambio la baja de 90%, los tests fallan
  coverageThreshold: {
    global: { statements: 90, branches: 90, functions: 90, lines: 90 },
  },
  setupFiles: ['<rootDir>/tests/helpers/setup-env.js'],
  testTimeout: 15000,
  verbose: true,
};
