import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../javascripts/discourse/initializers/multi-platform-emoji.js', import.meta.url), 'utf8');
const yaml = await readFile(new URL('../settings.yml', import.meta.url), 'utf8');
const ORIGIN = 'https://emoji.example.org';

function harness(themeSettings, siteSettings = {}) {
  const writes = [], observers = [], hooks = [], scheduled = [], polls = [];
  const listeners = {};
  class Element {
    constructor(tag, className = '') {
      this.tagName = tag.toUpperCase(); this.nodeType = 1;
      this.className = className; this.children = []; this.dataset = {}; this.listeners = {};
      this.classList = {
        contains: (name) => this.className.split(/\s+/).includes(name),
        add: (name) => { this.className += ` ${name}`; },
        remove: (name) => { this.className = this.className.split(/\s+/).filter((s) => s !== name).join(' '); },
      };
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    insertBefore(child, ref) { child.parentNode = this; this.children.splice(this.children.indexOf(ref), 0, child); }
    get firstElementChild() { return this.children[0]; }
    matches() { return this.classList.contains('emoji-picker'); }
    querySelectorAll(selector) {
      const all = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
      if (selector === '*') return all;
      if (selector === 'img') return all.filter((child) => child.tagName === 'IMG');
      if (selector === '.platform-tab') return all.filter((child) => child.classList.contains('platform-tab'));
      return all.filter((child) => child.matches());
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
  }
  const body = new Element('body');
  const document = {
    body, createElement: (tag) => new Element(tag),
    addEventListener: (name, fn) => { listeners[name] = fn; },
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
  };
  const context = {
    URL, settings: themeSettings, document,
    later: (fn) => scheduled.push(fn),
    setInterval: (fn) => { const entry = { fn }; polls.push(entry); return entry; },
    clearInterval: (entry) => { entry.cleared = true; },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} },
    apiInitializer: (_version, fn) => fn({ container: { lookup: () => siteSettings }, modifyClass: (_name, hook) => hooks.push(hook) }),
  };
  vm.runInNewContext(source.replace(/^import .*;\n/gm, '').replace('export default ', ''), context);
  function image(url, className = 'emoji') {
    const img = new Element('img', className); let current = url;
    Object.defineProperty(img, 'src', { get: () => current, set: (value) => { current = value; writes.push(value); } });
    return img;
  }
  function picker(images) { const el = new Element('div', 'emoji-picker'); images.forEach((img) => el.appendChild(img)); body.appendChild(el); return el; }
  function mutate(node) { observers.forEach((o) => o.fn([{ type: 'childList', addedNodes: [node] }])); }
  function flush() { while (scheduled.length) scheduled.shift()(); }
  return { writes, observers, hooks, scheduled, polls, listeners, image, picker, mutate, flush };
}
const configured = { multi_platform_emoji_enabled: true, emoji_asset_origin: ORIGIN, emoji_platforms_enabled: 'apple|twemoji' };

test('public defaults have a blank origin and runtime has no maintainer fallback', () => {
  assert.match(yaml, /emoji_asset_origin:\n  type: string\n  default: ""/);
  assert.doesNotMatch(source, /emoji\.rdfzer\.com|R2_BASE/);
});

test('missing, blank, malformed, insecure and credential-bearing settings install no request paths', () => {
  for (const value of [undefined, null, false, 0, {}, '', '   ', '//emoji.example.org', 'https:emoji.example.org',
    'https:///emoji.example.org', 'https://emoji.exa\tmple.org', 'https://emoji.example.org\\path',
    'http://emoji.example.org', 'javascript:alert(1)', 'https://user:secret@emoji.example.org',
    'https://emoji.example.org/assets', 'https://emoji.example.org/?secret=placeholder', 'https://emoji.example.org/#x']) {
    const h = harness({ ...configured, emoji_asset_origin: value }, configured);
    const img = h.image('https://forum.example/images/emoji/apple/grinning.png');
    const picker = h.picker([img]); h.mutate(picker); h.flush();
    h.listeners.click?.({ target: { closest: () => ({}) } });
    assert.deepEqual(h.writes, [], String(value));
    assert.equal(h.observers.length, 0); assert.equal(h.hooks.length, 0);
    assert.equal(h.polls.length, 0); assert.equal(h.scheduled.length, 0);
    assert.equal(img.src, 'https://forum.example/images/emoji/apple/grinning.png');
  }
});

test('explicit disabling and theme blanks override legacy site configuration', () => {
  const off = harness({ ...configured, multi_platform_emoji_enabled: false });
  assert.equal(off.observers.length, 0);
  const blank = harness({ ...configured, emoji_asset_origin: '' }, configured);
  assert.equal(blank.observers.length, 0);
  const legacy = harness(undefined, configured);
  const img = legacy.image('https://forum.example/emoji/apple/grinning.png');
  legacy.mutate(img);
  assert.deepEqual(legacy.writes, [`${ORIGIN}/apple/grinning.png`]);
});

test('configured observer, picker tabs and attribute callbacks use only the chosen origin', () => {
  const h = harness(configured);
  const img = h.image('https://forum.example/emoji/apple/grinning.png');
  const picker = h.picker([img]); h.mutate(picker); h.flush();
  assert.equal(img.src, `${ORIGIN}/apple/grinning.png`);
  const tabs = picker.querySelectorAll('.platform-tab');
  assert.equal(tabs.length, 2);
  tabs[1].listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(img.src, `${ORIGIN}/twemoji/grinning.png`);
  const before = h.writes.length;
  h.observers[0].fn([{ type: 'attributes', attributeName: 'src', target: img }]);
  assert.equal(h.writes.length, before, 'rewritten sources do not loop');
  assert.ok(h.writes.every((url) => new URL(url).origin === ORIGIN));
});

test('click polling and classic picker hook preserve explicitly configured assets', () => {
  for (const mode of ['poll', 'classic']) {
    const h = harness(configured);
    const img = h.image(`${ORIGIN}/twemoji/+1.png`, '');
    const picker = h.picker([img]);
    if (mode === 'poll') {
      h.listeners.click({ target: { closest: () => ({}) } });
      h.polls[0].fn();
      assert.equal(h.polls[0].cleared, true);
    } else {
      h.hooks[0].didInsertElement.call({ element: picker }); h.flush();
    }
    assert.equal(img.src, `${ORIGIN}/apple/+1.png`);
    assert.equal(picker.querySelectorAll('.platform-tab').length, 2);
  }
});

test('ordinary posted images, lookalike origins and encoded filenames stay untouched', () => {
  const h = harness(configured);
  for (const [url, className] of [
    ['https://emoji.rdfzer.com/apple/grinning.png', ''],
    ['https://emoji.example.org.evil.example/apple/grinning.png', ''],
    ['https://images.example/photo.png?next=/emoji/', ''],
    ['https://forum.example/emoji/apple/%2fsecret.png', 'emoji'],
    ['data:image/svg+xml,example', 'emoji'],
  ]) { const img = h.image(url, className); h.mutate(img); assert.equal(img.src, url); }
  assert.deepEqual(h.writes, []);
});

test('invalid platform names cannot create an asset path', () => {
  const h = harness({ ...configured, emoji_platforms_enabled: '__proto__|constructor|../other' });
  assert.equal(h.observers.length, 0);
  assert.deepEqual(h.writes, []);
});
