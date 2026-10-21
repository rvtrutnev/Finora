import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), core=require('../js/capital-core.js'),ui=require('../js/capital-ui.js');
const plan={version:1,mode:'goal',monthlyIncome:100000,payoutCapital:'',initialCapital:0,years:10,months:0,inflationPercent:5,accumulationPercent:8,payoutPercent:10,preservePurchasingPower:true};
function setup(savePlan=async()=>true){let ctx={userId:'a',generation:1};const c=ui.create({core,getContext:()=>ctx,savePlan,onChange(){}});c.load(plan);return {c,switch(){ctx={userId:'b',generation:2};c.reset();}};}
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
test('failed save preserves draft, retry writes only versioned normalized plan',async()=>{
  let fail=true,payload;const {c}=setup(async p=>{payload=p;if(fail)throw Error('offline');return true;});
  c.edit('monthlyIncome','125000');await c.save();assert.equal(c.state.values.monthlyIncome,'125000');assert.equal(c.state.dirty,true);assert.match(c.state.message,/сохранить/);
  fail=false;await c.save();assert.equal(c.state.dirty,false);assert.equal(payload.version,1);assert.equal(payload.monthlyIncome,125000);assert.equal(payload.result,undefined);
});
test('changes while saving stay unsaved, metadata echoes cannot erase the new draft',async()=>{
  const d=deferred(),{c}=setup(()=>d.promise);c.edit('monthlyIncome','110000');const task=c.save();c.edit('monthlyIncome','200000');c.load(plan);d.resolve(true);await task;
  assert.equal(c.state.values.monthlyIncome,'200000');assert.equal(c.state.dirty,true);assert.equal(c.state.busy,false);
});
test('account switch discards old success and old failure without mutating the new scenario',async()=>{
  for(const fail of [false,true]){const d=deferred(),s=setup(()=>d.promise);s.c.edit('years','12');const task=s.c.save();s.switch();s.c.edit('monthlyIncome','777');fail?d.reject(Error('offline')):d.resolve(true);await task;assert.equal(s.c.state.values.monthlyIncome,'777');assert.equal(s.c.state.busy,false);assert.equal(s.c.state.message,'Изменения не сохранены.');}
});
test('duplicate submits, invalid input, unavailable account and unreachable projection never write',async()=>{
  let writes=0;const d=deferred(),{c}=setup(()=>{writes++;return d.promise;});c.edit('years','11');const task=c.save();await c.save();assert.equal(writes,1);d.resolve(true);await task;
  c.edit('monthlyIncome','');await c.save();assert.equal(writes,1);
  c.edit('monthlyIncome','100000');c.edit('payoutPercent','0');await c.save();assert.equal(writes,1);
  const guest=ui.create({core,getContext:()=>({}),savePlan:async()=>{writes++;},onChange(){}});guest.load(plan);await guest.save();assert.equal(writes,1);
});
test('invalid stored scenario resets safely and a clean scenario can be loaded',()=>{
  const {c}=setup();c.load({...plan,version:99});assert.equal(c.state.values.monthlyIncome,'');assert.match(c.state.message,/прочитать/);c.load(plan);assert.equal(c.state.values.monthlyIncome,100000);
});
