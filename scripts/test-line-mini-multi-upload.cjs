// FR-UPLOAD-003/004/005/010/013. Run: node scripts/test-line-mini-multi-upload.cjs
// Real Vue reactivity, SFC compiler, upload.ts and api.ts; all network/LIFF/DB are blocked or mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { File } = require('node:buffer');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'apps/line-mini/src');
const appRequire = createRequire(path.join(root, 'apps/line-mini/package.json'));
const ts = appRequire('typescript');
const vue = appRequire('vue');
const compiler = appRequire('@vue/compiler-sfc');
const read = name => fs.readFileSync(path.join(src, name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const photo = (name = 'scan.jpg', type = 'image/jpeg') => new File(['synthetic'], name, { type });
const ready = id => ({ id, tenant_id: 11, original_name: `${id}.jpg`, mime_type: 'image/jpeg', status: 'READY', reject_reason: '', size_bytes: 9, page_count: 1, created_at: '' });

function sandbox(extra = {}) {
  return vm.createContext({
    console, File, Blob, Response, performance, crypto, AbortController, AbortSignal,
    document: { documentElement: { lang: 'en' } },
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: () => { throw new Error('Real network forbidden'); },
    ...extra,
  });
}
function compile(text, name, context, imports = {}) {
  const compiled = ts.transpileModule(text.replaceAll('import.meta.env', '({ DEV: false })'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const requireMock = name => {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name.endsWith('.vue')) return vue.defineComponent({ inheritAttrs: false, render: () => null });
    throw new Error(`Unmocked dependency: ${name}`);
  };
  vm.runInContext(`(function(require, module, exports) { ${compiled}\n})`, context, { filename: name })(requireMock, module, module.exports);
  return module.exports;
}

const HOME_NAMES = 'onPicked, submitUrl, uploadItems, uploading, urlBusy, urlValue, inputBusy, fileInput, cameraInput, selectTenant, toggleWsMenu, wsMenuOpen, pick, errorMsg, '
  + 'failedItems, cancelledCount, cancelAllUsed, confirmAll, confirmRowKey, askCancelAll, keepUploadingAll, confirmCancelAll, cancelItem, keepItem, confirmCancelItem, retryFailed, '
  + 'pendingFiles, pendingError, pendingLoading, selectedIds, deleteIds, deleting, deleteError, loadPending, toggleSelect, toggleSelectAll, processFiles, processSelected, askDelete, keepRecords, confirmDelete';
const CONFIRM_NAMES = 'items, selectedIndex, selectedItem, file, loading, start, selectFile, starting, errorMsg, remaining, unavailable, startLabel';

function fixture(page = 'ScanHomePage', props = {}, options = {}) {
  const context = sandbox();
  const apiBase = compile(read('api.ts'), 'api.ts', context);
  const i18n = compile(read('i18n.ts'), 'i18n.ts', context);
  const mounted = [], unmounted = [], events = [];
  const scope = vue.effectScope();
  const state = { session: 1, write: 0 };
  const store = {
    currentTenantId: vue.ref(11), currentTenant: vue.ref({ tenant_id: 11, tenant_type: 'PERSONAL' }),
    user: vue.ref({ id: 1 }), tenants: vue.ref([]), isAuthenticated: vue.ref(true),
    navigate: (name, params) => events.push(['navigate', name, plain(params || {})]),
    refreshQuota: async () => events.push(['quota']), quotaForTenant: () => null,
    setTenant: tenant => { events.push(['tenant', tenant]); store.currentTenantId.value = tenant.tenant_id; },
    jobRoute: () => 'processing',
  };
  const api = {
    ...apiBase, dataEpochs: () => ({ ...state }),
    listJobs: async () => ({ items: [] }), fetchNotifications: async () => ({ unread_count: 0 }),
    importFromUrl: async (...args) => { events.push(['import', ...args]); return options.import ? options.import(...args) : { file: ready('url') }; },
    getFile: async id => { events.push(['get', id]); return options.get ? options.get(id) : { file: ready(id) }; },
    createJob: async input => { events.push(['job', plain(input)]); return options.job ? options.job(input) : { id: `job-${input.file_id}` }; },
    listPendingFiles: async tenantId => { events.push(['pending', tenantId]); return options.pending ? options.pending(tenantId) : { items: [] }; },
    deleteFile: async id => { events.push(['delete', id]); return options.del ? options.del(id) : { file_id: id, status: 'DELETED' }; },
  };
  const imports = {
    vue: { ...vue, onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => unmounted.push(fn) },
    '../api': api, '../store': store, '../i18n': i18n,
    '../i18nVue': { useT: () => ({ t: i18n.t, d: () => '', locale: vue.ref('en') }) },
    '../upload': {
      uploadFile: async (...args) => {
        events.push(['upload', args[0].name, args[1], args[2]]);
        if (options.upload) return options.upload(...args);
        args[3]?.(65);
        return ready(args[0].name);
      },
      newIdempotencyKey: () => `synthetic-${events.filter(e => e[0] === 'job').length}`,
    },
  };
  const text = read(`views/${page}.vue`);
  const { descriptor } = compiler.parse(text);
  let exports;
  if (options.render) {
    const sfc = compiler.compileScript(descriptor, { id: page, inlineTemplate: true });
    exports = scope.run(() => compile(sfc.content, page, context, imports));
  } else {
    context.defineProps = () => props;
    const names = page === 'ScanHomePage' ? HOME_NAMES : CONFIRM_NAMES;
    exports = scope.run(() => compile(`${descriptor.scriptSetup.content}\nexport { ${names} };`, page, context, imports));
  }
  const error = (status, key = 'error.network', code = 'SYNTHETIC_ERROR') => new api.ApiError(status, { code, message_key: key, request_id: '', retryable: true, field_errors: [] });
  return {
    page: exports, events, store, state, error, i18n, api,
    mount: async () => { for (const fn of mounted) await fn(); await tick(); },
    pick: (files, kind = 'files') => {
      // DOM elements are never Vue-proxied; preserve identity in this synthetic input too.
      const target = vue.markRaw({ files, value: 'selection', click: () => events.push(['picker']) });
      exports[kind === 'camera' ? 'cameraInput' : 'fileInput'].value = target;
      const action = exports.onPicked(target);
      assert.equal(target.value, '');
      return action;
    },
    close: () => { unmounted.forEach(fn => fn()); scope.stop(); },
    imports, context, mounted,
  };
}
const nav = f => f.events.filter(e => e[0] === 'navigate');
const uploads = f => f.events.filter(e => e[0] === 'upload');
const jobs = f => f.events.filter(e => e[0] === 'job');
const deletes = f => f.events.filter(e => e[0] === 'delete').map(e => e[1]);
const pendingCalls = f => f.events.filter(e => e[0] === 'pending');
const itemNamed = (f, name) => f.page.uploadItems.value.find(item => item.name === name);
const statuses = f => plain(f.page.uploadItems.value.map(item => item.status));

// Upload mock that stays in flight until aborted (or resolved by the test), like a real XHR.
function abortable(getF, holdNames) {
  const inflight = new Map();
  const upload = (file, tenant, purpose, report, opts) => {
    if (!holdNames.includes(file.name)) { report(50); return Promise.resolve(ready(file.name)); }
    return new Promise((resolve, reject) => {
      opts.onSession(`session-${file.name}`); report(30);
      inflight.set(file.name, { resolve, report });
      opts.signal.addEventListener('abort', () => {
        getF().events.push(['aborted', file.name]);
        reject(new (getF().api.UploadCancelledError)());
      }, { once: true });
    });
  };
  return { upload, inflight };
}

// The Files picker: the only file input that is multi-select and not a camera capture.
const isFilesInput = node => node.tag === 'input' && node.props.type === 'file' && 'multiple' in node.props && node.props.capture === undefined;

// A Vue custom renderer checks real compiled template visibility without a browser or network.
function renderFixture(f, props = {}) {
  const ui = { focused: null };
  const node = (tag, text = '') => vue.markRaw({ tag, text, props: {}, children: [], parent: null, focus() { ui.focused = this; } });
  const renderer = vue.createRenderer({
    createElement: tag => node(tag), createText: text => node('#text', text), createComment: text => node('#comment', text),
    setText: (target, text) => { target.text = text; },
    setElementText: (target, text) => { target.text = text; target.children = []; },
    patchProp: (target, key, old, next) => { target.props[key] = next; },
    insert: (target, parent, anchor) => {
      if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1);
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(index < 0 ? parent.children.length : index, 0, target); target.parent = parent;
    },
    remove: target => { if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1); },
    parentNode: target => target.parent,
    nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1] || null,
    insertStaticContent: (content, parent, anchor) => {
      // Static SVG decoration has no events or state relevant to these assertions.
      const target = node('#static'); const index = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(index < 0 ? parent.children.length : index, 0, target); target.parent = parent;
      return [target, target];
    },
  });
  const tree = node('root'); const app = renderer.createApp(f.page.default, props); app.mount(tree);
  const all = () => {
    const result = [];
    const visit = target => { result.push(target); target.children.forEach(visit); };
    visit(tree); return result;
  };
  const text = target => target.tag === '#comment' ? '' : target.text + target.children.map(text).join('');
  const cls = target => String(target.props.class || '');
  const button = label => all().find(target => target.tag === 'button' && text(target).trim() === label);
  return { all, text, cls, button, ui, close: () => { app.unmount(); f.close(); } };
}

// Compile every changed SFC including its template, not just extracted script logic.
test('all changed SFC templates compile; inputs, section order and App route params are intact', () => {
  for (const name of ['views/ScanHomePage.vue', 'views/ConfirmPage.vue', 'App.vue']) {
    const { descriptor, errors } = compiler.parse(read(name));
    assert.equal(errors.length, 0);
    compiler.compileScript(descriptor, { id: name, inlineTemplate: true });
  }
  const html = read('views/ScanHomePage.vue');
  assert.doesNotMatch(html, /ref="imageInput"/); assert.doesNotMatch(html, /pick\('photos'\)/);
  assert.equal((html.match(/class="entry-card"/g) || []).length, 2);
  assert.match(html, /\.entry-grid \{[^}]*repeat\(2, 1fr\)/);
  const files = html.match(/<input ref="fileInput"[^>]*>/)[0];
  const camera = html.match(/<input ref="cameraInput"[^>]*>/)[0];
  assert.doesNotMatch(files, /accept=/); assert.match(files, /\bmultiple\b/);
  assert.match(camera, /capture="environment"/); assert.doesNotMatch(camera, /\bmultiple\b/);
  const order = ['class="url-row"', 'class="upload-box"', 'class="pending-section"', "tt('home.recent')"].map(marker => html.indexOf(marker));
  assert(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1])), 'URL import, upload batch, Pending, Recent tasks order');
  assert.match(read('App.vue'), /:file-ids="route.params\?\.fileIds/);
});

test('10 Files upload sequentially, snapshot FileList, stay on home and refresh Pending per success', async () => {
  let f, concurrent = 0, maxConcurrent = 0;
  f = fixture('ScanHomePage', {}, { upload: async (file, tenant, purpose, report, opts) => {
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    assert.equal(tenant, 11); assert.equal(purpose, 'OCR_TASK'); assert(opts.signal); assert.equal(typeof opts.onSession, 'function');
    const item = itemNamed(f, file.name);
    assert.equal(item.status, 'uploading'); assert.equal(item.percent, 0);
    report(40); report(20); assert.equal(item.percent, 40);
    report(100); assert.equal(item.percent, 95);
    await Promise.resolve(); concurrent--; return ready(file.name);
  } });
  const files = Array.from({ length: 10 }, (_, i) => photo(`${i}.jpg`));
  const action = f.pick(files); files.splice(0); await action;
  assert.equal(uploads(f).length, 10); assert.equal(maxConcurrent, 1);
  assert(f.page.uploadItems.value.every(item => item.status === 'uploaded' && item.percent === 100));
  assert.equal(nav(f).length, 0); assert.equal(jobs(f).length, 0);
  assert.equal(pendingCalls(f).length, 10); assert(pendingCalls(f).every(e => e[1] === 11));
  f.close();
});

test('Files accepts a mixed JPG/PNG/PDF selection without dropping later files', async () => {
  const f = fixture(); await f.pick([photo(), photo('scan.png', 'image/png'), photo('scan.pdf', 'application/pdf')]);
  assert.equal(uploads(f).length, 3); assert.equal(nav(f).length, 0);
  assert.deepEqual(plain(f.page.uploadItems.value.map(item => item.format)), ['JPG', 'PNG', 'PDF']); f.close();
});

test('single-file Camera/Files no longer route to confirm; file goes to Pending', async () => {
  for (const kind of ['camera', 'files']) {
    const f = fixture(); await f.pick([photo()], kind);
    assert.equal(nav(f).length, 0); assert.deepEqual(statuses(f), ['uploaded']); assert.equal(pendingCalls(f).length, 1); f.close();
  }
});

test('URL import keeps the original confirm route', async () => {
  const f = fixture(); f.page.urlValue.value = 'https://synthetic.invalid/file.pdf'; await f.page.submitUrl();
  assert.deepEqual(nav(f), [['navigate', 'confirm', { fileId: 'url' }]]); f.close();
});

test('Files rejects Word/Excel/HEIC/unknown before upload; MIME, octet-stream or no-MIME JPG/PNG/PDF accepted', async () => {
  const f = fixture();
  await f.pick([photo('quote.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    photo('sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), photo('a.heic', 'image/heic'),
    photo('fake.pdf', 'text/plain'), photo('blob.bin', 'application/octet-stream'), photo('noext', ''),
    photo('no-mime.JPG', ''), photo('no-mime.png', ''), photo('octet.pdf', 'application/octet-stream'),
    photo('jpeg', 'image/jpeg'), photo('png', 'image/png'), photo('doc', 'application/pdf')]);
  assert.equal(uploads(f).length, 6);
  assert.equal(f.page.failedItems.value.length, 6);
  assert(f.page.uploadItems.value.slice(0, 6).every(item => item.error === f.i18n.t('home.fileTypeError') && !item.retryable));
  assert.equal(f.i18n.t('home.fileTypeError'), 'Unsupported file type. Use JPG, PNG or PDF.');
  assert.equal(nav(f).length, 0);
  await f.page.retryFailed(); assert.equal(uploads(f).length, 6, 'local type rejections are not retried'); f.close();
});

test('partial network failure does not auto-retry or block later uploads; Retry failed only re-uploads failures', async () => {
  let badAttempts = 0;
  const f = fixture('ScanHomePage', {}, { upload: async (file, tenant, purpose, report) => {
    report(35); if (file.name === 'bad.jpg' && ++badAttempts === 1) throw f.error(0); return ready(file.name);
  } });
  await f.pick([photo('ok.jpg'), photo('bad.jpg'), photo('later.jpg')]);
  assert.equal(uploads(f).length, 3); assert.equal(nav(f).length, 0);
  assert.deepEqual(statuses(f), ['uploaded', 'failed', 'uploaded']);
  assert.equal(itemNamed(f, 'bad.jpg').percent, 35); assert.equal(itemNamed(f, 'bad.jpg').error, f.i18n.t('err.error.network'));
  assert.equal(f.page.uploading.value, false);
  await tick(); assert.equal(uploads(f).length, 3, 'no automatic retry');
  await f.page.retryFailed();
  assert.deepEqual(uploads(f).slice(3).map(e => e[1]), ['bad.jpg']); assert.deepEqual(statuses(f), ['uploaded', 'uploaded', 'uploaded']);
  assert.equal(nav(f).length, 0); f.close();
});

test('all failed files stay visible; explicit reselection starts from zero', async () => {
  let attempts = 0;
  const f = fixture('ScanHomePage', {}, { upload: async (file, tenant, purpose, report) => {
    attempts++; assert.equal(f.page.uploadItems.value[0].percent, 0); report(45);
    if (attempts === 1) throw f.error(400, 'files.too_large'); return ready(file.name);
  } });
  await f.pick([photo()]); assert.equal(nav(f).length, 0);
  assert.equal(f.page.uploadItems.value[0].error, f.i18n.t('err.files.too_large'));
  await f.pick([photo()]); assert.equal(uploads(f).length, 2); assert.deepEqual(statuses(f), ['uploaded']); assert.equal(nav(f).length, 0); f.close();
});

test('401 stops subsequent files and marks them failed', async () => {
  const f = fixture('ScanHomePage', {}, { upload: async file => {
    if (file.name === 'expired.jpg') throw f.error(401, 'auth.session_expired'); return ready(file.name);
  } });
  await f.pick([photo('ok.jpg'), photo('expired.jpg'), photo('never.jpg')]);
  assert.equal(uploads(f).length, 2); assert.deepEqual(statuses(f), ['uploaded', 'failed', 'failed']);
  assert.equal(nav(f).length, 0); f.close();
});

for (const change of ['session', 'tenant', 'unmount']) test(`${change} during upload discards old records and stops subsequent files`, async () => {
  const pending = deferred(); const f = fixture('ScanHomePage', {}, { upload: () => pending.promise });
  const action = f.pick([photo(), photo('never.jpg')]);
  if (change === 'session') { f.state.session++; f.store.user.value = { id: 2 }; }
  if (change === 'tenant') f.store.currentTenantId.value = 22;
  if (change === 'unmount') f.close();
  pending.resolve(ready('old')); await action;
  assert.equal(uploads(f).length, 1); assert.equal(nav(f).length, 0); assert.equal(f.page.uploadItems.value.length, 0);
  f.close();
});

test('epoch-only change is guarded even before reactive store notifications', async () => {
  const pending = deferred(); const f = fixture('ScanHomePage', {}, { upload: () => pending.promise });
  const action = f.pick([photo(), photo('never.jpg')]); f.state.session++;
  pending.resolve(ready('old')); await action;
  assert.equal(uploads(f).length, 1); assert.equal(nav(f).length, 0); assert.equal(f.page.uploadItems.value.length, 0); f.close();
});

test('URL import, tenant switching and picker are mutually exclusive with upload', async () => {
  const pending = deferred(); const f = fixture('ScanHomePage', {}, { upload: () => pending.promise });
  const action = f.pick([photo()]); f.page.urlValue.value = 'https://synthetic.invalid/file.pdf';
  await f.page.submitUrl(); await f.pick([photo('ignored.jpg')]); f.page.selectTenant({ tenant_id: 22 }); f.page.toggleWsMenu(); f.page.pick('files');
  assert.equal(f.page.inputBusy.value, true); assert.equal(f.store.currentTenantId.value, 11);
  assert.equal(f.page.wsMenuOpen.value, false); assert.equal(uploads(f).length, 1);
  assert(!f.events.some(e => ['import', 'tenant', 'picker'].includes(e[0])));
  pending.resolve(ready('ok')); await action; f.close();
});

test('URL import blocks upload and switching, and ignores a changed session response', async () => {
  const pending = deferred(); const f = fixture('ScanHomePage', {}, { import: () => pending.promise });
  f.page.urlValue.value = 'https://synthetic.invalid/file.pdf'; const action = f.page.submitUrl();
  await f.pick([photo()]); f.page.selectTenant({ tenant_id: 22 });
  assert.equal(uploads(f).length, 0); assert.equal(f.store.currentTenantId.value, 11);
  f.state.session++; pending.resolve({ file: ready('old') }); await action;
  assert.equal(nav(f).length, 0); assert.equal(f.page.urlBusy.value, false); f.close();
});

test('cancelled picker creates no upload or navigation', async () => {
  const f = fixture(); await f.pick([]); assert.equal(uploads(f).length, 0); assert.equal(nav(f).length, 0); f.close();
});

// ---------- Upload cancellation (V5) ----------

test('Cancel all needs confirmation; Keep uploading changes nothing; confirm aborts XHR, deletes session, drops waiting', async () => {
  let f; const mock = abortable(() => f, ['b.jpg']);
  f = fixture('ScanHomePage', {}, { upload: mock.upload });
  const action = f.pick([photo('a.jpg'), photo('b.jpg'), photo('c.jpg'), photo('d.jpg')]); await tick();
  assert.deepEqual(statuses(f), ['uploaded', 'uploading', 'waiting', 'waiting']);
  f.page.askCancelAll();
  assert.equal(f.page.confirmAll.value, true); assert(!f.events.some(e => e[0] === 'aborted')); assert.deepEqual(deletes(f), []);
  f.page.keepUploadingAll();
  assert.equal(f.page.confirmAll.value, false); assert.deepEqual(statuses(f), ['uploaded', 'uploading', 'waiting', 'waiting']);
  f.page.askCancelAll(); f.page.confirmCancelAll(); await action;
  assert.deepEqual(f.events.filter(e => e[0] === 'aborted'), [['aborted', 'b.jpg']]);
  assert.deepEqual(deletes(f), ['session-b.jpg']);
  assert.deepEqual(uploads(f).map(e => e[1]), ['a.jpg', 'b.jpg']);
  assert.deepEqual(statuses(f), ['uploaded']); assert.equal(f.page.cancelledCount.value, 3); assert.equal(f.page.cancelAllUsed.value, true);
  assert.equal(f.page.uploading.value, false); assert.equal(nav(f).length, 0); f.close();
});

test('cancel-session delete failure is swallowed and never retried', async () => {
  let f; const mock = abortable(() => f, ['a.jpg']);
  f = fixture('ScanHomePage', {}, { upload: mock.upload, del: async () => { throw f.error(0); } });
  const action = f.pick([photo('a.jpg')]); await tick();
  f.page.askCancelAll(); f.page.confirmCancelAll(); await action; await tick();
  assert.deepEqual(deletes(f), ['session-a.jpg']); assert.equal(f.page.errorMsg.value, ''); f.close();
});

test('uploading row Cancel needs confirmation, then only that file is cancelled and the queue continues', async () => {
  let f; const mock = abortable(() => f, ['a.jpg']);
  f = fixture('ScanHomePage', {}, { upload: mock.upload });
  const action = f.pick([photo('a.jpg'), photo('b.jpg')]); await tick();
  const a = itemNamed(f, 'a.jpg');
  f.page.cancelItem(a);
  assert.equal(f.page.confirmRowKey.value, a.key); assert(!f.events.some(e => e[0] === 'aborted'));
  f.page.keepItem(); assert.equal(f.page.confirmRowKey.value, null); assert.deepEqual(statuses(f), ['uploading', 'waiting']);
  f.page.cancelItem(a); f.page.confirmCancelItem(a); await action;
  assert.deepEqual(f.events.filter(e => e[0] === 'aborted'), [['aborted', 'a.jpg']]); assert.deepEqual(deletes(f), ['session-a.jpg']);
  assert.deepEqual(uploads(f).map(e => e[1]), ['a.jpg', 'b.jpg']);
  assert.deepEqual(plain(f.page.uploadItems.value.map(item => item.name)), ['b.jpg']); assert.deepEqual(statuses(f), ['uploaded']);
  assert.equal(f.page.cancelledCount.value, 1); assert.equal(f.page.cancelAllUsed.value, false); f.close();
});

test('waiting row Cancel removes it directly without confirmation and it is never uploaded', async () => {
  const pending = deferred(); const f = fixture('ScanHomePage', {}, { upload: file => file.name === 'a.jpg' ? pending.promise : ready(file.name) });
  const action = f.pick([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')]); await tick();
  f.page.cancelItem(itemNamed(f, 'b.jpg'));
  assert.equal(f.page.confirmRowKey.value, null); assert.deepEqual(plain(f.page.uploadItems.value.map(item => item.name)), ['a.jpg', 'c.jpg']);
  pending.resolve(ready('a.jpg')); await action;
  assert.deepEqual(uploads(f).map(e => e[1]), ['a.jpg', 'c.jpg']); assert.deepEqual(deletes(f), []);
  assert.deepEqual(statuses(f), ['uploaded', 'uploaded']); assert.equal(f.page.cancelledCount.value, 1); f.close();
});

test('a file confirmed as cancelled but completed server-side is deleted, never shown as uploaded', async () => {
  const pending = deferred(); let opts;
  const f = fixture('ScanHomePage', {}, { upload: (file, tenant, purpose, report, o) => { opts = o; o.onSession('session-a'); return pending.promise; } });
  const action = f.pick([photo('a.jpg')]); await tick();
  const a = itemNamed(f, 'a.jpg'); f.page.cancelItem(a); f.page.confirmCancelItem(a);
  assert.equal(opts.signal.aborted, true);
  pending.resolve(ready('a-ready')); await action; // Mock ignores the signal, like a response racing the abort.
  assert.deepEqual(deletes(f), ['session-a']); assert.equal(f.page.uploadItems.value.length, 0); assert.equal(pendingCalls(f).length, 0); f.close();
});

test('cancel confirmation for a file that already finished is a no-op', async () => {
  const pending = deferred(); const f = fixture('ScanHomePage', {}, { upload: () => pending.promise });
  const action = f.pick([photo('a.jpg')]); await tick();
  const a = itemNamed(f, 'a.jpg'); f.page.cancelItem(a);
  pending.resolve(ready('a.jpg')); await action;
  assert.equal(f.page.confirmRowKey.value, null); f.page.confirmCancelItem(a);
  assert.deepEqual(statuses(f), ['uploaded']); assert.deepEqual(deletes(f), []); assert.equal(f.page.cancelledCount.value, 0); f.close();
});

// ---------- Pending list ----------

test('Pending loads for the current tenant on mount; tenant switch drops the stale response', async () => {
  const calls = [];
  const f = fixture('ScanHomePage', {}, { pending: tenantId => { const d = deferred(); calls.push({ tenantId, d }); return d.promise; } });
  const mounting = f.mount();
  assert.deepEqual(calls.map(c => c.tenantId), [11]);
  f.store.currentTenantId.value = 22; await tick();
  assert.deepEqual(calls.map(c => c.tenantId), [11, 22]);
  calls[1].d.resolve({ items: [ready('t22')] }); await tick();
  calls[0].d.resolve({ items: [ready('old-t11')] }); await mounting; await tick();
  assert.deepEqual(plain(f.page.pendingFiles.value.map(file => file.id)), ['t22']); f.close();
});

test('Pending ignores a response after session change and shows localized load errors', async () => {
  const d = deferred(); const f = fixture('ScanHomePage', {}, { pending: () => d.promise });
  const mounting = f.mount(); f.state.session++;
  d.resolve({ items: [ready('old')] }); await mounting; await tick();
  assert.equal(f.page.pendingFiles.value.length, 0); f.close();
  const g = fixture('ScanHomePage', {}, { pending: async () => { throw g.error(0); } });
  await g.mount(); assert.equal(g.page.pendingError.value, g.i18n.t('err.error.network')); g.close();
});

function pendingServer(ids) {
  const server = ids.map(ready);
  return { server, pending: async () => ({ items: server.map(file => ({ ...file })) }) };
}

test('Process opens confirm for one file; Process (N) passes the first id plus JSON ids in list order', async () => {
  const { pending } = pendingServer(['p1', 'p2', 'p3']);
  const f = fixture('ScanHomePage', {}, { pending }); await f.mount();
  f.page.processFiles(['p2']); assert.deepEqual(nav(f)[0], ['navigate', 'confirm', { fileId: 'p2' }]);
  f.page.toggleSelect('p3'); f.page.toggleSelect('p1'); f.page.processSelected();
  assert.deepEqual(nav(f)[1], ['navigate', 'confirm', { fileId: 'p1', fileIds: '["p1","p3"]' }]);
  f.page.toggleSelectAll(); assert.deepEqual(plain(f.page.selectedIds.value), ['p1', 'p2', 'p3']);
  f.page.toggleSelectAll(); assert.deepEqual(plain(f.page.selectedIds.value), []);
  assert.equal(jobs(f).length, 0); f.close();
});

test('single delete needs confirmation; Keep records changes nothing; confirm deletes and refreshes', async () => {
  const { server, pending } = pendingServer(['p1', 'p2']);
  const f = fixture('ScanHomePage', {}, { pending, del: async id => { server.splice(server.findIndex(x => x.id === id), 1); return { file_id: id, status: 'DELETED' }; } });
  await f.mount(); const before = pendingCalls(f).length;
  f.page.askDelete(['p1']); assert.deepEqual(plain(f.page.deleteIds.value), ['p1']); assert.deepEqual(deletes(f), []);
  f.page.keepRecords(); assert.deepEqual(plain(f.page.deleteIds.value), []); assert.equal(f.page.pendingFiles.value.length, 2);
  f.page.askDelete(['p1']); await f.page.confirmDelete();
  assert.deepEqual(deletes(f), ['p1']); assert.deepEqual(plain(f.page.pendingFiles.value.map(x => x.id)), ['p2']);
  assert.equal(pendingCalls(f).length, before + 1); assert.deepEqual(plain(f.page.deleteIds.value), []); f.close();
});

test('batch delete partial failure keeps the failed record with a localized error and deselects successes', async () => {
  const { server, pending } = pendingServer(['p1', 'p2', 'p3']);
  let f;
  f = fixture('ScanHomePage', {}, { pending, del: async id => {
    if (id === 'p2') throw f.error(409, 'files.in_use', 'CONFLICT');
    server.splice(server.findIndex(x => x.id === id), 1); return { file_id: id, status: 'DELETED' };
  } });
  await f.mount(); f.page.toggleSelectAll(); f.page.askDelete(f.page.selectedIds.value);
  await f.page.confirmDelete();
  assert.deepEqual(deletes(f), ['p1', 'p2', 'p3']);
  assert.deepEqual(plain(f.page.pendingFiles.value.map(x => x.id)), ['p2']); assert.deepEqual(plain(f.page.selectedIds.value), ['p2']);
  assert.equal(f.page.deleteError.value, f.i18n.t('home.pending.deleteFailed', { n: 1, reason: f.i18n.t('err.files.in_use') }));
  f.close();
});

test('delete in progress blocks repeated clicks; Pending actions stay available during upload', async () => {
  const { pending } = pendingServer(['p1', 'p2']); const del = deferred(); const up = deferred();
  const f = fixture('ScanHomePage', {}, { pending, del: () => del.promise, upload: () => up.promise });
  await f.mount(); const uploading = f.pick([photo('a.jpg')]); await tick();
  assert.equal(f.page.uploading.value, true);
  f.page.askDelete(['p1']); const action = f.page.confirmDelete();
  assert.equal(f.page.deleting.value, true);
  await f.page.confirmDelete(); f.page.askDelete(['p2']); f.page.processFiles(['p2']);
  assert.deepEqual(deletes(f), ['p1']); assert.deepEqual(plain(f.page.deleteIds.value), ['p1']); assert.equal(nav(f).length, 0);
  del.resolve({ file_id: 'p1', status: 'DELETED' }); await action;
  assert.equal(f.page.deleting.value, false); f.page.processFiles(['p2']);
  assert.deepEqual(nav(f)[0], ['navigate', 'confirm', { fileId: 'p2' }]);
  up.resolve(ready('a.jpg')); await uploading; f.close();
});

// ---------- Confirm page ----------

test('multi-file confirmation fetches all, switches preview and never creates jobs on load', async () => {
  const f = fixture('ConfirmPage', { fileId: 'a', fileIds: '["a","b","a"]' }); await f.mount();
  assert.deepEqual(f.events.filter(e => e[0] === 'get'), [['get', 'a'], ['get', 'b']]);
  assert.equal(jobs(f).length, 0); assert.equal(f.page.file.value.id, 'a'); f.page.selectFile(1);
  assert.equal(f.page.file.value.id, 'b'); f.page.selectFile(2); assert.equal(f.page.selectedIndex.value, 1);
  assert.equal(jobs(f).length, 0); assert.equal(f.page.startLabel(), 'Start processing (2 files)'); f.close();
});

test('one Start click creates all jobs in order with own idempotency keys, then returns home', async () => {
  const f = fixture('ConfirmPage', { fileId: 'a', fileIds: '["a","b","c"]' }); await f.mount();
  await f.page.start();
  assert.deepEqual(jobs(f).map(e => e[1].file_id), ['a', 'b', 'c']);
  assert.equal(new Set(jobs(f).map(e => e[1].idempotency_key)).size, 3);
  assert.deepEqual(nav(f), [['navigate', 'scan', {}]]); f.close();
});

test('partial start failure stops, keeps started files, then processes only the rest reusing the failed key', async () => {
  let bAttempts = 0;
  let f;
  f = fixture('ConfirmPage', { fileId: 'a', fileIds: '["a","b","c"]' }, { job: async input => {
    if (input.file_id === 'b' && ++bAttempts === 1) throw f.error(0); return { id: `job-${input.file_id}` };
  } });
  await f.mount(); await f.page.start();
  assert.deepEqual(jobs(f).map(e => e[1].file_id), ['a', 'b']); assert.equal(nav(f).length, 0);
  assert.equal(f.page.items.value[0].jobId, 'job-a'); assert(f.page.errorMsg.value.includes(f.i18n.t('err.error.network')));
  assert.deepEqual(plain(f.page.remaining.value.map(item => item.id)), ['b', 'c']); assert.equal(f.page.startLabel(), 'Start processing (2 files)');
  await tick(); assert.equal(jobs(f).length, 2, 'no automatic retry');
  await f.page.start();
  assert.deepEqual(jobs(f).map(e => e[1].file_id), ['a', 'b', 'b', 'c']);
  assert.equal(jobs(f)[1][1].idempotency_key, jobs(f)[2][1].idempotency_key);
  assert.deepEqual(nav(f), [['navigate', 'scan', {}]]); f.close();
});

test('multi-file PLAN_EXPIRED routes to plans and stops', async () => {
  const f = fixture('ConfirmPage', { fileId: 'a', fileIds: '["a","b"]' }, { job: async () => { throw f.error(402, 'plan.expired', 'PLAN_EXPIRED'); } });
  await f.mount(); await f.page.start();
  assert.equal(jobs(f).length, 1); assert.deepEqual(nav(f), [['navigate', 'plans', {}]]); f.close();
});

test('single Start keeps original processing navigation, malformed JSON safely falls back', async () => {
  for (const fileIds of [undefined, 'broken-json', '[42]', '[]', '["one"]']) {
    const f = fixture('ConfirmPage', { fileId: 'one', fileIds }); await f.mount(); await f.page.start();
    assert.equal(jobs(f).length, 1); assert.deepEqual(nav(f)[0], ['navigate', 'processing', { jobId: 'job-one' }]); f.close();
  }
});

test('an unavailable selected file blocks multi start without hiding other previews', async () => {
  const f = fixture('ConfirmPage', { fileId: 'a', fileIds: '["a","b"]' }, { get: async id => {
    if (id === 'a') throw f.error(404, 'error.not_found'); return { file: ready(id) };
  } });
  await f.mount(); assert.equal(f.page.items.value[0].file, null); assert(f.page.items.value[0].error);
  assert.equal(f.page.unavailable.value, true); await f.page.start(); assert.equal(jobs(f).length, 0);
  f.page.selectFile(1); assert.equal(f.page.file.value.id, 'b'); f.close();
});

test('start failure retains preview; explicit retry reuses idempotency key; no auto retry', async () => {
  let attempts = 0;
  const f = fixture('ConfirmPage', { fileId: 'a' }, { job: async () => { if (++attempts === 1) throw f.error(0); return { id: 'success' }; } });
  await f.mount(); await f.page.start(); assert.equal(jobs(f).length, 1); assert.equal(f.page.file.value.id, 'a');
  assert(f.page.errorMsg.value); assert.equal(f.page.starting.value, false);
  await f.page.start(); assert.equal(jobs(f)[0][1].idempotency_key, jobs(f)[1][1].idempotency_key); f.close();
});

test('in-flight Start blocks double click and selection changes', async () => {
  const pending = deferred(); const f = fixture('ConfirmPage', { fileId: 'a', fileIds: '["a","b"]' }, { job: () => pending.promise });
  await f.mount(); const action = f.page.start(); await f.page.start(); f.page.selectFile(1);
  assert.equal(jobs(f).length, 1); assert.equal(f.page.selectedIndex.value, 0);
  pending.resolve({ id: 'job' }); await action; f.close();
});

test('not-ready file cannot start, and empty confirmation does not load forever', async () => {
  const f = fixture('ConfirmPage', { fileId: 'a' }, { get: async () => ({ file: { ...ready('a'), status: 'VALIDATING' } }) });
  await f.mount(); await f.page.start(); assert.equal(jobs(f).length, 0); f.close();
  const empty = fixture('ConfirmPage', { fileId: '' }); await empty.mount(); assert.equal(empty.page.loading.value, false); assert(empty.page.errorMsg.value); empty.close();
});

test('PLAN_EXPIRED preserves existing plans navigation', async () => {
  const f = fixture('ConfirmPage', { fileId: 'a' }, { job: async () => { throw f.error(402, 'plan.expired', 'PLAN_EXPIRED'); } });
  await f.mount(); await f.page.start(); assert.deepEqual(nav(f)[0], ['navigate', 'plans', {}]); f.close();
});

for (const [stage, ids] of [['load', undefined], ['start', undefined], ['multi start', '["a","b"]']]) test(`confirmation ignores old session results during ${stage}`, async () => {
  const pending = deferred();
  const f = fixture('ConfirmPage', { fileId: 'a', fileIds: ids }, stage === 'load' ? { get: () => pending.promise } : { job: () => pending.promise });
  let action;
  if (stage === 'load') action = f.mount(); else { await f.mount(); action = f.page.start(); }
  f.state.session++; f.store.user.value = { id: 2 };
  pending.resolve(stage === 'load' ? { file: ready('a') } : { id: 'old-job' }); await action;
  assert.equal(f.page.items.value.length, 0); assert.equal(nav(f).length, 0); assert(jobs(f).length <= 1); f.close();
});

test('all new translation keys exist in both English and Thai dictionaries', () => {
  const source = read('i18n.ts'); const thStart = source.indexOf('const th: Dict');
  const en = source.slice(0, thStart), th = source.slice(thStart);
  const keys = [...new Set([...read('views/ScanHomePage.vue').matchAll(/tt\('((?:home\.(?:batch|pending|upload)|home\.fileTypeError)[^']*)'/g),
    ...read('views/ConfirmPage.vue').matchAll(/t\('(confirm\.[^']+)'/g)].map(m => m[1]))];
  keys.push('home.upload.waiting', 'home.upload.uploading', 'home.upload.uploaded', 'home.upload.failed', 'err.files.in_use');
  assert(keys.length > 50);
  for (const key of keys.filter(k => !k.endsWith('.'))) {
    assert(en.includes(`'${key}':`), `en ${key}`); assert(th.includes(`'${key}':`), `th ${key}`);
  }
  const f = fixture(); f.i18n.setLocale('th');
  assert.notEqual(f.i18n.t('home.pending.title'), 'Pending'); assert.notEqual(f.i18n.t('home.batch.cancelAll'), 'Cancel all'); f.close();
});

// ---------- Compiled templates ----------

test('compiled home shows batch rows, counter, Cancel all dialog focus/Esc, then failed-only rows with Retry', async () => {
  const first = deferred();
  const f = fixture('ScanHomePage', {}, { render: true, upload: async (file, tenant, purpose, report) => {
    report(45);
    if (file.name === 'first.jpg') return first.promise;
    if (file.name === 'bad.jpg') throw f.error(0);
    return ready(file.name);
  } });
  const view = renderFixture(f); await f.mount(); await vue.nextTick();
  const input = view.all().find(isFilesInput);
  input.files = [photo('first.jpg'), photo('bad.jpg'), photo('last.jpg')]; input.value = 'selection';
  const action = input.props.onChange({ target: input }); await vue.nextTick();
  assert.equal(input.value, '');
  assert(view.all().some(node => view.text(node) === 'Uploading files'));
  assert(view.all().some(node => view.cls(node) === 'upload-counter' && view.text(node) === '1 / 3'));
  assert.equal(view.all().filter(node => node.props.role === 'progressbar').length, 1);
  assert.equal(view.all().filter(node => view.cls(node).includes('row-state') && view.text(node) === 'Waiting').length, 2);
  assert(view.all().some(node => view.cls(node).includes('row-state') && view.text(node) === '45%'));
  assert.equal(view.all().filter(node => node.tag === 'button' && view.cls(node).includes('row-cancel')).length, 3);
  // Status live regions never contain percentages.
  assert(view.all().filter(node => node.props.role === 'status' || node.props['aria-live'] === 'polite').every(node => !view.text(node).includes('%')));
  assert(view.all().filter(node => node.tag === 'button' && view.cls(node).includes('entry-card')).every(node => node.props.disabled));
  assert(view.all().find(node => node.tag === 'button' && node.props.class === 'url-row').props.disabled);
  view.button('Cancel all').props.onClick(); await vue.nextTick(); await vue.nextTick();
  const dialog = view.all().find(node => node.props.role === 'alertdialog');
  assert(dialog && view.text(dialog).includes('Cancel all unfinished uploads?') && view.text(dialog).includes('Cancel all (3)'));
  assert.equal(view.ui.focused, view.button('Keep uploading'));
  dialog.props.onKeydown({ key: 'Escape', preventDefault() {} }); await vue.nextTick();
  assert(!view.all().some(node => node.props.role === 'alertdialog'));
  first.resolve(ready('first.jpg')); await action; await vue.nextTick();
  assert.equal(nav(f).length, 0); assert.equal(uploads(f).length, 3);
  assert(view.all().some(node => view.text(node) === 'Upload finished'));
  assert(view.all().some(node => view.cls(node) === 'file-name' && view.text(node) === 'bad.jpg'));
  assert(!view.all().some(node => view.cls(node) === 'file-name' && view.text(node) === 'last.jpg'));
  assert(view.button('Retry failed'));
  // Failed rows offer their own Retry and Cancel (no confirmation; nothing is uploading).
  const rowCancels = () => view.all().filter(node => node.tag === 'button' && view.cls(node).includes('row-cancel'));
  const rowRetries = () => view.all().filter(node => node.tag === 'button' && view.cls(node).includes('row-retry'));
  assert.equal(rowCancels().length, 1); assert.equal(rowRetries().length, 1);
  assert.equal(rowRetries()[0].props['aria-label'], 'Retry bad.jpg');
  await rowRetries()[0].props.onClick(); await vue.nextTick();
  assert.equal(uploads(f).length, 4, 'row Retry re-uploads only that file');
  assert(view.all().some(node => view.cls(node) === 'file-name' && view.text(node) === 'bad.jpg'));
  rowCancels()[0].props.onClick(); await vue.nextTick();
  assert(!view.all().some(node => node.props.role === 'alertdialog'));
  assert(!view.all().some(node => view.cls(node) === 'file-name' && view.text(node) === 'bad.jpg'));
  assert(view.all().some(node => view.text(node).includes('1 cancelled · 2 kept in Pending')));
  assert.equal(uploads(f).length, 4);
  view.close();
});

test('compiled home row Cancel confirmation and summaries for done and cancelled batches', async () => {
  let f; const mock = abortable(() => f, ['b.jpg']);
  f = fixture('ScanHomePage', {}, { render: true, upload: mock.upload });
  const view = renderFixture(f); await f.mount(); await vue.nextTick();
  const input = view.all().find(isFilesInput);
  input.files = [photo('a.jpg'), photo('b.jpg'), photo('c.jpg')];
  const action = input.props.onChange({ target: input }); await tick(); await vue.nextTick();
  const rowCancel = () => view.all().find(node => node.tag === 'button' && view.cls(node).includes('row-cancel active'));
  rowCancel().props.onClick(); await vue.nextTick(); await vue.nextTick();
  const dialog = view.all().find(node => node.props.role === 'alertdialog');
  assert(view.text(dialog).includes('Uploading in progress. Cancel this file?'));
  assert.equal(view.ui.focused, view.button('Keep uploading'));
  view.button('Cancel upload').props.onClick(); await action; await vue.nextTick();
  const note = view.all().find(node => view.cls(node).includes('batch-note'));
  assert(view.text(note).includes('Upload finished') && view.text(note).includes('1 cancelled · 2 kept in Pending'));
  view.close();

  const g = fixture('ScanHomePage', {}, { render: true }); const done = renderFixture(g); await g.mount();
  const input2 = done.all().find(isFilesInput);
  input2.files = [photo('x.jpg'), photo('y.jpg')]; await input2.props.onChange({ target: input2 }); await vue.nextTick();
  const doneNote = done.all().find(node => done.cls(node).includes('batch-note done'));
  assert(done.text(doneNote).includes('2 files uploaded') && done.text(doneNote).includes('Ready in Pending')); done.close();
});

test('compiled Pending renders rows, empty state and an alertdialog delete confirmation with focus and Esc', async () => {
  const { pending } = pendingServer(['p1', 'p2']);
  const f = fixture('ScanHomePage', {}, { render: true, pending });
  const view = renderFixture(f); await f.mount(); await vue.nextTick();
  assert(view.all().some(node => view.cls(node) === 'count-badge' && view.text(node) === '2'));
  assert(view.all().some(node => view.text(node).trim() === 'Uploaded · Ready to preview and process'));
  assert.equal(view.all().filter(node => view.cls(node).includes('pending-row')).length, 2);
  assert.equal(view.all().filter(node => node.tag === 'input' && node.props.type === 'checkbox').length, 2);
  assert(view.button('Delete selected').props.disabled); assert(view.button('Process selected').props.disabled);
  view.all().find(node => node.tag === 'button' && node.props['aria-label'] === 'Delete p2.jpg').props.onClick();
  await vue.nextTick(); await vue.nextTick();
  const dialog = view.all().find(node => node.props.role === 'alertdialog');
  assert(view.text(dialog).includes('Delete 1 pending record?') && view.text(dialog).includes('p2.jpg') && view.text(dialog).includes('Recent tasks will not be affected'));
  assert.equal(view.ui.focused, view.button('Keep records'));
  dialog.props.onKeydown({ key: 'Escape', preventDefault() {} }); await vue.nextTick();
  assert(!view.all().some(node => node.props.role === 'alertdialog')); assert.deepEqual(deletes(f), []);
  view.all().filter(node => node.tag === 'input' && node.props.type === 'checkbox').forEach(node => node.props.onChange());
  await vue.nextTick();
  assert(view.all().some(node => view.text(node) === '2 selected'));
  view.button('Process (2)').props.onClick();
  assert.deepEqual(nav(f)[0], ['navigate', 'confirm', { fileId: 'p1', fileIds: '["p1","p2"]' }]);
  view.button('Delete (2)').props.onClick(); await vue.nextTick();
  view.button('Delete 2').props.onClick(); await tick(); await vue.nextTick();
  assert.deepEqual(deletes(f), ['p1', 'p2']);
  view.close();

  const g = fixture('ScanHomePage', {}, { render: true }); const empty = renderFixture(g); await g.mount(); await vue.nextTick();
  assert(empty.all().some(node => empty.text(node).includes('No pending files') && empty.text(node).includes('Uploaded files will appear here.'))); empty.close();
});

test('compiled home shows Camera/Files only; Files input rejects Word before upload and renders localized error', async () => {
  const f = fixture('ScanHomePage', {}, { render: true });
  const view = renderFixture(f); await f.mount(); await vue.nextTick();
  const cards = view.all().filter(node => node.tag === 'button' && view.cls(node).includes('entry-card'));
  assert.deepEqual(cards.map(node => view.text(node).trim()), ['Camera', 'Files']);
  assert(!view.all().some(node => node.tag === 'button' && view.text(node).trim() === 'Photos'));
  const input = view.all().find(isFilesInput);
  assert.equal(input.props.accept, undefined);
  input.files = [photo('quote.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')]; input.value = 'selection';
  await input.props.onChange({ target: input }); await vue.nextTick();
  assert.equal(uploads(f).length, 0); assert.equal(nav(f).length, 0);
  assert(view.all().some(node => typeof node.text === 'string' && node.text.includes(f.i18n.t('home.fileTypeError'))));
  assert(!view.all().some(node => node.tag === 'button' && view.cls(node).includes('row-retry')), 'type rejection offers Cancel only'); view.close();
});

test('compiled confirm template retains image and Start button after createJob failure', async () => {
  const f = fixture('ConfirmPage', {}, { render: true, job: async () => { throw f.error(0); } });
  const view = renderFixture(f, { fileId: 'a' }); await f.mount(); await vue.nextTick();
  let button = view.all().find(node => node.tag === 'button' && node.props.class === 'primary-btn');
  assert(button); assert.equal(view.text(button).trim(), 'Start processing');
  assert(!view.all().some(node => view.text(node) === 'Review selected files · OCR has not started'));
  await button.props.onClick(); await vue.nextTick();
  assert(view.all().some(node => node.tag === 'p' && node.props.role === 'alert'));
  assert(view.all().some(node => node.tag === 'img' && node.props.src.includes('/files/a/')));
  button = view.all().find(node => node.tag === 'button' && node.props.class === 'primary-btn');
  assert(button); assert.equal(button.props.disabled, false); view.close();
});

test('compiled multi confirm shows review context, File X of N switcher and one Start for all files', async () => {
  const f = fixture('ConfirmPage', {}, { render: true });
  const view = renderFixture(f, { fileId: 'a', fileIds: '["a","b"]' }); await f.mount(); await vue.nextTick();
  assert(view.all().some(node => view.text(node) === 'Review selected files · OCR has not started'));
  assert(view.all().some(node => view.text(node) === 'File 1 of 2'));
  const prev = view.all().find(node => node.props['aria-label'] === 'Previous file');
  const next = view.all().find(node => node.props['aria-label'] === 'Next file');
  assert.equal(prev.props.disabled, true); next.props.onClick(); await vue.nextTick();
  assert(view.all().some(node => view.text(node) === 'File 2 of 2'));
  assert(view.all().some(node => node.tag === 'img' && node.props.src.includes('/files/b/')));
  const starts = view.all().filter(node => node.tag === 'button' && node.props.class === 'primary-btn');
  assert.equal(starts.length, 1); assert.equal(view.text(starts[0]).trim(), 'Start processing (2 files)');
  assert(!view.all().some(node => view.text(node) === 'View processing'));
  await starts[0].props.onClick(); await vue.nextTick();
  assert.equal(jobs(f).length, 2); assert.deepEqual(nav(f), [['navigate', 'scan', {}]]); view.close();
});

// ---------- Real transport (upload.ts + api.ts) ----------

// Fully mocked XHR runs the existing real transport/helper, including all three 120-second stages.
function transportFixture(failAt = -1, failure = '', hold = -1) {
  const requests = [], timers = new Map(); let timerId = 0;
  class XHR {
    constructor() { this.upload = {}; }
    open(method, url) { this.method = method; this.url = url; this.headers = {}; }
    setRequestHeader(key, value) { this.headers[key] = value; }
    abort() { this.aborted = true; requests[this.index].aborted = true; this.onabort(); }
    send(body) {
      requests.push({ method: this.method, url: this.url, headers: this.headers, body, timeout: this.timeout, credentials: this.withCredentials });
      const index = this.index = requests.length - 1;
      if (index === hold) return; // Stays in flight until aborted.
      queueMicrotask(() => {
        if (this.aborted) return;
        if (index === failAt && ['error', 'abort', 'timeout'].includes(failure)) { this[`on${failure}`](); return; }
        if (index === failAt && failure === 'zero') { this.status = 0; this.onload(); return; }
        this.status = index === failAt && failure === '401' ? 401 : 200;
        this.statusText = 'Synthetic';
        const data = index === 0 ? { upload_id: 'synthetic-upload', file: ready('f') } : index === 2 ? { file: ready('f') } : {};
        this.responseText = JSON.stringify(this.status === 401 ? { code: 'AUTH_REQUIRED', message_key: 'auth.session_expired' } : { code: 'OK', data });
        if (index === 1) this.upload.onprogress?.({ lengthComputable: true, loaded: 9, total: 9 });
        this.onload();
      });
    }
  }
  const fetches = [];
  const context = sandbox({ XMLHttpRequest: XHR, window: {
    setInterval: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearInterval: id => timers.delete(id),
  }, fetch: async (url, init) => {
    fetches.push({ url, method: init.method, headers: init.headers });
    const data = url.includes('/pending') ? { items: [ready('p')] } : { file_id: 'p', status: 'DELETED' };
    return new Response(JSON.stringify({ code: 'OK', data }), { status: 200 });
  } });
  const api = compile(read('api.ts'), 'api.ts', context); api.setCsrfToken('synthetic-csrf');
  const upload = compile(read('upload.ts'), 'upload.ts', context, { './api': api });
  return { api, upload, requests, timers, fetches };
}

test('real upload uses three XHR stages, original bytes, Cookie/CSRF, 120s, monotonic progress, reports session', async () => {
  const f = transportFixture(); const input = photo(); const progress = [], sessions = [];
  const result = await f.upload.uploadFile(input, 11, 'OCR_TASK', value => progress.push(value), { onSession: id => sessions.push(id) });
  assert.equal(result.id, 'f'); assert.equal(f.requests.length, 3); assert.equal(f.requests[1].body, input);
  assert.deepEqual(f.requests.map(r => r.method), ['POST', 'PUT', 'POST']); assert.deepEqual(sessions, ['synthetic-upload']);
  assert(f.requests.every(r => r.timeout === 120000 && r.credentials && r.headers['X-CSRF-Token'] === 'synthetic-csrf'));
  assert.equal(JSON.parse(f.requests[0].body).tenant_id, 11);
  assert.equal(progress[0], 0); assert.equal(progress.at(-1), 100); assert(progress.slice(0, -1).every(p => p <= 95));
  assert(progress.every((p, i) => i === 0 || p >= progress[i - 1])); assert.equal(f.timers.size, 0);
});

for (const failure of ['error', 'abort', 'timeout', 'zero', '401']) {
  for (const stage of [0, 1, 2]) test(`real XHR ${failure} at stage ${stage + 1}: no retry/next stage/100% and timer cleaned`, async () => {
    const f = transportFixture(stage, failure), progress = [];
    await assert.rejects(f.upload.uploadFile(photo(), 11, 'OCR_TASK', p => progress.push(p)), error => error instanceof f.api.ApiError && error.status === (failure === '401' ? 401 : 0));
    assert.equal(f.requests.length, stage + 1); assert(!progress.includes(100)); assert.equal(f.timers.size, 0);
  });
}

for (const stage of [0, 1, 2]) test(`real cancel during stage ${stage + 1}: xhr.abort, UploadCancelledError, no later stage/100%, timer cleaned`, async () => {
  const f = transportFixture(-1, '', stage); const controller = new AbortController(); const progress = [], sessions = [];
  const action = f.upload.uploadFile(photo(), 11, 'OCR_TASK', p => progress.push(p), { signal: controller.signal, onSession: id => sessions.push(id) });
  await tick(); assert.equal(f.requests.length, stage + 1);
  const intervals = [...f.timers.values()]; controller.abort();
  intervals.forEach(timer => timer.fn()); // A late estimate tick must not report after cancellation.
  await assert.rejects(action, error => error instanceof f.api.UploadCancelledError && !(error instanceof f.api.ApiError));
  assert.equal(f.requests[stage].aborted, true); assert.equal(f.requests.length, stage + 1);
  assert(!progress.includes(100)); assert.equal(f.timers.size, 0);
  assert.deepEqual(sessions, stage === 0 ? [] : ['synthetic-upload']);
});

test('already-aborted signal sends nothing; Pending list and delete use the documented endpoints with CSRF', async () => {
  const f = transportFixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.upload.uploadFile(photo(), 11, 'OCR_TASK', () => {}, { signal: controller.signal }), error => error instanceof f.api.UploadCancelledError);
  assert.equal(f.requests.length, 0); assert.equal(f.timers.size, 0);
  assert.deepEqual(plain((await f.api.listPendingFiles(11)).items.map(x => x.id)), ['p']);
  assert.deepEqual(plain(await f.api.deleteFile('p')), { file_id: 'p', status: 'DELETED' });
  assert.deepEqual(f.fetches.map(x => [x.method, x.url]), [['GET', '/api/v1/files/pending?tenant_id=11'], ['DELETE', '/api/v1/files/p']]);
  assert.equal(f.fetches[0].headers['X-CSRF-Token'], undefined); assert.equal(f.fetches[1].headers['X-CSRF-Token'], 'synthetic-csrf');
});
