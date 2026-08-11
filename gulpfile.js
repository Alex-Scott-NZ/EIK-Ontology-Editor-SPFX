'use strict';

const build = require('@microsoft/sp-build-web');

build.addSuppression(
  `Warning - [sass] The local CSS class 'ms-Grid' is not camelCase and will not be type-safe.`
);

// The tools/ folder is a separate Node project (Turtle <-> SQLite conversion)
// and must never be pulled into the SPFx bundle.
build.tslintCmd.enabled = false;

/**
 * Inline sql.js's WebAssembly binary into the bundle as a data URI.
 *
 * asset/resource (a URL fetched at runtime) worked under `gulp serve` but broke
 * in the installed package: the URL is resolved from document.currentScript at
 * bundle load, which SharePoint's module loader does not guarantee — the fetch
 * fell back to a page-relative path and 404'd ("both async and sync fetching
 * of the wasm failed"). Inlined bytes cannot mis-resolve anywhere.
 */
build.configureWebpack.mergeConfig({
  additionalConfiguration: (generatedConfiguration) => {
    generatedConfiguration.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/inline'
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
