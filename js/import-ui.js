/* Bank import controller. Adapters receive the captured {userId,generation};
 * saveOperation({importKey,fileHash,sourceId,confirmAmbiguous,operation}, context)
 * returns {status:'created'|'existing'|'ambiguous', operation?}. Atomic persistence
 * belongs to the server RPC, not to this preview. File SHA256 + parser identity
 * and ordinal identify retries of exactly the same bytes only.
 */
(function(root,factory){
  const node=typeof module==='object'&&module.exports;
  const api=factory(node?require('./import-core.js'):root.FinoraImportCore,
    node?null:root.FinoraImportPdf,node?require('node:crypto').webcrypto:root.crypto);
  if(node)module.exports=api;else root.FinoraImportUI=api;
})(typeof window!=='undefined'?window:globalThis,function(core,pdf,crypto){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const control='bg-dark-300 border border-dark-500 rounded px-2 py-2 text-sm text-dark-900 focus:border-gold-600';
  const banks={tbank:'Т-Банк',alfa:'Альфа-Банк',vtb:'ВТБ',otp:'ОТП'};
  const signature=b=>core.duplicateSignature({date:b.date,type:b.type,currency:b.currency||'RUB',amountMinor:Math.round(Number(b.amount)*100),desc:b.note||b.desc||''});
  function create(options){
    const {root,getContext,getCategories,getBudgetItems,saveCategory,loadRules,loadImportKeys,saveRule,saveOperation,onSaved}=options;
    let epoch=0,rules=[],savedText=null,fileHash=null,knownKeys=new Set();
    const state={rows:[],status:'',ruleStatus:'',bank:null,warnings:[],busy:false,loading:false,skipIncome:false,manualBank:false,categoryRow:null,ruleRow:null,categoryDraft:null,ruleDraft:null};
    const context=()=>({...getContext()});
    const valid=(c,e)=>e===epoch&&!!c.userId&&c.userId===getContext().userId&&c.generation===getContext().generation;
    const categories=type=>getCategories()?.[type]||[];
    const targetValid=r=>categories(r.type).some(c=>c.name===r.category&&(!r.subcategory||(c.subcategories||[]).some(s=>(typeof s==='string'?s:s.name)===r.subcategory)));
    const visible=r=>!state.skipIncome||r.type==='expense';
    function closeForms(){state.categoryRow=state.ruleRow=null;state.categoryDraft=state.ruleDraft=null;}
    function reset(){epoch++;rules=[];savedText=null;fileHash=null;knownKeys=new Set();closeForms();Object.assign(state,{rows:[],status:'',ruleStatus:'',bank:null,warnings:[],busy:false,loading:false,skipIncome:false,manualBank:false});render();}
    function applyParsed(result){
      state.bank=result.bank;state.warnings=result.warnings||[];state.manualBank=false;
      const known=new Set((getBudgetItems()||[]).map(signature));
      state.rows=result.rows.map((r,i)=>{
        const importKey=`${fileHash}:${r.sourceId}:${i+1}`;
        return {...r,...core.suggestCategory(r,getCategories(),rules),importKey,saved:knownKeys.has(importKey),checked:r.checked&&!knownKeys.has(importKey),confirmed:false,ambiguous:!knownKeys.has(importKey)&&known.has(core.duplicateSignature(r)),error:''};
      });
      state.status=state.rows.length?'Проверьте категории и предупреждения перед сохранением.':'Нет распознанных операций. Проверьте формат файла.';
    }
    async function loadFile(file){
      if(!file)return;reset();const c=context(),e=epoch;
      if(!c.userId){state.status='Войдите в учётную запись для импорта.';render();return;}
      state.loading=true;state.status='Чтение файла…';render();
      try{
        if(file.size>50*1024*1024)throw Error('Файл больше 50 МиБ. Разделите выписку.');
        const bytes=await file.arrayBuffer();if(!valid(c,e))return;
        const digest=await crypto.subtle.digest('SHA-256',bytes);if(!valid(c,e))return;
        fileHash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
        try{const loadedRules=await loadRules(c);if(!valid(c,e))return;rules=loadedRules;}
        catch(error){if(!valid(c,e))return;rules=[];state.ruleStatus='Правила не загружены: '+error.message+'. Категории можно назначить вручную.';}
        if(loadImportKeys){
          try{const loadedKeys=await loadImportKeys(fileHash,c);if(!valid(c,e))return;knownKeys=new Set(loadedKeys);}
          catch(error){if(!valid(c,e))return;state.ruleStatus+=' История импорта не загружена: '+error.message+'. Совпадения потребуют проверки.';}
        }
        const ext=file.name.split('.').pop().toLowerCase();let parsed;
        if(ext==='pdf'){
          if(!pdf)throw Error('PDF-модуль не загружен. Обновите страницу.');
          parsed=await pdf.read({arrayBuffer:async()=>bytes,size:bytes.byteLength},{onProgress:p=>{if(valid(c,e)){state.status='Чтение PDF… '+(p?.page&&p?.totalPages?('страница '+p.page+' из '+p.totalPages):'');render();}}});
        }else{
          if(ext==='csv'){
            try{savedText=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{savedText=new TextDecoder('windows-1251').decode(bytes);}
          }else if(ext==='xls'||ext==='xlsx'){
            if(!globalThis.XLSX)throw Error('Модуль Excel не загружен. Проверьте подключение и обновите страницу.');
            const book=globalThis.XLSX.read(bytes,{type:'array'});
            savedText=globalThis.XLSX.utils.sheet_to_csv(book.Sheets[book.SheetNames[0]],{FS:';'});
          }else throw Error('Выберите PDF, CSV, XLS или XLSX.');
          parsed=core.parseDelimited(savedText);
        }
        if(!valid(c,e))return;applyParsed(parsed);
      }catch(error){if(!valid(c,e))return;state.status='Не удалось прочитать выписку: '+error.message;state.manualBank=!!savedText;}
      finally{if(valid(c,e)){state.loading=false;render();}}
    }
    function withBank(bank){if(!savedText||state.busy)return;try{applyParsed(core.parseDelimited(savedText,bank));}catch(error){state.status=error.message;}render();}
    function updateRow(i,change){
      const r=state.rows[i];if(!r||r.saved||state.busy||state.loading)return;
      if(change.type&&change.type!==r.type){r.type=change.type;r.category='';r.subcategory='';r.confirmed=false;r.warnings=[...r.warnings.filter(w=>!w.startsWith('Тип изменён')),'Тип изменён вручную — проверьте направление.'];}
      if(Object.hasOwn(change,'category')&&change.category!==r.category)r.subcategory='';
      for(const k of ['category','subcategory','checked','confirmed'])if(Object.hasOwn(change,k))r[k]=change[k];
      r.error='';render();
    }
    async function createCategory(i,name,subcategory=''){
      if(state.busy||state.loading)return;const r=state.rows[i];if(!r)return;
      state.categoryDraft={category:String(name),subcategory:String(subcategory)};
      name=String(name).trim();subcategory=String(subcategory).trim();if(!name){state.status='Введите название категории.';render();return;}
      const c=context(),e=epoch;state.busy=true;state.status='Сохранение категории…';render();
      try{await saveCategory({type:r.type,name,subcategory},c);if(!valid(c,e))return;
        // Adapter publishes the server-confirmed category tree before resolving.
        if(!categories(r.type).some(x=>x.name===name))throw Error('Сервер не подтвердил категорию');
        r.category=name;r.subcategory=subcategory;state.categoryRow=null;state.categoryDraft=null;state.status='Категория сохранена.';
      }catch(error){if(valid(c,e))state.status='Категория не сохранена: '+error.message;}
      finally{if(valid(c,e)){state.busy=false;render();}}
    }
    async function createRule(i,matchType,pattern){
      if(state.busy||state.loading)return;const r=state.rows[i];if(!r)return;
      state.ruleDraft={matchType,pattern:String(pattern)};
      pattern=String(pattern).trim();if(!targetValid(r)||!pattern||!['description','mcc'].includes(matchType)||(matchType==='mcc'&&!/^\d{4}$/.test(pattern))){state.ruleStatus='Выберите существующую категорию и заполните текст или MCC из 4 цифр.';render();return;}
      const rule={type:r.type,matchType,pattern,category:r.category,subcategory:r.subcategory||''},c=context(),e=epoch;
      state.busy=true;state.ruleStatus='Сохранение правила…';render();
      try{await saveRule(rule,c);if(!valid(c,e))return;rules.push(rule);state.ruleRow=null;state.ruleDraft=null;state.ruleStatus='Правило сохранено. Применится при следующем чтении выписки.';}
      catch(error){if(valid(c,e))state.ruleStatus='Правило не сохранено: '+error.message+'. Операции можно сохранить отдельно.';}
      finally{if(valid(c,e)){state.busy=false;render();}}
    }
    async function save(){
      if(state.busy||state.loading)return;const c=context(),e=epoch;if(!valid(c,e)){reset();return;}
      const rows=state.rows.filter(r=>r.checked&&!r.saved&&visible(r));
      if(!rows.length){state.status='Выберите операции для сохранения.';render();return;}
      if(rows.some(r=>!targetValid(r))){state.status='Укажите существующие категории и подкатегории для всех выбранных операций.';render();return;}
      if(rows.some(r=>(r.warnings.length||r.ambiguous)&&!r.confirmed)){state.status='Подтвердите проверку предупреждений и возможных совпадений у выбранных операций.';render();return;}
      state.busy=true;let created=0,existing=0,failed=0;state.status='Сохранение операций…';render();
      try{
        for(const r of rows){
          if(!valid(c,e))return;
          try{
            const result=await saveOperation({importKey:r.importKey,fileHash,sourceId:r.sourceId,confirmAmbiguous:r.confirmed,operation:{type:r.type,category:r.category,subcategory:r.subcategory||null,amount:r.amount,currency:r.currency,date:r.date,note:r.desc}},c);
            if(!valid(c,e))return;
            if(result.status==='ambiguous'){r.ambiguous=true;r.confirmed=false;r.error='Найдено возможное совпадение. Подтвердите повторный импорт.';failed++;continue;}
            if(!['created','existing'].includes(result.status)||!result.operation?.id)throw Error('Сервер не подтвердил сохранение');
            r.saved=true;r.checked=false;r.error='';result.status==='created'?created++:existing++;onSaved?.(result.operation,c);
          }catch(error){if(!valid(c,e))return;r.error=error.message;failed++;}
        }
        state.status=`Сохранено: ${created}. Уже импортировано из этого файла: ${existing}. Требуют повторной попытки: ${failed}.`;
      }finally{if(valid(c,e)){state.busy=false;render();}}
    }
    function renderForms(attrs){
      return `${state.categoryRow!==null?`<form data-category-form class="card rounded-xl p-4 mt-4"><p class="mb-3 text-dark-900">Новая категория (${state.rows[state.categoryRow]?.type==='expense'?'расход':'доход'}). Для подкатегории укажите существующую категорию.</p>
          <label class="block mb-3">Категория<input name="category" required maxlength="120" value="${esc(state.categoryDraft?.category)}" class="${control} block w-full"></label>
          <label class="block mb-3">Подкатегория (необязательно)<input name="subcategory" maxlength="120" value="${esc(state.categoryDraft?.subcategory)}" class="${control} block w-full"></label>
          <button class="btn-gold px-4 py-2 rounded-lg"${attrs}>Сохранить категорию</button>
          <button type="button" data-cancel class="${control}"${attrs}>Отмена</button></form>`:''}
        ${state.ruleRow!==null?`<form data-rule-form class="card rounded-xl p-4 mt-4"><p class="mb-3 text-dark-900">Правило для ${state.rows[state.ruleRow]?.type==='expense'?'расходов':'доходов'} → ${esc(state.rows[state.ruleRow]?.category||'сначала выберите категорию')}. Текст сопоставляется по вхождению без учёта регистра, MCC — точно.</p>
          <label class="block mb-3">Условие<select name="matchType" class="${control} block"><option value="description"${state.ruleDraft?.matchType==='description'?' selected':''}>Описание содержит</option><option value="mcc"${state.ruleDraft?.matchType==='mcc'?' selected':''}>MCC равен</option></select></label>
          <label class="block mb-3">Текст или MCC<input name="pattern" required maxlength="500" value="${esc(state.ruleDraft?.pattern)}" class="${control} block w-full"></label>
          <button class="btn-gold px-4 py-2 rounded-lg"${attrs}>Сохранить правило</button>
          <button type="button" data-cancel class="${control}"${attrs}>Отмена</button></form>`:''}`;
    }
    function render(){
      if(!root)return;
      const focused=root.ownerDocument?.activeElement;
      const focusField=focused?.dataset?.field,focusRow=focused?.closest?.('[data-row]')?.dataset?.row;
      const focusSkip=focused?.hasAttribute?.('data-skip'),focusAll=focused?.hasAttribute?.('data-all');
      const disabled=state.busy||state.loading,attrs=disabled?' disabled':'';
      const selected=state.rows.filter(r=>r.checked&&!r.saved&&visible(r));
      const totals={};for(const r of state.rows){const x=totals[r.currency]||=( {expense:0,income:0});x[r.type]+=r.amountMinor;}
      const money=(minor,currency)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency}).format(minor/100);
      const opts=(values,value,placeholder)=>`<option value="">${placeholder}</option>`+values.map(v=>`<option value="${esc(v)}"${v===value?' selected':''}>${esc(v)}</option>`).join('');
      root.innerHTML=`<h1 class="text-xl font-semibold gold-text tracking-wide mb-2">Импорт выписки</h1>
        <p class="text-sm text-dark-700 mb-6">Загрузите выписку, проверьте операции и назначьте категории перед сохранением.</p>
        <div data-dropzone class="border-2 border-dashed border-dark-500 rounded-xl p-6 text-center mb-4">
          <label for="bank-import-file" class="block text-dark-800 mb-3">Перетащите выписку или выберите файл</label>
          <input id="bank-import-file" type="file" accept=".pdf,.csv,.xls,.xlsx" class="${control} max-w-full"${attrs}>
          <p class="text-xs text-dark-700 mt-3">PDF: Т-Банк, Альфа-Банк, ВТБ, ОТП. CSV / Excel: Т-Банк, Альфа-Банк. До 50 МиБ.</p>
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" class="text-sm text-dark-900 mb-3">${esc(state.status)}</p>
        <p role="status" aria-live="polite" class="text-sm text-dark-800 mb-3">${esc(state.ruleStatus)}</p>
        ${state.manualBank?`<div class="flex flex-wrap gap-3 mb-4"><span>Банк таблицы:</span><button data-bank="tbank" class="${control}">Т-Банк</button><button data-bank="alfa" class="${control}">Альфа-Банк</button></div>`:''}
        ${state.warnings.length?`<div class="text-sm text-danger-600 mb-4"><p>Часть выписки требует проверки:</p><ul class="list-disc pl-5">${state.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div>`:''}
        ${state.rows.length?`<div class="card rounded-xl p-4 mb-4"><p class="text-dark-900 mb-2">${esc(banks[state.bank]||state.bank)} · Операций: ${state.rows.length} · Выбрано: ${selected.length}</p>
          ${Object.entries(totals).map(([currency,x])=>`<p class="text-sm text-dark-800">${esc(currency)}: расходы ${money(x.expense,currency)} · доходы ${money(x.income,currency)}</p>`).join('')}
          <div class="flex flex-wrap items-center gap-4 mt-4"><label class="text-sm"><input data-skip type="checkbox"${state.skipIncome?' checked':''}${attrs}> Не импортировать доходы</label><button data-save class="btn-gold px-5 py-2 rounded-lg text-sm"${attrs}>${state.busy?'Сохранение…':'Сохранить выбранные'}</button></div></div>
          <div class="card rounded-xl overflow-x-auto"><table class="w-full text-sm"><caption class="sr-only">Предпросмотр операций выписки</caption><thead><tr class="bg-dark-400/50 text-left"><th class="p-3"><input data-all type="checkbox" aria-label="Выбрать все видимые операции"${attrs}></th><th class="p-3">Дата / описание</th><th class="p-3">Сумма / тип</th><th class="p-3">Категория / подкатегория</th><th class="p-3">Проверка / правило</th></tr></thead><tbody>
          ${state.rows.map((r,i)=>!visible(r)?'':`<tr class="border-b border-dark-400" data-row="${i}"><td class="p-3 align-top"><input type="checkbox" data-field="checked" aria-label="Выбрать операцию ${i+1}"${r.checked?' checked':''}${disabled||r.saved?' disabled':''}></td>
            <td class="p-3 align-top"><time>${esc(r.date)}</time><p class="mt-1 text-dark-900" style="min-width:12rem;max-width:24rem;overflow-wrap:anywhere">${esc(r.desc)}</p>${r.mcc?`<p class="text-xs text-dark-700">MCC ${esc(r.mcc)}</p>`:''}${r.saved?'<p class="text-success-600">Сохранено</p>':''}${r.error?`<p role="alert" class="text-danger-600">${esc(r.error)}</p>`:''}</td>
            <td class="p-3 align-top whitespace-nowrap"><p class="mb-2 ${r.type==='expense'?'text-danger-600':'text-success-600'}">${money(r.amountMinor,r.currency)}</p><select data-field="type" aria-label="Тип операции ${i+1}" class="${control}"${disabled||r.saved?' disabled':''}><option value="expense"${r.type==='expense'?' selected':''}>Расход</option><option value="income"${r.type==='income'?' selected':''}>Доход</option></select></td>
            <td class="p-3 align-top"><select data-field="category" aria-label="Категория операции ${i+1}" class="${control} w-full mb-2"${disabled||r.saved?' disabled':''}>${opts(categories(r.type).map(c=>c.name),r.category,'Назначить категорию')}</select>
              <select data-field="subcategory" aria-label="Подкатегория операции ${i+1}" class="${control} w-full mb-2"${disabled||r.saved?' disabled':''}>${opts((categories(r.type).find(c=>c.name===r.category)?.subcategories||[]).map(s=>typeof s==='string'?s:s.name),r.subcategory,'Без подкатегории')}</select>
              <button data-category="${i}" class="text-gold-600 underline"${disabled||r.saved?' disabled':''}>Создать категорию / подкатегорию</button></td>
            <td class="p-3 align-top" style="min-width:14rem">${r.warnings.map(w=>`<p class="text-danger-600 mb-2">${esc(w)}</p>`).join('')}${r.ambiguous?'<p class="text-danger-600 mb-2">Возможное совпадение с бюджетом / другой выпиской. Проверьте, нужна ли ещё одна операция.</p>':''}${r.warnings.length||r.ambiguous?`<label class="block mb-3"><input type="checkbox" data-field="confirmed"${r.confirmed?' checked':''}${disabled||r.saved?' disabled':''}> Проверено, сохранить выбранную операцию</label>`:''}<button data-rule="${i}" class="text-gold-600 underline"${disabled||r.saved?' disabled':''}>Создать правило</button></td></tr>`).join('')}</tbody></table></div>`:''}
        ${renderForms(attrs)}`;
      if(focusField&&focusRow!==undefined)root.querySelector(`[data-row="${focusRow}"] [data-field="${focusField}"]`)?.focus();
      else if(focusSkip)root.querySelector('[data-skip]')?.focus();else if(focusAll)root.querySelector('[data-all]')?.focus();
    }
    function rememberDraft(event){
      const form=event.target.closest?.('form');
      if(form?.hasAttribute('data-category-form')){
        state.categoryDraft={category:form.elements.category.value,subcategory:form.elements.subcategory.value};
      }else if(form?.hasAttribute('data-rule-form')){
        state.ruleDraft={matchType:form.elements.matchType.value,pattern:form.elements.pattern.value};
      }
    }
    function handleClick(event){
      const el=event.target.closest('button');
      if(!el)return;
      if(el.hasAttribute('data-save'))save();
      else if(el.dataset.bank)withBank(el.dataset.bank);
      else if(el.hasAttribute('data-category')){
        closeForms();state.categoryRow=Number(el.dataset.category);
        state.categoryDraft={category:state.rows[state.categoryRow]?.category||'',subcategory:''};
        render();root.querySelector('[data-category-form] input')?.focus();
      }else if(el.hasAttribute('data-rule')){
        closeForms();state.ruleRow=Number(el.dataset.rule);
        state.ruleDraft={matchType:'description',pattern:state.rows[state.ruleRow]?.desc||''};
        render();root.querySelector('[data-rule-form] select')?.focus();
      }else if(el.hasAttribute('data-cancel')){closeForms();render();}
    }
    function handleSubmit(event){
      event.preventDefault();rememberDraft(event);
      const form=event.target;
      if(form.hasAttribute('data-category-form'))createCategory(state.categoryRow,state.categoryDraft.category,state.categoryDraft.subcategory);
      else if(form.hasAttribute('data-rule-form'))createRule(state.ruleRow,state.ruleDraft.matchType,state.ruleDraft.pattern);
    }
    if(root){
      root.addEventListener('change',event=>{const el=event.target;if(el.id==='bank-import-file')loadFile(el.files[0]);else if(el.hasAttribute('data-skip')){state.skipIncome=el.checked;render();}else if(el.hasAttribute('data-all')){state.rows.forEach(r=>{if(visible(r)&&!r.saved)r.checked=el.checked;});render();}else if(el.dataset.field)updateRow(Number(el.closest('[data-row]').dataset.row),{[el.dataset.field]:el.type==='checkbox'?el.checked:el.value});});
      root.addEventListener('input',rememberDraft);
      root.addEventListener('change',rememberDraft);
      root.addEventListener('click',handleClick);
      root.addEventListener('submit',handleSubmit);
      root.addEventListener('dragover',event=>{event.preventDefault();});
      root.addEventListener('drop',event=>{event.preventDefault();if(!state.busy)loadFile(event.dataTransfer.files[0]);});
    }
    render();return {reset,loadFile,state,updateRow,save,createCategory,createRule,withBank};
  }
  return {create};
});
