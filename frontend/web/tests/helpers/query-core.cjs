const core = require("@tanstack/query-core");
// Cache GC timers must not keep the Node test process alive after assertions.
core.timeoutManager.setTimeoutProvider({
  setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; },
  clearTimeout,
  setInterval: (fn, ms) => { const timer = setInterval(fn, ms); timer.unref(); return timer; },
  clearInterval,
});
module.exports = core;
