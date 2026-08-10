'use strict';

const build = require('@microsoft/sp-build-web');

build.addSuppression(
  `Warning - [sass] The local CSS class 'ms-Grid' is not camelCase and will not be type-safe.`
);

// The tools/ folder is a separate Node project (Turtle <-> SQLite conversion)
// and must never be pulled into the SPFx bundle.
build.tslintCmd.enabled = false;

/**
 * Emit sql.js's WebAssembly binary as a deployed asset.
 *
 * Without this the .wasm has to be uploaded to a library by hand and located by
 * absolute URL — easy to get wrong, and it breaks whenever the site moves. As
 * an asset module webpack copies it next to the bundle and hands us the CDN
 * URL at runtime, so it ships with the package and needs no setup.
 */
build.configureWebpack.mergeConfig({
  additionalConfiguration: (generatedConfiguration) => {
    generatedConfiguration.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
      generator: { filename: '[name][ext]' }
    });
    return generatedConfiguration;
  }
});

const getTasks = build.rig.getTasks;
build.rig.getTasks = function () {
  const result = getTasks.call(build.rig);
  result.set('serve', result.get('serve-deprecated'));
  return result;
};

build.initialize(require('gulp'));
