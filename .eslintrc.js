// http://eslint.org/docs/user-guide/configuring

module.exports = {
  root: true,
  parserOptions: {
    sourceType: 'module',
  },
  env: {
    browser: true,
    node: true,
  },
  extends: [
    'airbnb-base',
    'plugin:promise/recommended',
    'plugin:unicorn/recommended',
  ],
  plugins: [
    'promise',
    'unicorn',
  ],
  rules: {
    // allow optionalDependencies
    'import/no-extraneous-dependencies': ['error', {
      optionalDependencies: ['test/unit/index.js'],
    }],
    // allow debugger during development
    'no-debugger': process.env.NODE_ENV === 'production' ? 2 : 0,

    'no-console': 0,
    'default-case': 0,
    'no-param-reassign': 0,
    'global-require': 0,
    'linebreak-style': 0,

    // eslint-plugin-promise
    'promise/prefer-await-to-then': 2,
    'promise/prefer-await-to-callbacks': 2,

    // eslint-plugin-unicorn
    'unicorn/filename-case': 0,
    'unicorn/explicit-length-check': [0, {
      'non-zero': 'greater-than',
    }],
  },
};
