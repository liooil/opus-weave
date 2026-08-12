// Stub declarations for native/asset modules that tsc cannot resolve.
// bun handles these at runtime; these declarations keep `tsc --noEmit` clean.
declare module '*.c' {
  const source: string
  export default source
}

// Raw-text imports (`?raw` suffix) embed file contents at build time — used
// for the spessasynth AudioWorklet processor so compiled single-file binaries
// serve it without needing node_modules at runtime.
declare module '*?raw' {
  const source: string
  export default source
}

// `with { type: 'file' }` imports resolve to a runtime-accessible file path;
// in compiled binaries the file is embedded and materialized to a temp path.
declare module '*spessasynth_processor.min.js' {
  const filePath: string
  export default filePath
}

declare module '*.sf2' {
  const fileUrl: string
  export default fileUrl
}

declare module '*.sf3' {
  const fileUrl: string
  export default fileUrl
}

declare module '*.md' {
  const fileUrl: string
  export default fileUrl
}
