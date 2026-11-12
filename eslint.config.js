'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    // The browser client is made of native ES modules; shared/cards.js also runs in the browser (UMD).
    files: ['public/js/**/*.js'],
    languageOptions: { sourceType: 'module', globals: globals.browser },
  },
  {
    files: ['shared/cards.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
