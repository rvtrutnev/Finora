(function(root){
  'use strict';
  function create({core,getContext,savePlan,onChange=()=>{}}){
    let epoch=0,revision=0;
    const state={values:core.defaults(),dirty:false,busy:false,message:'',touched:{},attempted:false};
    function emit(){state.calculation=core.calculate(state.values);onChange(state);}
    function reset(){epoch++;revision++;Object.assign(state,{values:core.defaults(),dirty:false,busy:false,message:'',touched:{},attempted:false});emit();}
    function load(saved){
      if(state.dirty||state.busy)return;
      const restored=core.restore(saved);state.values=restored.values;
      state.message=restored.invalid?'Не удалось прочитать сохранённый расчёт. Заполните параметры заново.':saved?'Загружен сохранённый расчёт.':'';
      state.touched={};state.attempted=false;revision++;emit();
    }
    function edit(field,value){
      if(!Object.hasOwn(core.defaults(),field))return;
      state.values={...state.values,[field]:value};state.touched[field]=true;state.dirty=true;revision++;
      state.message=state.busy?'Сохраняем предыдущие значения. Новый ввод ещё не сохранён.':'Изменения не сохранены.';emit();
    }
    async function save(){
      if(state.busy)return;
      state.attempted=true;
      const calculated=core.calculate(state.values),context={...getContext()};
      if(Object.keys(calculated.errors).length||calculated.result?.status!=='ok'){state.message='Проверьте параметры: сохранить можно только корректный расчёт.';emit();return;}
      if(!context.userId){state.message='Войдите в учётную запись для сохранения.';emit();return;}
      const startEpoch=epoch,startRevision=revision;
      const current=()=>{const now=getContext();return epoch===startEpoch&&now.userId===context.userId&&now.generation===context.generation;};
      state.busy=true;state.message='Сохраняем расчёт…';emit();
      try{
        const saved=await savePlan({version:1,...calculated.values},context);
        if(!current())return;
        if(saved===false)throw Error('inactive save');
        state.dirty=revision!==startRevision;
        state.message=state.dirty?'Изменения не сохранены.':'Расчёт сохранён в учётной записи.';
      }catch(_error){if(current()){state.dirty=true;state.message='Не удалось сохранить расчёт. Проверьте соединение и повторите сохранение.';}}
      finally{if(current()){state.busy=false;emit();}}
    }
    emit();return {state,edit,load,reset,save};
  }
  const api={create};if(typeof module==='object'&&module.exports)module.exports=api;else root.FinoraCapitalUI=api;
})(typeof window==='object'?window:globalThis);
