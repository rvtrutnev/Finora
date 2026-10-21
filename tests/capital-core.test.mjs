import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const core=createRequire(import.meta.url)('../js/capital-core.js');
const base={mode:'goal',monthlyIncome:100000,payoutCapital:12000000,initialCapital:0,years:0,months:0,inflationPercent:0,accumulationPercent:0,payoutPercent:10,preservePurchasingPower:true};
test('goal and reverse income use annual payout budget, preserving purchasing power when selected',()=>{
  assert.equal(core.calculate(base).result.capital,12000000);
  assert.equal(core.calculate({...base,inflationPercent:5}).result.capital,24000000);
  assert.equal(core.calculate({...base,inflationPercent:5,preservePurchasingPower:false}).result.capital,12000000);
  assert.equal(core.calculate({...base,mode:'income'}).result.monthlyIncome,100000);
  assert.equal(core.calculate({...base,mode:'income',payoutCapital:0}).result.monthlyIncome,0);
});
test('inflation increases target once and reverse income is also expressed in today money',()=>{
  const r=core.calculate({...base,years:2,inflationPercent:10,payoutPercent:20}).result;
  assert.ok(Math.abs(r.monthlyIncome-121000)<1e-6);
  assert.ok(Math.abs(r.capital-14520000)<1e-6);
  const reverse=core.calculate({...base,mode:'income',years:2,inflationPercent:10,payoutPercent:20,payoutCapital:r.capital}).result;
  assert.ok(Math.abs(reverse.incomeToday-100000)<1e-6);
});
test('monthly contributions reconcile by independent monthly simulation, including negative growth',()=>{
  for(const annual of [0,0.000000001,8,-10]) {
    const r=core.calculate({...base,years:10,initialCapital:1000000,accumulationPercent:annual}).result;
    let balance=1000000; const monthly=Math.pow(1+annual/100,1/12)-1;
    for(let m=0;m<120;m++) balance=balance*(1+monthly)+r.contribution;
    assert.ok(Math.abs(balance-12000000)<0.02,`${annual}: ${balance}`);
  }
});
test('zero horizon, goal reached, and growth without contributions are distinct',()=>{
  assert.equal(core.calculate(base).result.contribution,null);
  assert.equal(core.calculate(base).result.shortfall,12000000);
  assert.equal(core.calculate({...base,initialCapital:12000000,years:1}).result.progress,'reached');
  const growth=core.calculate({...base,initialCapital:11000000,years:1,accumulationPercent:20}).result;
  assert.equal(growth.contribution,0);assert.equal(growth.progress,'growth');
});
test('nonpositive payout rate cannot produce a misleading capital or monthly income',()=>{
  for(const mode of ['goal','income']) for(const payoutPercent of [-1,0,5]) {
    const r=core.calculate({...base,mode,payoutPercent,inflationPercent:5});
    assert.equal(r.result.status,'unreachable');assert.equal(r.result.capital,undefined);
  }
});
test('blank, booleans, nonfinite and out-of-range values never silently become valid numbers',()=>{
  for(const value of ['',null,true,NaN,Infinity,-1,1e12+1]) assert.ok(core.validate({...base,monthlyIncome:value}).errors.monthlyIncome);
  assert.ok(core.validate({...base,years:60,months:1}).errors.months);
  assert.ok(core.validate({...base,months:1.5}).errors.months);
  assert.ok(core.validate({...base,accumulationPercent:-100}).errors.accumulationPercent);
  assert.ok(core.validate({...base,preservePurchasingPower:'false'}).errors.preservePurchasingPower);
  assert.ok(core.calculate({...base,monthlyIncome:1e12,years:60,inflationPercent:100,payoutPercent:100,preservePurchasingPower:false}).errors.result);
});
test('inactive drafts do not block calculation but unsafe saved metadata is rejected',()=>{
  assert.deepEqual(core.validate({...base,mode:'income',monthlyIncome:'',initialCapital:'',accumulationPercent:''}).errors,{});
  assert.equal(core.restore({...base,version:1}).invalid,false);
  assert.equal(core.restore({...base,version:2}).invalid,true);
  assert.equal(core.restore({...base,version:1,initialCapital:Infinity}).invalid,true);
  assert.equal(core.restore(undefined).invalid,false);
  assert.equal(core.defaults().monthlyIncome,'');
  assert.equal(core.defaults().preservePurchasingPower,true);
});
