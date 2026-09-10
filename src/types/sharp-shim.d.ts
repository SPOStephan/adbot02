declare module "sharp" {
  // Minimal shim: sharp's package exports block TS bundler resolution of lib/index.d.ts.
  // Runtime import still loads the real sharp package.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors the unavailable upstream callable type
  const sharp: any;
  export default sharp;
}
