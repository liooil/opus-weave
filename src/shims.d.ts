// Stub declarations for native modules used by bundesk that tsc cannot resolve.
// bun handles these at runtime; these declarations keep `tsc --noEmit` clean.
declare module '*.c' {
  const source: string
  export default source
}
