import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let core = {};
try { core = require('../js/import-core.js'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

test('money parser preserves signs and exact minor units and rejects malformed/unsafe input', () => {
  for (const [text, want] of [['−1 234,56 RUB', -123456], ['+1\u202f234.50 ₽',123450], ['(12,30)',-1230], ['0',0], ['12 345',1234500], ['not a sum',null], ['1,234,56',null], ['12.345',null], ['',null], ['90071992547409.92',null]]) assert.equal(core.parseMoney?.(text), want);
});
test('currency normalization does not invent currencies', () => {
  assert.equal(core.normalizeCurrency?.('RUR'), 'RUB');
  assert.equal(core.normalizeCurrency?.('₽'), 'RUB');
  assert.equal(core.normalizeCurrency?.('USD'), 'USD');
  assert.equal(core.normalizeCurrency?.('CAD'), 'CAD');
  assert.equal(core.normalizeCurrency?.('unknown'), null);
});
test('redaction handles spaced cards/accounts and masked card groups without discarding merchant', () => {
  for (const text of ['TEST карта 1234','TEST 1234 5678 9012 3456','TEST 1234 56** **** 1234','TEST счет 40817810000000001234']) {
    const redacted=core.redactDescription(text);
    assert.ok(redacted.startsWith('TEST'));
    assert.ok(!redacted.includes('1234'));
    assert.ok(!redacted.includes('408178'));
  }
});
test('typed categories respect valid description rules then MCC and never use a fallback', () => {
  const categories = {expense:[{name:'Продукты',subcategories:['Магазины']},{name:'Кафе',subcategories:[]}],income:[{name:'Зарплата',subcategories:[]}]};
  assert.deepEqual(core.suggestCategory?.({type:'expense',desc:'unknown'}, {expense:[],income:[]}, []), {category:'',subcategory:''});
  const row = {type:'expense',desc:'CAFE TEST',mcc:'5411'};
  assert.deepEqual(core.suggestCategory(row,categories,[]), {category:'Продукты',subcategory:''});
  assert.deepEqual(core.suggestCategory(row,categories,[{type:'expense',matchType:'description',pattern:'cafe',category:'Кафе',subcategory:''}]), {category:'Кафе',subcategory:''});
  assert.deepEqual(core.suggestCategory({...row,type:'income'},categories,[{type:'expense',matchType:'description',pattern:'cafe',category:'Кафе'}]), {category:'',subcategory:''});
  assert.deepEqual(core.suggestCategory(row,categories,[{type:'expense',matchType:'description',pattern:'cafe',category:'Deleted'}]), {category:'Продукты',subcategory:''});
});
test('duplicate signature is canonical but does not claim identity or collapse occurrences', () => {
  assert.equal(core.duplicateSignature?.({date:'2026-01-02',amountMinor:123,currency:'RUR',type:'expense',desc:' TEST  Shop '}), '["2026-01-02","expense","RUB",123,"test shop"]');
});
test('actual default Еда subcategories are proposed as validated category/subcategory pairs', () => {
  const categories={expense:[{name:'Еда',subcategories:['Продукты','Рестораны','Доставка']}],income:[]};
  for(const [row,want]of [[{mcc:'5411',desc:'TEST'},'Продукты'],[{mcc:'5812',desc:'TEST'},'Рестораны'],[{desc:'Доставка еды TEST'},'Доставка'],[{desc:'ВкусВилл TEST'},'Продукты']])
    assert.deepEqual(core.suggestCategory({...row,type:'expense'},categories,[]),{category:'Еда',subcategory:want});
  assert.deepEqual(core.suggestCategory({type:'expense',mcc:'5411',desc:'TEST'},{expense:[{name:'Еда',subcategories:['Рестораны']}],income:[]},[]),{category:'',subcategory:''});
});
test('CSV handles quoted delimiters/newlines and uses account rather than operation amount', () => {
  const result = core.parseDelimited?.('Дата операции;Дата платежа;Номер карты;Статус;Сумма операции;Валюта операции;Сумма платежа;Валюта платежа;Кешбэк;Категория;MCC;Описание\r\n02.01.2026 10:00;03.01.2026;1234;OK;-2,00;USD;-180,50;RUR;;;5411;"TEST;\nSHOP ""ONE"""\r\n02.01.2026;03.01.2026;1234;Отменена;-3;USD;-270;RUB;;;;Ignored', 'tbank');
  assert.equal(result?.rows.length,1);
  assert.equal(result.rows[0].amountMinor,18050);
  assert.equal(result.rows[0].operationAmountMinor,-200);
  assert.equal(result.rows[0].desc,'TEST; SHOP "ONE"');
  assert.equal(result.rows[0].date,'2026-01-02');
  assert.equal(result.rows[0].postedDate,'2026-01-03');
  assert.equal(result.rows[0].currency,'RUB');
  assert.equal(result.rows[0].type,'expense');
  assert.equal(result.rows[0].mcc,'5411');
});
test('CSV unknown headers, broken quotes and impossible dates fail explicitly', () => {
  assert.throws(() => core.parseDelimited('hello;world\n1;2'), /формат/i);
  assert.throws(() => core.parseDelimited('"unfinished'), /кавыч/i);
  const result = core.parseDelimited('Дата операции;Описание;Сумма;Валюта\n31.02.2026;TEST;-2;RUB', 'alfa');
  assert.equal(result.rows.length,0);
  assert.equal(result.warnings.length,1);
});
