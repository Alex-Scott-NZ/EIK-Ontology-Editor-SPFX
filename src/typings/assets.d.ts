/**
 * Webpack asset modules (configured in gulpfile.js) resolve these imports to
 * the deployed file's URL, so the .wasm ships with the package instead of
 * needing a manual upload.
 */
declare module '*.wasm' {
  const url: string;
  export default url;
}
