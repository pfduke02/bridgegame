// Engine source files, in load order. They are concatenated into one scope
// (page bundle, Web Worker, and the Node tests all load them this way).
module.exports = [
  'core.js', 'dds.js',
  'bid-eval.js', 'bid-open.js', 'bid-rebid.js', 'bid-comp.js', 'bid-natural.js', 'bidding.js',
  'play.js', 'ai.js'
];
