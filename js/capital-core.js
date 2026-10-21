(function(root){
  'use strict';
  const ranges={monthlyIncome:[0,1e12],payoutCapital:[0,1e12],initialCapital:[0,1e12],years:[0,60],months:[0,11],inflationPercent:[0,100],accumulationPercent:[-99,100],payoutPercent:[-99,100]};
  function defaults(){return {mode:'goal',monthlyIncome:'',payoutCapital:'',initialCapital:0,years:'',months:0,inflationPercent:'',accumulationPercent:'',payoutPercent:'',preservePurchasingPower:true};}
  function number(value){
    if(typeof value==='number')return value;
    if(typeof value==='string'&&value.trim()!==''&&/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value.trim()))return Number(value.trim().replace(',','.'));
    return NaN;
  }
  function validNumber(key,n){const [min,max]=ranges[key];return Number.isFinite(n)&&n>=min&&n<=max&&(!['years','months'].includes(key)||Number.isInteger(n));}
  function validate(raw){
    const values=defaults(),errors={};
    values.mode=raw.mode;values.preservePurchasingPower=raw.preservePurchasingPower;
    if(!['goal','income'].includes(raw.mode))errors.mode='Выберите режим расчёта.';
    if(typeof raw.preservePurchasingPower!=='boolean')errors.preservePurchasingPower='Укажите условие сохранения капитала.';
    const active=new Set(['years','months','inflationPercent','payoutPercent',...(raw.mode==='income'?['payoutCapital']:['monthlyIncome','initialCapital','accumulationPercent'])]);
    for(const key of Object.keys(ranges)){
      const n=number(raw[key]);values[key]=validNumber(key,n)?n:'';
      if(active.has(key)&&!validNumber(key,n))errors[key]=`Введите ${['years','months'].includes(key)?'целое число':'число'} от ${ranges[key][0]} до ${ranges[key][1].toLocaleString('ru-RU')}.`;
    }
    if(raw.mode==='goal'&&values.monthlyIncome===0)errors.monthlyIncome='Желаемый доход должен быть больше нуля.';
    if(values.years*12+values.months>720)errors.months='Общий срок — не более 60 лет.';
    return {values,errors};
  }
  function calculate(raw){
    const checked=validate(raw),{values:v,errors}=checked;
    if(Object.keys(errors).length)return {...checked,result:null};
    const n=v.years*12+v.months;
    const factor=Math.exp(Math.log1p(v.inflationPercent/100)*n/12);
    const spend=(v.payoutPercent-(v.preservePurchasingPower?v.inflationPercent:0))/100;
    if(spend<=0)return {...checked,result:{status:'unreachable'}};
    const income=v.mode==='goal'?v.monthlyIncome*factor:v.payoutCapital*spend/12;
    const capital=v.mode==='goal'?12*income/spend:v.payoutCapital;
    const result={status:'ok',capital,monthlyIncome:income,incomeToday:income/factor,capitalToday:capital/factor,contribution:null,shortfall:null,progress:null};
    if(v.mode==='goal'){
      const logMonthly=Math.log1p(v.accumulationPercent/100)/12;
      const growth=Math.exp(logMonthly*n),monthly=Math.expm1(logMonthly);
      result.shortfall=Math.max(0,capital-v.initialCapital);
      result.progress=v.initialCapital>=capital?'reached':v.initialCapital*growth>=capital?'growth':'saving';
      if(n>0){
        const missing=capital-v.initialCapital*growth;
        result.contribution=Math.max(0,monthly===0?missing/n:missing*monthly/Math.expm1(logMonthly*n));
      }
    }
    if(Object.values(result).some(x=>typeof x==='number'&&(!Number.isFinite(x)||Math.abs(x)>Number.MAX_SAFE_INTEGER)))return {...checked,errors:{result:'Результат слишком велик. Уменьшите суммы, срок или ставки.'},result:null};
    return {...checked,result};
  }
  function restore(saved){
    if(saved===undefined||saved===null)return {values:defaults(),invalid:false};
    if(typeof saved!=='object'||saved.version!==1)return {values:defaults(),invalid:true};
    const parsed=validate(saved);
    const badStored=Object.keys(ranges).some(key=>saved[key]!==''&&!validNumber(key,number(saved[key])));
    if(badStored||Object.keys(parsed.errors).length)return {values:defaults(),invalid:true};
    return {values:parsed.values,invalid:false};
  }
  const api={defaults,validate,calculate,restore};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.FinoraCapitalCore=api;
})(typeof window==='object'?window:globalThis);
