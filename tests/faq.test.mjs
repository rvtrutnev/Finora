import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const content = require('../js/faq-content.js');
const ui = require('../js/faq-ui.js');

function fixture() {
  const nodes = [];
  const document = {activeElement: null, createElement(tag) {
    const listeners = {};
    const node = {tagName: tag, children: [], style: {}, open: false, isConnected: true,
      textContent: '', value: '', scrollTop: 100,
      setAttribute(key,value) { this[key] = value; },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      addEventListener(name,fn) { (listeners[name] ||= []).push(fn); },
      emit(name,event={}) { for (const fn of listeners[name] || []) fn({target:this,...event}); },
      focus() { document.activeElement = this; },
      showModal() { this.open = true; },
      close() { this.open = false; this.emit('close'); },
      getBoundingClientRect() { return {left:100,right:600,top:0,bottom:800}; }
    };
    nodes.push(node);return node;
  }};
  document.body = document.createElement('body');document.body.style.overflow = 'auto';
  const opener = document.createElement('button');opener.focus();
  function find(node,id) { return node.id === id ? node : node.children.map(child=>find(child,id)).find(Boolean); }
  return {document,opener,nodes,byId:id=>find(document.body,id)};
}

test('every application route resolves to a usable instruction; unknown routes fall back',()=>{
  for (const id of ['home','wallets','debts','budget','calc','import','settings','general']) {
    const section = content.getSection(id);
    assert.equal(section.id,id);assert.ok(section.title);assert.ok(section.purpose);
    assert.ok(section.steps.length);assert.ok(section.example);assert.ok(section.notes.length);
  }
  assert.equal(content.getSection('missing').id,'general');
});
test('FAQ renders current section, changes only its article and restores scroll/focus',()=>{
  const f=fixture(), controller=ui.create({document:f.document,content});
  const draft=f.document.createElement('input');draft.value='unsaved';
  controller.open('import');
  assert.equal(f.byId('faq-dialog').open,true);
  assert.equal(f.byId('faq-section-title').textContent,'Импорт');
  assert.equal(f.document.body.style.overflow,'hidden');
  const select=f.byId('faq-section');select.value='calc';select.emit('change');
  assert.equal(f.byId('faq-section-title').textContent,'Калькулятор');
  assert.equal(f.byId('faq-article').scrollTop,0);
  controller.close();
  assert.equal(draft.value,'unsaved');assert.equal(f.document.body.style.overflow,'auto');
  assert.equal(f.document.activeElement,f.opener);
  controller.open('missing');assert.equal(f.byId('faq-section').value,'general');controller.close();
  assert.equal(f.nodes.filter(n=>n.tagName==='dialog').length,1);
});
test('Escape, close button and outside click close; interior blank space does not',()=>{
  const f=fixture(),c=ui.create({document:f.document,content});c.open('home');
  const dialog=f.byId('faq-dialog');
  dialog.emit('click',{clientX:150,clientY:200});assert.equal(dialog.open,true);
  dialog.emit('click',{clientX:20,clientY:200});assert.equal(dialog.open,false);
  c.open('home');dialog.emit('cancel',{preventDefault(){}});assert.equal(dialog.open,false);
  c.open('home');f.byId('faq-close').emit('click');assert.equal(dialog.open,false);
});
test('reopening an already open panel does not replace return focus or scroll state',()=>{
  const f=fixture(),c=ui.create({document:f.document,content});c.open('home');c.open('budget');c.close();
  assert.equal(f.document.activeElement,f.opener);assert.equal(f.document.body.style.overflow,'auto');
});
