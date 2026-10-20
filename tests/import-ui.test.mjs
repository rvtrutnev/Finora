import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ui=require('../js/import-ui.js');
const csv='Дата операции;Описание операции;Сумма в валюте счета;Валюта счета\n20.10.2026;Shop;-10;RUB\n20.10.2026;Shop;-10;RUB';
const file=(text=csv)=>({name:'test.csv',arrayBuffer:async()=>new TextEncoder().encode(text).buffer});
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('category and rule drafts survive validation/network errors and unrelated renders, then clear',async()=>{
 const {c}=setup();await c.loadFile(file());
 await c.createCategory(0,'New','Child');
 assert.deepEqual(c.state.categoryDraft,{category:'New',subcategory:'Child'});
 c.updateRow(1,{checked:false});assert.equal(c.state.categoryDraft.subcategory,'Child');
 await c.createRule(0,'mcc','123');
 assert.deepEqual(c.state.ruleDraft,{matchType:'mcc',pattern:'123'});
 c.updateRow(0,{category:'Food'});await c.createRule(0,'description','Shop');
 assert.equal(c.state.ruleDraft,null);
 c.reset();assert.equal(c.state.categoryDraft,null);assert.equal(c.state.ruleDraft,null);
});
test('real controller form events retain input through errors and clear on cancel/new file',async()=>{
 const events={};const root={innerHTML:'',addEventListener:(name,handler)=>(events[name]||=[]).push(handler),querySelector:()=>null};
 const dispatch=(name,target)=>{for(const handler of events[name]||[])handler({target,preventDefault(){}});};
 const button=key=>({dataset:{[key]:'0'},hasAttribute:name=>name===`data-${key}`,closest(){return this;}});
 const {c}=setup({root,saveRule:async()=>{throw Error('offline');}});await c.loadFile(file());
 dispatch('click',button('category'));
 const categoryForm={hasAttribute:name=>name==='data-category-form',elements:{category:{value:'New & name'},subcategory:{value:'Child'}}};
 dispatch('input',{closest:()=>categoryForm});
 await c.createCategory(0,'New & name','Child');
 assert.match(root.innerHTML,/value="New &amp; name"/);assert.match(root.innerHTML,/value="Child"/);
 dispatch('click',button('cancel'));assert.equal(c.state.categoryDraft,null);
 c.updateRow(0,{category:'Food'});dispatch('click',button('rule'));
 const ruleForm={hasAttribute:name=>name==='data-rule-form',elements:{matchType:{value:'mcc'},pattern:{value:'5411'}}};
 dispatch('change',{closest:()=>ruleForm,hasAttribute:()=>false,dataset:{}});
 await c.createRule(0,'mcc','5411');
 assert.match(root.innerHTML,/value="mcc" selected/);assert.match(root.innerHTML,/value="5411"/);
 await c.loadFile(file());assert.equal(c.state.ruleDraft,null);assert.equal(c.state.categoryDraft,null);
});
function setup(extra={}) {
 let context={userId:'a',generation:1};const writes=[];
 const c=ui.create({getContext:()=>context,getCategories:()=>({expense:[{name:'Food',subcategories:['Shop']}],income:[]}),getBudgetItems:()=>[],loadRules:async()=>[],saveCategory:async()=>{throw Error('offline');},saveRule:async()=>{},saveOperation:async(payload)=>{writes.push(payload);return {status:'created',operation:{id:payload.importKey}};},...extra});
 return {c,writes,switch:()=>{context={userId:'b',generation:2};c.reset();}};
}
test('unassigned selection cannot write; failure remains retryable',async()=>{
 let fail=true;const {c}=setup({saveOperation:async()=>{if(fail)throw Error('offline');return {status:'created',operation:{id:'1'}};}});
 await c.loadFile(file());await c.save();assert.match(c.state.status,/категор/);assert.equal(c.state.rows[0].saved,false);
 c.updateRow(0,{category:'Food'});c.updateRow(1,{checked:false});await c.save();assert.equal(c.state.rows[0].saved,false);assert.equal(c.state.rows[0].checked,true);
 fail=false;await c.save();assert.equal(c.state.rows[0].saved,true);
});
test('account switch during read invalidates preview',async()=>{
 const d=defer(),s=setup();const p=s.c.loadFile({name:'test.csv',arrayBuffer:()=>d.promise});s.switch();d.resolve(new TextEncoder().encode(csv).buffer);await p;assert.equal(s.c.state.rows.length,0);
});
test('account switch during save cannot apply old completion',async()=>{
 const d=defer();let applied=0;const s=setup({saveOperation:()=>d.promise,onSaved:()=>applied++});await s.c.loadFile(file());s.c.updateRow(0,{category:'Food'});s.c.updateRow(1,{checked:false});const p=s.c.save();s.switch();d.resolve({status:'created',operation:{id:'old'}});await p;assert.equal(applied,0);assert.equal(s.c.state.rows.length,0);
});
test('same-file retry keeps keys and identical purchases retain separate keys',async()=>{
 const {c}=setup();await c.loadFile(file());const keys=c.state.rows.map(r=>r.importKey);assert.notEqual(keys[0],keys[1]);await c.loadFile(file());assert.deepEqual(c.state.rows.map(r=>r.importKey),keys);assert.match(keys[0],/^[a-f0-9]{64}:/);
});
test('category persistence failure never changes assignment',async()=>{
 const {c}=setup();await c.loadFile(file());await c.createCategory(0,'New','Child');assert.equal(c.state.rows[0].category,'');assert.match(c.state.status,/offline/);
});
test('deleted target makes a saved rule inapplicable',async()=>{
 const {c}=setup({loadRules:async()=>[{type:'expense',matchType:'description',pattern:'Shop',category:'Deleted'}]});await c.loadFile(file());assert.equal(c.state.rows[0].category,'');
});
test('ambiguous match requires explicit confirmation',async()=>{
 const {c,writes}=setup({getBudgetItems:()=>[{date:'2026-10-20',type:'expense',currency:'RUB',amount:10,note:'Shop'}]});await c.loadFile(file());c.updateRow(0,{category:'Food'});c.updateRow(1,{checked:false});await c.save();assert.equal(writes.length,0);c.updateRow(0,{confirmed:true});await c.save();assert.equal(writes.length,1);assert.equal(writes[0].confirmAmbiguous,true);
});
test('double save guarded; partial success retries only failed rows',async()=>{
 const d=defer();let count=0;const {c}=setup({saveOperation:async()=>{count++;if(count===1){await d.promise;return {status:'created',operation:{id:'1'}};}if(count===2)throw Error('network');return {status:'created',operation:{id:'2'}};}});await c.loadFile(file());c.updateRow(0,{category:'Food'});c.updateRow(1,{category:'Food'});const p=c.save();await c.save();d.resolve();await p;assert.equal(count,2);await c.save();assert.equal(count,3);
});
test('loaded owner keys mark only exact same-file rows already imported',async()=>{
 const first=setup();await first.c.loadFile(file());const key=first.c.state.rows[0].importKey;
 const {c}=setup({loadImportKeys:async()=>[key],getBudgetItems:()=>[{date:'2026-10-20',type:'expense',currency:'RUB',amount:10,note:'Shop'}]});await c.loadFile(file());assert.equal(c.state.rows[0].saved,true);assert.equal(c.state.rows[0].checked,false);assert.equal(c.state.rows[1].saved,false);assert.equal(c.state.rows[1].ambiguous,true);
});
test('category and rule completions are ignored after account switch',async()=>{
 const d=defer(),s=setup({saveCategory:()=>d.promise});await s.c.loadFile(file());const p=s.c.createCategory(0,'New');s.switch();d.resolve();await p;assert.equal(s.c.state.rows.length,0);assert.equal(s.c.state.status,'');
 const r=defer(),other=setup({saveRule:()=>r.promise});await other.c.loadFile(file());other.c.updateRow(0,{category:'Food'});const q=other.c.createRule(0,'description','Shop');other.switch();r.resolve();await q;assert.equal(other.c.state.ruleStatus,'');
});
test('stale rules cannot contaminate a newer file or its manual bank retry',async()=>{
 const d=defer(),entered=defer();let calls=0;const s=setup({loadRules:()=>{if(++calls===1){entered.resolve();return d.promise;}return Promise.resolve([]);}});
 const old=s.c.loadFile(file());await entered.promise;s.switch();await s.c.loadFile(file());d.resolve([{type:'expense',matchType:'description',pattern:'Shop',category:'Food'}]);await old;s.c.withBank('alfa');assert.equal(s.c.state.rows[0].category,'');
});
test('rule failure stays separate from successful operation results',async()=>{
 const {c,writes}=setup({saveRule:async()=>{throw Error('rules offline');}});await c.loadFile(file());c.updateRow(0,{category:'Food'});c.updateRow(1,{checked:false});await c.createRule(0,'description','Shop');await c.save();assert.equal(writes.length,1);assert.match(c.state.ruleStatus,/rules offline/);assert.match(c.state.status,/Сохранено: 1/);
});
test('CSV accepts both UTF8 and windows1251; XLS manual retry uses extracted CSV',async()=>{
 const bytes=Buffer.from('c4e0f2e020eee fe5f0e0f6e8e83bcee fe8f1e0ede8e520eee fe5f0e0f6e8e83bd1f3ecece020e220e2e0ebfef2e520f1f7e5f2e03bc2e0ebfef2e020f1f7e5f2e00a32302e31302e323032363b53686f703b2d31303b525542'.replace(/ /g,''),'hex');
 const s=setup();await s.c.loadFile({name:'test.csv',arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});assert.equal(s.c.state.rows.length,1);
 const previous=globalThis.XLSX;let reads=0;globalThis.XLSX={read:()=>{reads++;return {SheetNames:['first'],Sheets:{first:{}}};},utils:{sheet_to_csv:()=>csv}};
 try{await s.c.loadFile({name:'test.xlsx',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer});s.c.withBank('alfa');assert.equal(reads,1);assert.equal(s.c.state.rows.length,2);}finally{globalThis.XLSX=previous;}
});
