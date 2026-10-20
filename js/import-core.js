/* Local bank import normalization. amountMinor is an absolute, safe integer;
 * type supplies the account direction. operationAmountMinor, when present, is
 * signed. Rule schema: {type,matchType:'description'|'mcc',pattern,category,
 * subcategory}. No rule is applied across transaction types or missing targets.
 * sourceId is an opaque deterministic fingerprint plus occurrence ordinal, not
 * proof of bank identity; duplicateSignature is only a possible-match key.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinoraImportCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const compact = value => String(value ?? '').normalize('NFKC').replace(/\s+/g,' ').trim();
  const canonical = value => compact(value).toLowerCase().replace(/ё/g,'е');
  const currencies = new Set(('AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWG').split(' '));
  function normalizeCurrency(text) {
    const value = compact(text).toUpperCase();
    if (/^(RUB|RUR|₽|РУБ\.?|РУБЛЬ|РУБЛИ|РОССИЙСКИЙ РУБЛЬ)$/.test(value)) return 'RUB';
    if (value === '$') return 'USD';
    if (value === '€') return 'EUR';
    return currencies.has(value) ? value : null;
  }
  function parseMoney(text) {
    let value = compact(text).replace(/[−–]/g,'-').replace(/\s*(?:[A-Z]{3}|руб\.?|₽|\$|€)\s*$/i, suffix=>normalizeCurrency(suffix)?'':suffix).trim();
    let negative = false;
    if (/^\(.*\)$/.test(value)) { negative = true; value = value.slice(1,-1); }
    if (/^[+-]/.test(value)) { if (negative) return null; negative = value[0] === '-'; value = value.slice(1).trim(); }
    if (!/^(?:\d+|\d{1,3}(?: \d{3})+)(?:[.,]\d{1,2})?$/.test(value)) return null;
    const [whole, fraction=''] = value.replace(/ /g,'').split(/[.,]/);
    const minor = Number(whole) * 100 + Number(fraction.padEnd(2,'0'));
    return Number.isSafeInteger(minor) ? (negative && minor ? -minor : minor) : null;
  }
  function normalizeDate(value) {
    const text = compact(value);
    let match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\b|$)/);
    let parts = match ? [+match[3],+match[2],+match[1]] : null;
    if (!parts && (match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:\b|$)/))) parts = [+match[1],+match[2],+match[3]];
    if (!parts) return null;
    const [year,month,day] = parts;
    const date = new Date(Date.UTC(year,month-1,day));
    if (year < 1900 || year > 2200 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month-1 || date.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  function redactDescription(value) {
    return compact(value)
      .replace(/\b(?:\d[ -]?){4,6}(?:[+*XхХx•●][ -]?){2,}(?:\d[ -]?){2,4}\b/g,'[реквизиты скрыты]')
      .replace(/\b\d{4,6}[+*XхХx•●-]{2,}\d{2,4}\b/g,'[реквизиты скрыты]')
      .replace(/(?:\d[ -]?){12,20}\d/g,'[реквизиты скрыты]')
      .replace(/((?:карт[аыуеы]|card|сч[её]т[ауе]?|account)\s*(?:№|номер|number|:)?\s*)\d{4,}/gi,'$1[реквизиты скрыты]')
      .replace(/\+\d{10,15}\b/g,'[телефон скрыт]');
  }
  function normalizeRow(input) {
    const date = normalizeDate(input.date);
    const postedDate = normalizeDate(input.postedDate);
    const signed = input.signedMinor;
    const currency = normalizeCurrency(input.currency);
    if (!date || !Number.isSafeInteger(signed) || !signed || !currency) return null;
    const warnings = [...(input.warnings || [])];
    const desc = redactDescription(input.desc);
    if (!desc) warnings.push('Пустое описание операции.');
    if (/перевод|перечислен|transfer|\bсбп\b/i.test(desc)) warnings.push('Возможный перевод — проверьте трактовку.');
    if (/снят|выдач[аи].*налич|наличн|\batm\b|cash withdrawal/i.test(desc)) warnings.push('Наличные — требуется проверка.');
    if (/возврат|возмещен|refund|reversal/i.test(desc)) warnings.push('Возможный возврат — требуется проверка.');
    const row = {date,postedDate:postedDate || null,desc,amount:Math.abs(signed)/100,amountMinor:Math.abs(signed),currency,type:signed<0?'expense':'income',mcc:/^\d{4}$/.test(String(input.mcc || ''))?String(input.mcc):null,sourceId:'',sourceLocation:input.sourceLocation || null,warnings,checked:warnings.length===0};
    if (Number.isSafeInteger(input.operationAmountMinor) && normalizeCurrency(input.operationCurrency)) {
      row.operationAmountMinor=input.operationAmountMinor; row.operationCurrency=normalizeCurrency(input.operationCurrency);
    }
    return row;
  }
  function duplicateSignature(row) {
    return JSON.stringify([row.date,row.type,normalizeCurrency(row.currency),row.amountMinor,canonical(redactDescription(row.desc))]);
  }
  function identifyRows(bank, rows) {
    const seen = new Map();
    for (const row of rows) {
      const signature=duplicateSignature(row), ordinal=(seen.get(signature)||0)+1;
      seen.set(signature,ordinal);
      // Non-secret fingerprint; never serialize bank account references or raw identifiers.
      let a=2166136261,b=0x9e3779b9;
      for (const char of signature) { a=Math.imul(a^char.charCodeAt(0),16777619);b=Math.imul(b^char.charCodeAt(0),2246822519); }
      row.sourceId=`${bank}:${(a>>>0).toString(16).padStart(8,'0')}${(b>>>0).toString(16).padStart(8,'0')}:${ordinal}`;
    }
    return rows;
  }
  function suggestCategory(row,categories,rules=[]) {
    const empty={category:'',subcategory:''};
    const typed=categories?.[row.type] || [];
    function target(category,subcategory='') {
      const found=typed.find(c=>c.name===category);
      if (!found || (subcategory && !(found.subcategories||[]).some(s=>(typeof s==='string'?s:s.name)===subcategory))) return null;
      return {category,subcategory};
    }
    for (const matchType of ['description','mcc']) for (const rule of rules) {
      if (rule.type!==row.type || rule.matchType!==matchType || !compact(rule.pattern)) continue;
      const matches=matchType==='mcc' ? String(row.mcc)===String(rule.pattern) : canonical(row.desc).includes(canonical(rule.pattern));
      if (matches) { const result=target(rule.category,rule.subcategory||'');if (result) return result; }
    }
    const suggestions = row.type==='expense' ? [
      [/^(5411|5422|5441|5451|5462|5499)$/, [['Еда','Продукты'],'Продукты','Продукты питания']],
      [/^(5811|5812|5813|5814)$/, [['Еда','Рестораны'],'Кафе','Рестораны','Кафе и рестораны']],
      [/^(5912)$/,['Здоровье','Медицина']],
      [/^(4111|4121|4131|4789)$/,['Транспорт']]
    ] : [];
    const proposal=value=>Array.isArray(value)?target(value[0],value[1]):target(value);
    for (const [mcc,names] of suggestions) if (mcc.test(String(row.mcc))) for (const name of names) { const result=proposal(name);if(result)return result; }
    const keywords=row.type==='expense' ? [[/доставк.*ед|delivery.*food|яндекс[ .]*ед|delivery club/i,[['Еда','Доставка']]],[/продукт|supermarket|пятероч|перекрест|вкусвилл/i,[['Еда','Продукты'],'Продукты','Продукты питания']],[/кафе|ресторан|coffee|cafe/i,[['Еда','Рестораны'],'Кафе','Кафе и рестораны']],[/аптек|pharma/i,['Здоровье','Медицина']],[/такси|taxi|метро/i,['Транспорт']]] : [[/зарплат|заработн|salary/i,['Зарплата']]];
    for (const [pattern,names] of keywords) if(pattern.test(row.desc)) for(const name of names){const result=proposal(name);if(result)return result;}
    return empty;
  }
  function splitDelimited(text) {
    const first=String(text).replace(/^\uFEFF/,'').split(/\r?\n/,1)[0];
    const delimiter=first.includes(';')?';':first.includes('\t')?'\t':',';
    const rows=[];let row=[],field='',quoted=false;
    const input=String(text).replace(/^\uFEFF/,'');
    for(let i=0;i<input.length;i++) {
      const ch=input[i];
      if(ch==='"') { if(quoted && input[i+1]==='"'){field+='"';i++;}else if(quoted || !field.trim())quoted=!quoted;else throw new Error('Неверные кавычки CSV.'); }
      else if(!quoted && ch===delimiter){row.push(field.trim());field='';}
      else if(!quoted && (ch==='\n'||ch==='\r')){if(ch==='\r'&&input[i+1]==='\n')i++;row.push(field.trim());if(row.some(Boolean))rows.push(row);row=[];field='';}
      else field+=ch;
    }
    if(quoted)throw new Error('Незакрытые кавычки CSV.');
    row.push(field.trim());if(row.some(Boolean))rows.push(row);
    return rows;
  }
  function parseDelimited(text,bank) {
    const table=splitDelimited(text);
    const headerIndex=table.findIndex(row=>row.some(c=>/дата операции/i.test(c)));
    if(headerIndex<0)throw new Error('Неизвестный формат таблицы: нет заголовка операций.');
    const header=table[headerIndex].map(canonical);
    bank=bank || (header.some(h=>h.includes('номер карты'))?'tbank':'alfa');
    const find=patterns=>header.findIndex(h=>patterns.some(p=>p.test(h)));
    const dateIndex=find([/^дата операции/]),postIndex=find([/дата платежа|дата обработки|дата проводки/]),descIndex=find([/^описание|назначение/]);
    const amountIndex=find([/сумма платежа|сумма в валюте счета|сумма в рублях/]);
    const amt=amountIndex>=0?amountIndex:find([/^сумма/]);
    const currencyIndex=find([/валюта платежа|валюта счета/]),cur=currencyIndex>=0?currencyIndex:find([/^валюта/]);
    const operationIndex=find([/^сумма операции|сумма в валюте операции/]),operationCur=find([/валюта операции/]),mccIndex=find([/^mcc$/]),statusIndex=find([/^статус/]);
    if(dateIndex<0||descIndex<0||amt<0)throw new Error('Неизвестный формат колонок таблицы.');
    const rows=[],warnings=[];
    for(let i=headerIndex+1;i<table.length;i++){
      const c=table[i],status=canonical(c[statusIndex]);
      if(bank==='tbank'&&statusIndex>=0&&!/^(?:ok|выполнен|выполнена|выполнено)$/.test(status)){
        warnings.push(`Строка ${i+1}: операция исключена — статус не подтверждает выполнение (${compact(c[statusIndex])||'не указан'}).`);
        continue;
      }
      if(/отмен|отклон|ошиб|не выполн|failed|declined/.test(status))continue;
      const row=normalizeRow({date:c[dateIndex],postedDate:c[postIndex],signedMinor:parseMoney(c[amt]),currency:c[cur]||'RUB',desc:c[descIndex],mcc:c[mccIndex],operationAmountMinor:parseMoney(c[operationIndex]),operationCurrency:c[operationCur],sourceLocation:{line:i+1}});
      if(row)rows.push(row);else warnings.push(`Строка ${i+1}: не удалось разобрать дату, сумму или валюту.`);
    }
    return {bank,rows:identifyRows(bank,rows),warnings};
  }
  return {parseMoney,normalizeCurrency,suggestCategory,duplicateSignature,parseDelimited,normalizeDate,normalizeRow,identifyRows,redactDescription};
});
