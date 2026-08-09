declare module "sharp" {
  // Minimal shim: sharp's package exports block TS bundler resolution of lib/index.d.ts.
  // Runtime import still loads the real sharp package.
  const sharp: any;
  export default sharp;
}
