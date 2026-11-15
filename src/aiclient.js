// ===== aiclient.js — async facade over the engine's AI (browser only) =====
// Runs the engine in a Web Worker built from the page's own engine <script>; if a worker
// cannot be created or dies, the same engine runs on the main thread in short slices.
// Every promise resolves with a usable answer (the engine has legal last-resort choices),
// except after reset(), when pending promises reject with {cancelled: true}.
const AIClient = (function () {
  let worker = null, workerOk = true, nextId = 1;
  const pending = new Map();

  function startWorker() {
    try {
      const src = document.getElementById('engine-src').textContent;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = function (ev) {
        if (!('result' in ev.data)) return;                 // progress notes are only used by the analysis worker
        const p = pending.get(ev.data.id);
        if (!p) return;
        pending.delete(ev.data.id);
        if (ev.data.result && ev.data.result.failed) runLocal(p);
        else p.resolve(ev.data.result);
      };
      worker.onerror = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        workerOk = false;
        try { worker.terminate(); } catch (e) { /* ignore */ }
        worker = null;
        const all = Array.from(pending.values());
        pending.clear();
        all.forEach(runLocal);
      };
    } catch (e) {
      worker = null; workerOk = false;
    }
  }

  function runLocal(p) {
    let job;
    try { job = BridgeEngine.aiStartJob(p.req); } catch (e) { p.reject(e); return; }
    pending.set(p.id, p);
    (function pump() {
      if (p.cancelled) return;
      let done;
      try { done = job.step(12); } catch (e) { pending.delete(p.id); p.reject(e); return; }
      if (done) { pending.delete(p.id); p.resolve(job.result); }
      else setTimeout(pump, 0);
    })();
  }

  // ----- long background analysis (four bots replaying a deal) -----
  // It gets a worker of its own, so the bots at the table never wait behind it. One job at a time.
  let side = null, sideOk = true, sideJob = null;
  function sideLocal(p) {                                    // no worker available: run in short slices on the page
    let job;
    // on the page itself a single position must not freeze the screen: analyse each one less deeply
    const req = p.req.type === 'review' ? Object.assign({}, p.req, { maxNodes: 2500000 }) : p.req;
    try { job = BridgeEngine.aiStartJob(req); } catch (e) { sideJob = null; p.reject(e); return; }
    (function pump() {
      if (p.cancelled) return;
      let done;
      try { done = job.step(10); } catch (e) { sideJob = null; p.reject(e); return; }
      if (job.progress && p.onProgress) p.onProgress(job.progress);
      if (done) { sideJob = null; p.resolve(job.result); }
      else setTimeout(pump, 6);
    })();
  }
  function sideStart() {
    try {
      const src = document.getElementById('engine-src').textContent;
      side = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      side.onmessage = function (ev) {
        const p = sideJob;
        if (!p || ev.data.id !== p.id) return;
        if (!('result' in ev.data)) { if (p.onProgress) p.onProgress(ev.data.progress); return; }
        sideJob = null;
        if (ev.data.result && ev.data.result.failed) p.reject(new Error(ev.data.result.error || 'analysis failed'));
        else p.resolve(ev.data.result);
      };
      side.onerror = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        sideOk = false;
        try { side.terminate(); } catch (e) { /* ignore */ }
        side = null;
        if (sideJob) sideLocal(sideJob);
      };
    } catch (e) { side = null; sideOk = false; }
  }
  function analyse(req, onProgress) {
    return new Promise(function (resolve, reject) {
      if (sideJob) { reject(new Error('analysis already running')); return; }
      const p = { id: nextId++, req: req, resolve: resolve, reject: reject, onProgress: onProgress, cancelled: false };
      sideJob = p;
      if (sideOk && !side) sideStart();
      if (side) side.postMessage({ id: p.id, req: req });
      else sideLocal(p);
    });
  }
  function cancelAnalysis() {
    const p = sideJob;
    sideJob = null;
    if (side) { try { side.terminate(); } catch (e) { /* ignore */ } side = null; }
    if (p) { p.cancelled = true; p.reject({ cancelled: true }); }
  }

  function request(req) {
    return new Promise(function (resolve, reject) {
      const p = { id: nextId++, req: req, resolve: resolve, reject: reject, cancelled: false };
      if (workerOk && !worker) startWorker();
      if (worker) { pending.set(p.id, p); worker.postMessage({ id: p.id, req: req }); }
      else runLocal(p);
    });
  }

  return {
    // -> Promise<{call, text}>
    chooseCall: function (view) { return request({ type: 'call', view: view }); },
    // view.seat = the seat deciding (declarer decides for dummy). level: 1 quick .. 3 strongest. -> Promise<{card}>
    choosePlay: function (view, level) { return request({ type: 'play', view: view, level: level || 2 }); },
    // {hands (remaining cards of all four), trump, leader, trick, seat} -> Promise<{tricks}>: most tricks seat's side can still take
    checkClaim: function (pos) { return request(Object.assign({ type: 'claim' }, pos)); },
    // -> Promise<string[]>: plain-language meaning of each call in the auction
    explainAuction: function (dealer, vul, calls) {
      return request({ type: 'explain', dealer: dealer, vul: vul, calls: calls }).then(function (r) { return r.texts; });
    },
    // Drop everything in flight (undo, new deal). Pending promises reject with {cancelled:true}.
    reset: function () {
      const all = Array.from(pending.values());
      pending.clear();
      if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } worker = null; }
      all.forEach(function (p) { p.cancelled = true; p.reject({ cancelled: true }); });
    },
    // Long analysis in the background, e.g. {type:'replay', deal, level}. onProgress({phase, tricks}) is optional.
    // -> Promise<result>; rejects with {cancelled:true} after cancelAnalysis(). One at a time.
    analyse: analyse,
    cancelAnalysis: cancelAnalysis,
    analysing: function () { return !!sideJob; },
    usingWorker: function () { return !!worker; }
  };
})();
