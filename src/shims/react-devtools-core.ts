// Ink only loads React DevTools when DEV=true. The real package isn't needed in
// the compiled binary, so this no-op shim keeps `bun build --compile` resolvable.
export default {
  initialize() {},
  connectToDevTools() {},
};
