import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pdf = {};
try { pdf = require('../js/import-pdf.js'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const item = (str,x,top,height=842) => ({str,transform:[1,0,0,10,x,height-top],width:str.length*4,height:10});
function page(pageNumber,cells,width=595,{bank,headers=true}={}) {
  bank ||= Object.entries({tbank:'Т-Банк',alfa:'АЛЬФА-БАНК',vtb:'ВТБ',otp:'ОТП Банк'}).find(([,name])=>cells.some(c=>c[0]===name&&c[1]<100))?.[0];
  if(!bank&&cells.some(c=>c[0]==='Счет-выписка'))bank='otp';
  const firstDate=Math.min(...cells.filter(c=>/^\d{2}\.\d{2}\.\d{4}$/.test(c[0])).map(c=>c[2]));
  if(bank&&headers&&Number.isFinite(firstDate)){
    const existingLabels=/^(?:Дата и время|Сумма операции|Дата проводки|Дата операции|Назначение платежа|Расход|Приход|Описание(?: операции)?)$/;
    cells=cells.filter(c=>!(c[2]<firstDate&&existingLabels.test(c[0])));
    const top=pageNumber>1?(bank==='otp'?50:20):firstDate-(bank==='otp'?54:40);
    cells=[...fullHeaders[bank].map(([s,x,y])=>[s,x,y+top]),...cells];
  }
  const height=bank==='otp'?595.3:842;
  return {pageNumber,width,height,items:cells.map(([s,x,top])=>item(s,x,top,height))};
}
const fullHeaders={
  tbank:[['Дата и время операции',56,0],['Дата списания',126,0],['Сумма в валюте операции',199,0],['Сумма операции в валюте карты',294,0],['Описание операции',389,0],['Номер карты',499,0]],
  alfa:[['Дата проводки',27,0],['Код операции',96,0],['Описание',188,0],['Сумма в валюте счета',511,0]],
  vtb:[['Дата и время операции',25,0],['Дата обработки банком',86,0],['Сумма операции в валюте операции',155,0],['Сумма операции в валюте счета/карты',237,0],['Приход',280,20],['Расход',361,20],['Описание операции',408,10],['Наименование получателя/Отправителя',509,0]],
  otp:[['Номер',68,0],['Дата операции',116,0],['Операция',203,0],['Расход',368,0],['Приход',490,0],['Назначение платежа',625,0]]
};
test('transaction descriptions naming other banks never override the T-Bank issuer/table', () => {
  for(const desc of ['Перевод ВТБ','Оплата АЛЬФА-БАНК','Перевод ОТП Банк']){
    const result=pdf.parsePages([page(1,[['Т-Банк',30,40],...fullHeaders.tbank.map(([s,x,y])=>[s,x,y+60]),['02.01.2026',56,100],['03.01.2026',126,100],['-2 USD',199,100],['-180.50 RUB',294,100],[desc,389,100]],595,{headers:false})]);
    assert.equal(result.bank,'tbank');assert.equal(result.rows[0].amountMinor,18050);assert.equal(result.rows[0].currency,'RUB');
  }
});
test('swapped account/operation column headers are rejected before any budget amount is inferred', () => {
  const headers=fullHeaders.tbank.map(([s,x,y])=>[s,x===199?294:x===294?199:x,y+60]);
  assert.throws(()=>pdf.parsePages([page(1,[['Т-Банк',30,40],...headers,['02.01.2026',56,100],['03.01.2026',126,100],['-180.50 RUB',199,100],['-2 USD',294,100],['TEST',389,100]],595,{headers:false})]),/структур|формат|колон/i);
});
test('OTP supplied format continues on headerless pages after a validated first-page table', () => {
  const result=pdf.parsePages([page(1,[['ОТП Банк',57,60],['02.01.2026',116,310],['Покупка',203,310],['10.05',368,310],['FIRST',625,310]],842),page(2,[['03.01.2026',116,108],['Покупка',203,108],['20.30',368,108],['SECOND',625,108]],842,{bank:'otp',headers:false})]);
  assert.equal(result.bank,'otp');assert.equal(result.rows.length,2);assert.equal(result.rows[1].amountMinor,2030);
});
test('T-Bank positions survive shuffled extraction, repeated header and page continuation; retain account amount', () => {
  const result = pdf.parsePages?.([
    page(1,[['Т-Банк',50,100],['Дата и время',56,300],['Сумма операции',294,300],['02.01.2026',56,330],['03.01.2026',126,330],['-2.00 USD',199,330],['-180.50 RUB',294,330],['TEST',389,330]]),
    page(2,[['continued',389,40],['Описание операции',389,20],['03.01.2026',56,70],['04.01.2026',126,70],['+20.00 RUB',199,70],['+20.00 RUB',294,70],['Возврат покупки',389,70],['Банковский итог 999',200,790]].reverse(),595,{bank:'tbank'})
  ]);
  assert.equal(result?.bank,'tbank'); assert.equal(result.rows.length,2);
  assert.deepEqual([result.rows[0].date,result.rows[0].postedDate,result.rows[0].amountMinor,result.rows[0].type,result.rows[0].desc],['2026-01-02','2026-01-03',18050,'expense','TEST continued']);
  assert.equal(result.rows[0].operationAmountMinor,-200);
  assert.equal(result.rows[1].checked,false); assert.ok(result.rows[1].warnings.length);
});
test('Alfa extracts purchase date/MCC from description, redacts numbers, falls back to posting date', () => {
  const result=pdf.parsePages?.([page(1,[['АЛЬФА-БАНК',30,50],['Дата проводки',27,385],['04.01.2026',27,410],['REF1',96,410],['Оплата 02.01.2026 MCC: 5411 карта 123456++++++1234',188,410],['-123,45 RUR',510,410],['05.01.2026',27,450],['REF2',96,450],['Перевод на счет 40817810000000001234',188,450],['+500,00 RUR',510,450]])]);
  assert.equal(result?.bank,'alfa'); assert.equal(result.rows.length,2);
  assert.deepEqual([result.rows[0].date,result.rows[0].amountMinor,result.rows[0].type,result.rows[0].mcc],['2026-01-02',12345,'expense','5411']);
  assert.ok(!result.rows[0].desc.includes('1234'));
  assert.equal(result.rows[1].date,'2026-01-05');assert.equal(result.rows[1].checked,false);assert.ok(result.rows[1].warnings.length);
  assert.ok(!result.rows[1].desc.includes('408178'));
});
test('VTB separate credit/debit columns override operation currency and preserve multiline descriptions', () => {
  const result=pdf.parsePages?.([page(1,[['ВТБ',30,50],['Операции по счёту',27,292],['02.01.2026',32,355],['03.01.2026',97,355],['-2.00 USD',175,355],['0.00 RUB',262,355],['-181.25 RUB',340,355],['TEST',406,355],['SHOP',410,367],['03.01.2026',32,400],['04.01.2026',97,400],['50.50 RUB',175,400],['50.50 RUB',262,400],['0.00 RUB',350,400],['Доход',410,400]])]);
  assert.equal(result?.bank,'vtb');assert.equal(result.rows.length,2);
  assert.deepEqual([result.rows[0].date,result.rows[0].amountMinor,result.rows[0].type,result.rows[0].desc],['2026-01-02',18125,'expense','TEST SHOP']);
  assert.equal(result.rows[1].amountMinor,5050); assert.equal(result.rows[1].type,'income');
});
test('OTP separate columns, purpose continuation, duplicate header and malformed row warnings', () => {
  const result=pdf.parsePages?.([page(1,[['ОТП Банк',57,60],['Валюта RUB',60,160],['Дата операции',116,256],['02.01.2026',116,310],['Покупка',203,310],['10.05',368,310],['TEST',625,310]],842),page(2,[['Назначение платежа',625,50],['SHOP',625,80],['03.01.2026',116,108],['Зачисление',203,108],['20.30',490,108],['TEST INCOME',625,108],['04.01.2026',116,200],['Покупка',203,200],['bad amount',368,200]],842,{bank:'otp'})]);
  assert.equal(result?.bank,'otp'); assert.equal(result.rows.length,2);
  assert.deepEqual([result.rows[0].date,result.rows[0].amountMinor,result.rows[0].type,result.rows[0].desc],['2026-01-02',1005,'expense','Покупка TEST SHOP']);
  assert.equal(result.rows[1].amountMinor,2030);assert.equal(result.rows[1].type,'income');assert.ok(result.warnings.length);
});
test('identical purchases keep distinct opaque source ids and multiplicity', () => {
  const result=pdf.parsePages?.([page(1,[['Т-Банк',30,50],... [100,140].flatMap(y=>[['02.01.2026',56,y],['03.01.2026',126,y],['-10 RUB',199,y],['-10 RUB',294,y],['TEST',389,y]])])]);
  assert.equal(result?.rows.length,2); assert.notEqual(result.rows[0].sourceId,result.rows[1].sourceId);
  assert.ok(!result.rows[0].sourceId.includes('TEST'));
});
test('unknown, scanned, and unsupported bank layout fail with explicit errors', () => {
  assert.throws(()=>pdf.parsePages([]),/скан|текст/i);
  assert.throws(()=>pdf.parsePages([page(1,[['Another bank',30,50]])]),/формат/i);
  assert.throws(()=>pdf.parsePages([page(1,[['ВТБ',30,50]])]),/операци|структур/i);
});
test('read rejects oversized and non-PDF input before loading library', async () => {
  await assert.rejects(()=>pdf.read({size:51*1024*1024,arrayBuffer(){throw Error('should not read');}}),/размер/i);
  await assert.rejects(()=>pdf.read(new Blob(['not pdf'])),/PDF/i);
});
test('VTB continuation and repeated headings stay with their own transaction across pages', () => {
  const result=pdf.parsePages([page(1,[['ВТБ',30,50],['02.01.2026',32,700],['03.01.2026',97,700],['-2 USD',175,700],['0 RUB',262,700],['-180 RUB',340,700],['TEST',406,700]]),page(2,[['Описание операции',406,20],['SHOP',406,50],['03.01.2026',32,76],['04.01.2026',97,76],['+5 EUR',175,76],['+5 EUR',262,76],['0 EUR',340,76],['INCOME',406,76]],595,{bank:'vtb'})]);
  assert.equal(result.rows.length,2);assert.equal(result.rows[0].desc,'TEST SHOP');assert.equal(result.rows[0].amountMinor,18000);assert.equal(result.rows[1].currency,'EUR');assert.equal(result.rows[1].amountMinor,500);
});
test('Alfa keeps page continuation and warns on unparseable account sums rather than dropping silently', () => {
  const result=pdf.parsePages([page(1,[['АЛЬФА-БАНК',30,50],['02.01.2026',27,680],['Покупка 01.01.2026 TEST',188,680],['-12.50 USD',510,680]]),page(2,[['Описание',188,20],['SHOP',188,40],['03.01.2026',27,130],['Покупка 02.01.2026',188,130],['bad',510,130],['04.01.2026',27,160],['INCOME',188,160],['+20.10 EUR',510,160]],595,{bank:'alfa'})]);
  assert.equal(result.rows.length,2);assert.equal(result.rows[0].desc,'Покупка 01.01.2026 TEST SHOP');assert.equal(result.rows[0].currency,'USD');assert.equal(result.rows[0].amountMinor,1250);assert.equal(result.rows[1].type,'income');assert.equal(result.warnings.length,1);
});
test('OTP image-only bank logo is identified by the exact text and column template', () => {
  const result=pdf.parsePages([page(1,[['Счет-выписка',369,104],['Счет: (руб.)',57,209],['Дата операции',116,256],['Расход',368,256],['Приход',490,256],['Назначение платежа',625,256],['02.01.2026',116,310],['Покупка',203,310],['10.05',368,310],['TEST',625,310]],842)]);
  assert.equal(result.bank,'otp');assert.equal(result.rows[0].amountMinor,1005);
});
test('OTP numeric final summary and signatures are excluded from the final transaction', () => {
  const result=pdf.parsePages([page(1,[['ОТП Банк',57,60],['Дата операции',116,256],['02.01.2026',116,310],['Покупка',203,310],['10.05',368,310],['TEST',625,310],['0.00',203,370],['10.05',368,370],['20.00',490,370],['Подпись',625,400]],842)]);
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].amountMinor,1005);assert.equal(result.rows[0].desc,'Покупка TEST');assert.equal(result.warnings.length,0);
});
test('Alfa purchase date with two-digit year uses posting century; pending totals generate explicit warning', () => {
  const result=pdf.parsePages([page(1,[['АЛЬФА-БАНК',30,50],['Неподтвержденные операции',312,258],['500,00 RUR',510,258],['04.01.2026',27,410],['Оплата на сумму: 2.00 USD, дата совершения операции: 02.01.26, MCC: 5411',188,410],['-180,50 RUR',510,410]])]);
  assert.equal(result.rows[0].date,'2026-01-02');assert.equal(result.rows[0].postedDate,'2026-01-04');assert.equal(result.rows[0].operationAmountMinor,-200);assert.equal(result.rows[0].operationCurrency,'USD');assert.equal(result.rows[0].checked,true);assert.equal(result.warnings.length,1);assert.match(result.warnings[0],/500[.,]00.*RUB/);
});
test('VTB ruled row boundaries assign vertically centered multiline descriptions to the correct row', () => {
  const p=page(1,[['ВТБ',30,50],['02.01.2026',32,100],['03.01.2026',97,100],['-10 RUB',340,100],['0 RUB',262,100],['FIRST',406,100],['03.01.2026',32,200],['04.01.2026',97,200],['-20 RUB',340,200],['0 RUB',262,200],['SECOND TOP',391,145],['SECOND BOTTOM',406,225]]);
  p.horizontalLines=[80,130,270].map(top=>({x1:390,y1:842-top,x2:500,y2:842-top}));
  const result=pdf.parsePages([p]);
  assert.equal(result.rows[0].desc,'FIRST');assert.equal(result.rows[1].desc,'SECOND TOP SECOND BOTTOM');
});
test('Alfa retains meaningful description lines starting with Sum and the final body baseline', () => {
  const result=pdf.parsePages([page(1,[['АЛЬФА-БАНК',30,50],['02.01.2026',27,680],['TEST',188,680],['Сумма комиссии: 0.00',188,706],['-10 RUB',510,680]])]);
  assert.equal(result.rows[0].desc,'TEST Сумма комиссии: 0.00');
});
test('PDF retains valid ISO currency codes beyond app display preferences', () => {
  const result=pdf.parsePages([page(1,[['Т-Банк',30,50],['02.01.2026',56,100],['03.01.2026',126,100],['-10.25 CAD',199,100],['-10.25 CAD',294,100],['TEST',389,100]])]);
  assert.equal(result.rows[0].currency,'CAD');assert.equal(result.rows[0].operationCurrency,'CAD');
});
// Hand-built public PDF with complete Cyrillic headers through a ToUnicode map.
// No external generator, private text, system fonts or real statement is needed.
function syntheticPdf({pageCount=1,encrypted=false}={}) {
  const texts=[['T-Bank',30,40],...fullHeaders.tbank.map(([s,x,y])=>[s,x,y+60]),['02.01.2026',56,100],['03.01.2026',126,100],['-10.25 RUB',199,100],['-10.25 RUB',294,100],['TEST SHOP',389,100]];
  const nonAscii=[...new Set(texts.flatMap(([s])=>[...s]).filter(c=>c.charCodeAt(0)>127))];
  const codes=new Map(nonAscii.map((c,n)=>[c,n+128]));
  const encode=s=>[...s].map(c=>codes.has(c)?'\\'+codes.get(c).toString(8).padStart(3,'0'):/[()\\]/.test(c)?'\\'+c:c).join('');
  const content='BT /F1 6 Tf '+texts.map(([s,x,top])=>`1 0 0 1 ${x} ${842-top} Tm (${encode(s)}) Tj`).join(' ')+' ET';
  const cmap='/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Synthetic def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange '+nonAscii.length+' beginbfchar '+nonAscii.map(c=>`<${codes.get(c).toString(16)}> <${c.charCodeAt(0).toString(16).padStart(4,'0')}>`).join(' ')+' endbfchar endcmap CMapName currentdict /CMap defineresource pop end end';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${'3 0 R '.repeat(pageCount)}] /Count ${pageCount} >>`,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 6 0 R >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`];
  if(encrypted)objects.push('<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <'+'00'.repeat(32)+'> /U <'+'00'.repeat(32)+'> >>');
  let output='%PDF-1.4\n',offsets=[0];
  objects.forEach((obj,i)=>{offsets.push(output.length);output+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
  const xref=output.length;output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R ${encrypted?'/Encrypt 7 0 R /ID [<00000000000000000000000000000000> <00000000000000000000000000000000>]':''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([output],{type:'application/pdf'});
}
test('read uses real local PDF.js, reports progress, releases resources and supports a second document', async () => {
  const progress=[];
  for(let n=0;n<2;n++){
    const result=await pdf.read(syntheticPdf(),{onProgress:p=>progress.push(p)});
    assert.equal(result.bank,'tbank');assert.equal(result.rows.length,1);assert.equal(result.rows[0].amountMinor,1025);assert.equal(result.rows[0].desc,'TEST SHOP');
  }
  assert.deepEqual(progress,[{page:1,totalPages:1,progress:1},{page:1,totalPages:1,progress:1}]);
});
test('read rejects encrypted, malformed and excessive-page PDFs and cleans up after callback failure', async () => {
  await assert.rejects(()=>pdf.read(syntheticPdf({encrypted:true})),/парол/i);
  await assert.rejects(()=>pdf.read(new Blob(['%PDF-1.4 broken'])),/поврежд/i);
  await assert.rejects(()=>pdf.read(syntheticPdf({pageCount:201})),/страниц/i);
  await assert.rejects(()=>pdf.read(syntheticPdf(),{onProgress(){throw new Error('callback stopped');}}),/callback stopped/);
  assert.equal((await pdf.read(syntheticPdf())).rows.length,1);
});
