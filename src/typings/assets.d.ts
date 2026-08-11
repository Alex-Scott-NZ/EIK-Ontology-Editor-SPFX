/**
 * Webpack asset modules (configured in gulpfile.js) resolve .wasm imports to a
 * base64 data URI inlined in the bundle, so the binary ships inside the bundle
 * itself — no runtime fetch, no URL resolution to go wrong when the web part
 * runs from ClientSideAssets instead of the dev server.
 */
declare module '*.wasm' {
  const dataUri: string;
  export default dataUri;
}
