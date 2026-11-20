// Bundles idb-keyval 6.3.0, Copyright 2016 Jake Archibald, Apache License 2.0: see live-store-8ea660e.LICENSES.txt.
// The live app's store (8ea660e, schema 2), built as it ships: src/app/store.ts, run.ts and update.ts with
// idb-keyval. e2e loads it into a tab to stand in for an old tab of that app. React, which only its useUpdate
// needs, is left out. Built with, in a worktree at 8ea660e holding an entry that re-exports those modules:
//   esbuild entry.ts --bundle --format=iife --global-name=live --alias:react=<stub> --define:__APP_BUILD__='"8ea660e"' --target=es2022
"use strict";
var live = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // entry.ts
  var entry_exports = {};
  __export(entry_exports, {
    NewerRun: () => NewerRun,
    addRun: () => addRun,
    askPersist: () => askPersist,
    currentUpdate: () => currentUpdate,
    getPhoto: () => getPhoto,
    getRun: () => getRun,
    listRuns: () => listRuns,
    newRun: () => newRun,
    saveRead: () => saveRead,
    setStepDone: () => setStepDone,
    setTap: () => setTap,
    startTimer: () => startTimer,
    takePhoto: () => takePhoto
  });

  // node_modules/idb-keyval/dist/index.js
  function promisifyRequest(request) {
    return new Promise((resolve, reject) => {
      request.oncomplete = request.onsuccess = () => resolve(request.result);
      request.onabort = request.onerror = () => reject(request.error);
    });
  }
  function createStore(dbName, storeName) {
    let dbp;
    const getDB = () => {
      if (dbp)
        return dbp;
      const request = indexedDB.open(dbName);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      dbp = promisifyRequest(request);
      dbp.then((db2) => {
        db2.onclose = () => dbp = void 0;
      }, () => {
        dbp = void 0;
      });
      return dbp;
    };
    return (txMode, callback) => getDB().then((db2) => callback(db2.transaction(storeName, txMode).objectStore(storeName)));
  }
  var defaultGetStoreFunc;
  function defaultGetStore() {
    if (!defaultGetStoreFunc) {
      defaultGetStoreFunc = createStore("keyval-store", "keyval");
    }
    return defaultGetStoreFunc;
  }
  function get(key, customStore = defaultGetStore()) {
    return customStore("readonly", (store) => promisifyRequest(store.get(key)));
  }
  function set(key, value, customStore = defaultGetStore()) {
    return customStore("readwrite", (store) => {
      store.put(value, key);
      return promisifyRequest(store.transaction);
    });
  }
  function update(key, updater, customStore = defaultGetStore()) {
    return customStore("readwrite", (store) => (
      // Need to create the promise manually.
      // If I try to chain promises, the transaction closes in browsers
      // that use a promise polyfill (IE10/11).
      new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = function() {
          try {
            store.put(updater(req.result), key);
            resolve(promisifyRequest(store.transaction));
          } catch (err) {
            reject(err);
          }
        };
        req.onerror = () => reject(req.error);
      })
    ));
  }
  function del(key, customStore = defaultGetStore()) {
    return customStore("readwrite", (store) => {
      store.delete(key);
      return promisifyRequest(store.transaction);
    });
  }
  function eachCursor(store, callback) {
    store.openCursor().onsuccess = function() {
      if (!this.result)
        return;
      callback(this.result);
      this.result.continue();
    };
    return promisifyRequest(store.transaction);
  }
  function values(customStore = defaultGetStore()) {
    return customStore("readonly", (store) => {
      if (store.getAll) {
        return promisifyRequest(store.getAll());
      }
      const items = [];
      return eachCursor(store, (cursor) => items.push(cursor.value)).then(() => items);
    });
  }

  // package.json
  var version = "1.0.0";

  // src/app/run.ts
  var READER_VERSION = "1";
  var SCHEMA = 2;
  function newRun(assay, input, now = Date.now(), id = crypto.randomUUID()) {
    return {
      schema: SCHEMA,
      id,
      assay: assay.id,
      field: input.field.trim(),
      notes: input.notes.trim(),
      ...input.gps && { gps: input.gps },
      createdAt: now,
      steps: {},
      taps: Array(assay.tubes).fill(null),
      appVersion: version,
      readerVersion: READER_VERSION
    };
  }
  function withStep(run, stepId, patch) {
    return { ...run, steps: { ...run.steps, [stepId]: { done: false, ...run.steps[stepId], ...patch } } };
  }
  var SCHEMA_1_STEPS = { sclerotinia: ["preheat", "label", "mix", "crush", "dip", "oil", "shade", "cool"] };
  function upgrade(run) {
    if (run.schema === SCHEMA) return run;
    const ids = SCHEMA_1_STEPS[run.assay] ?? [];
    const steps = Object.fromEntries(run.steps.flatMap((s, i) => ids[i] ? [[ids[i], s]] : []));
    if (run.steps.some((s) => s.done || s.timerStartedAt !== void 0)) steps.pick = { done: true };
    return { ...run, schema: SCHEMA, steps };
  }
  var heldSamples = (read, roles) => roles.flatMap((r, i) => r === "sample" && read.tubes[i].call === "held" ? [i] : []);
  function tally(read, roles, taps, treatAt) {
    const rule = { treatAt };
    if (read.status === "failed") return { rule, readerPositives: void 0, tappedPositives: void 0, outcome: "failed" };
    const held = heldSamples(read, roles);
    const readerPositives = roles.filter((r, i) => r === "sample" && read.tubes[i].call === "pos").length;
    const tappedPositives = held.filter((i) => taps[i] === "pos").length;
    const open = held.filter((i) => !taps[i]).length;
    const known = readerPositives + tappedPositives;
    const outcome = known >= treatAt ? "treat" : known + open < treatAt ? "dont-treat" : void 0;
    return { rule, readerPositives, tappedPositives, outcome };
  }

  // src/app/update.ts
  var apply = null;
  var subs = /* @__PURE__ */ new Set();
  var stale = false;
  var reload = () => location.reload();
  function needReload() {
    if (stale) return;
    stale = true;
    subs.forEach((s) => s());
  }
  var currentUpdate = () => apply ?? (stale ? reload : null);

  // src/app/store.ts
  var db;
  var runs = () => db ??= createStore("pathoscan-field", "runs");
  var photoDb;
  var photos = () => photoDb ??= createStore("pathoscan-photos", "photos");
  var getPhoto = (key) => get(key, photos());
  var addRun = (run) => set(run.id, run, runs());
  function newer(run) {
    if (run.schema <= SCHEMA) return false;
    needReload();
    return true;
  }
  var NewerRun = class extends Error {
    constructor(id) {
      super(`Run ${id} is from a newer version of the app`);
    }
  };
  var getRun = async (id) => {
    const run = await get(id, runs());
    if (run && newer(run)) throw new NewerRun(id);
    return run && upgrade(run);
  };
  async function listRuns() {
    const all = await values(runs());
    return all.filter((r) => !newer(r)).map(upgrade).sort((a, b) => b.createdAt - a.createdAt);
  }
  function change(id, edit) {
    return update(
      id,
      (run) => {
        if (!run) throw new Error(`No run ${id}`);
        if (newer(run)) throw new NewerRun(id);
        return edit(upgrade(run));
      },
      runs()
    );
  }
  var setStepDone = (id, step, done) => change(id, (run) => withStep(run, step, { done }));
  var startTimer = (id, step, at) => change(id, (run) => run.steps[step]?.timerStartedAt === void 0 ? withStep(run, step, { timerStartedAt: at }) : run);
  async function takePhoto(id, jpeg) {
    const key = `${id}/${crypto.randomUUID()}`;
    await set(key, jpeg, photos());
    let old;
    let taken = false;
    try {
      await change(id, (run) => {
        if (run.read) return run;
        [old, taken] = [run.photoKey, true];
        return { ...run, photoKey: key };
      });
    } catch (e) {
      await del(key, photos());
      throw e;
    }
    if (taken && old) await del(old, photos());
    if (!taken) await del(key, photos());
    return taken ? key : null;
  }
  async function saveRead(id, photoKey, regions, roles, read, treatAt) {
    let saved = false;
    await change(id, (run) => {
      if (run.read || run.photoKey !== photoKey) return run;
      saved = true;
      return { ...run, regions, roles, read, readerVersion: READER_VERSION, ...tally(read, roles, run.taps, treatAt) };
    });
    return saved;
  }
  var setTap = (id, i, tap, treatAt) => change(id, (run) => {
    if (!run.read || !run.roles) return run;
    const taps = run.taps.map((t, j) => j === i ? tap : t);
    return { ...run, taps, ...tally(run.read, run.roles, taps, treatAt) };
  });
  async function askPersist() {
    if (navigator.storage?.persist && !await navigator.storage.persisted()) await navigator.storage.persist();
  }
  return __toCommonJS(entry_exports);
})();
