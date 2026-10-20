/* Browser globals: FinoraImportPdf (requires FinoraImportCore).
 * parsePages(pages): pages = [{pageNumber:1,width:595,height:842,items:[
 *   {str, transform:[a,b,c,d,x,y], width,height} // unmodified PDF.js text item
 * ], horizontalLines?:[{x1,y1,x2,y2}]}]. Optional horizontal rules use the same
 * PDF bottom-left coordinates; read() extracts them for VTB's centered cells.
 * Coordinates are PDF bottom-left, unrotated points. Arrays must be in
 * document order; item extraction order is immaterial. Rotated/changed layouts
 * are unsupported. read() obtains this schema locally from pinned PDF.js.
 * Results: {bank:'tbank'|'alfa'|'vtb'|'otp',rows,warnings:string[]}.
 * Rows use ImportCore schema; sourceLocation={page,top}. A sourceId is only an
 * unverified fingerprint, NEVER sufficient to silently deduplicate accounts or
 * overlapping statements. The consumer must scope definite retries by file hash.
 * Limits: 50 MiB, 200 pages, 1 million text items. No network PDF loading, scripts,
 * eval, attachments or external fonts. Library/worker load lazily from this origin.
 */
(function(root,factory){
  const isNode=typeof module==='object'&&module.exports;
  const api=factory(isNode?require('./import-core.js'):root.FinoraImportCore,
    isNode?require('node:url').pathToFileURL(__filename).href:typeof document!=='undefined'?document.currentScript?.src:null);
  if(isNode)module.exports=api;else root.FinoraImportPdf=api;
})(typeof window!=='undefined'?window:globalThis,function(core,scriptURL){
  'use strict';
  const MAX_BYTES=50*1024*1024,MAX_PAGES=200,MAX_ITEMS=1000000;
  const layouts={
    tbank:{width:595,date:[50,120],posted:[120,195],operation:[195,290],amount:[290,385],desc:[385,495],bottom:750},
    alfa:{width:595.3,date:[20,90],amount:[500,585],desc:[185,500],bottom:710},
    vtb:{width:595,date:[25,85],posted:[85,152],operation:[152,235],credit:[235,305],debit:[305,390],desc:[390,500],bottom:785},
    otp:{width:841.89,date:[110,200],debit:[360,485],credit:[485,620],desc:[200,360],purpose:[620,825],bottom:550}
  };
  const datePattern=/^\d{2}\.\d{2}\.\d{4}(?:\s|$)/;
  const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
  function detect(text,pages){
    if(/альфа[ -]?банк/i.test(text))return 'alfa';
    if(/отп\s*банк/i.test(text))return 'otp';
    if(/\bvtb\b|втб/i.test(text))return 'vtb';
    if(/т[ -]банк|тинькофф|t[ -]bank/i.test(text))return 'tbank';
    // The supplied OTP template uses an image logo. Identify its text/table
    // combination, not arbitrary occurrences of "отп" in sender descriptions.
    if(/счет-выписка/i.test(text)&&/расход/i.test(text)&&/приход/i.test(text)&&/назначение платежа/i.test(text)){
      const page=pages[0],scale=841.89/page.width;
      if(page.width>=page.height&&[[116,/дата операции/i],[368,/расход/i],[490,/приход/i],[625,/назначение платежа/i]].every(([x,pattern])=>page.items.some(i=>pattern.test(i.str)&&Math.abs(i.transform?.[4]*scale-x)<10)))return 'otp';
    }
    throw new Error('Неизвестный формат PDF. Поддерживаются предоставленные форматы Т-Банка, Альфа, ВТБ и ОТП.');
  }
  function cellsIn(items,range){return items.filter(i=>i.x>=range[0]&&i.x<range[1]);}
  function textOf(items){return clean([...items].sort((a,b)=>Math.abs(a.top-b.top)>2?a.top-b.top:a.x-b.x).map(i=>i.str).join(' '));}
  function moneyCell(items){
    const lines=[];
    for(const i of [...items].sort((a,b)=>a.top-b.top||a.x-b.x)){
      let line=lines.find(l=>Math.abs(l.top-i.top)<2);
      if(!line){line={top:i.top,items:[]};lines.push(line);}line.items.push(i);
    }
    let minor=null,currency=null;
    for(const line of lines){
      const text=textOf(line.items),value=core.parseMoney(text);
      if(minor===null && value!==null)minor=value;
      const token=text.match(/\b[A-Z]{3}\b|₽|€/i);
      if(token)currency=core.normalizeCurrency(token[0]);
    }
    return {minor,currency};
  }
  function isHeading(item){
    return /^(?:дата(?:\s|$)|операции$|дата и время|списания$|обработки|банком$|сумма(?:\s|$)|в валюте|валюта|описание(?:\s|$)|номер карты|карты$|код операции|назначение платежа|приход$|расход$|получателя|наименование|операция$|номер$)/i.test(clean(item.str));
  }
  function parsePages(pages){
    if(!Array.isArray(pages)||!pages.length||!pages.some(p=>p.items?.some(i=>clean(i.str))))throw new Error('В PDF нет текста. Сканированные документы пока не поддерживаются.');
    if(pages.length>MAX_PAGES)throw new Error('Слишком много страниц PDF (не более 200).');
    const bank=detect(pages.slice(0,2).flatMap(p=>p.items.map(i=>i.str)).join(' '),pages);
    const layout=layouts[bank],warnings=[],blocks=[];
    let previous=null,totalItems=0;
    for(let p=0;p<pages.length;p++){
      const page=pages[p];
      if(!Number.isFinite(page.height)||!Number.isFinite(page.width)||page.width<=0||page.height<=0)throw new Error('Неверные координаты страницы PDF.');
      totalItems+=page.items.length;if(totalItems>MAX_ITEMS)throw new Error('PDF содержит слишком много текста.');
      // The supplied templates have a fixed aspect ratio. Scaling is supported;
      // rotation is rejected rather than silently assigning the wrong columns.
      if((bank==='otp' && page.width<page.height)||(bank!=='otp'&&page.width>page.height))throw new Error('Неподдерживаемая ориентация страницы PDF.');
      const scale=layout.width/page.width;
      const items=page.items.filter(i=>clean(i.str)&&Array.isArray(i.transform)).map(i=>({str:i.str,x:i.transform[4]*scale,top:(page.height-i.transform[5])*scale})).filter(i=>Number.isFinite(i.x)&&Number.isFinite(i.top));
      if(bank==='alfa'&&p===0){
        const pending=items.find(i=>/неподтвержденные операции/i.test(i.str));
        if(pending){
          const total=moneyCell(cellsIn(items.filter(i=>Math.abs(i.top-pending.top)<3),layout.amount));
          if(total.minor>0)warnings.push(`Неподтверждённые операции: ${(total.minor/100).toFixed(2)} ${total.currency||'RUB'}. Они не входят в операции по счёту; печатный расход может включать эту сумму.`);
        }
      }
      let pageBottom=layout.bottom;
      if(bank==='otp'){
        const summary=items.find(i=>i.x>=200&&i.x<360&&core.parseMoney(i.str)!==null&&
          cellsIn(items.filter(t=>Math.abs(t.top-i.top)<2),layout.debit).some(t=>core.parseMoney(t.str)!==null)&&
          cellsIn(items.filter(t=>Math.abs(t.top-i.top)<2),layout.credit).some(t=>core.parseMoney(t.str)!==null));
        if(summary)pageBottom=Math.min(pageBottom,summary.top-2);
      }
      const anchors=cellsIn(items,layout.date).filter(i=>datePattern.test(clean(i.str))).sort((a,b)=>a.top-b.top);
      const unique=anchors.filter((a,i)=>!i||Math.abs(a.top-anchors[i-1].top)>2);
      const rowLines=bank==='vtb'?(page.horizontalLines||[]).filter(l=>Math.abs(l.y1-l.y2)<.2&&l.x1*scale<=400&&l.x2*scale>=495).map(l=>(page.height-l.y1)*scale).sort((a,b)=>a-b):[];
      const rowStart=anchor=>rowLines.filter(top=>top<anchor.top).at(-1)??anchor.top-3;
      // Continuations preceding the first dated line on a subsequent page belong
      // to the preceding operation. Only description columns, never headers.
      if(p>0&&previous){
        const boundary=unique[0]?rowStart(unique[0])-1:pageBottom;
        const continuation=items.filter(i=>i.top<boundary&&i.top>25&&i.top<pageBottom&&!isHeading(i));
        previous.continuation.push(...cellsIn(continuation,layout.desc));
        if(layout.purpose)previous.purpose.push(...cellsIn(continuation,layout.purpose));
      }
      for(let i=0;i<unique.length;i++){
        const anchor=unique[i];
        if(anchor.top>pageBottom)continue;
        const ruledBottom=rowLines.find(top=>top>anchor.top);
        const bottom=Math.min(ruledBottom??(unique[i+1]?.top-3||pageBottom),pageBottom);
        const block={page:page.pageNumber||p+1,top:anchor.top,date:anchor.str,items:items.filter(t=>t.top>=rowStart(anchor)&&t.top<bottom),continuation:[],purpose:[]};
        blocks.push(block);previous=block;
      }
    }
    const rows=[];
    for(const block of blocks){
      const {items}=block,at=range=>cellsIn(items,range);
      let descItems=at(layout.desc);
      let desc=clean(textOf(descItems)+' '+textOf(block.continuation));
      if(layout.purpose)desc=clean(desc+' '+textOf(at(layout.purpose))+' '+textOf(block.purpose));
      const posted=layout.posted?textOf(at(layout.posted)).match(/\d{2}\.\d{2}\.\d{4}/)?.[0]:block.date;
      let date=block.date,mcc=null,rowWarnings=[];
      if(bank==='alfa'){
        const dates=[...new Set((desc.match(/\b\d{2}\.\d{2}\.\d{4}\b/g)||[]).filter(d=>core.normalizeDate(d)))];
        const shortDate=desc.match(/дата\s+(?:совершения\s+)?операции:\s*(\d{2}\.\d{2}\.)(\d{2})(?!\d)/i);
        if(shortDate){
          const postedISO=core.normalizeDate(posted),full=shortDate[1]+(postedISO?postedISO.slice(0,2):'20')+shortDate[2];
          if(core.normalizeDate(full)&&!dates.includes(full))dates.push(full);
        }
        if(dates.length===1)date=dates[0];else rowWarnings.push('Дата покупки не определена однозначно; использована дата проводки.');
        mcc=desc.match(/\bMCC\s*[:=]?\s*(\d{4})\b/i)?.[1]||null;
      }
      if(bank==='otp')rowWarnings.push('Использована дата операции банка; отдельная дата покупки отсутствует.');
      let money;
      const amountAt=range=>at(range).filter(i=>i.top<=block.top+12);
      if(layout.amount)money=moneyCell(amountAt(layout.amount));
      else{
        const debit=moneyCell(amountAt(layout.debit)),credit=moneyCell(amountAt(layout.credit));
        if(debit.minor && credit.minor){warnings.push(`Страница ${block.page}, строка ${Math.round(block.top)}: одновременно приход и расход; строка требует ручной проверки.`);continue;}
        money=debit.minor?{minor:-Math.abs(debit.minor),currency:debit.currency}:credit;
      }
      // OTP's supplied RUB statement has bare debit/credit amounts. Other
      // adapters require currency adjacent to the account amount.
      const currency=money.currency||(bank==='otp'?'RUB':null);
      let operation=layout.operation?moneyCell(amountAt(layout.operation)):null;
      if(bank==='alfa'){
        const match=desc.match(/на сумму:?\s+([+−-]?[\d\s]+[.,]\d{2})\s+([A-Z]{3}|₽|€)/i);
        if(match){const minor=core.parseMoney(match[1]);operation={minor:minor===null?null:(money.minor<0?-Math.abs(minor):Math.abs(minor)),currency:core.normalizeCurrency(match[2])};}
      }
      const row=core.normalizeRow({date,postedDate:posted,desc,signedMinor:money.minor,currency,mcc,warnings:rowWarnings,operationAmountMinor:operation?.minor,operationCurrency:operation?.currency,sourceLocation:{page:block.page,top:Math.round(block.top*100)/100}});
      if(row){row.sourceIdentity='unverified';rows.push(row);}else warnings.push(`Страница ${block.page}, строка ${Math.round(block.top)}: не удалось разобрать дату, сумму или валюту.`);
    }
    if(!blocks.length)throw new Error('Не найдена поддерживаемая структура операций PDF.');
    if(!rows.length)throw new Error('Операции PDF не распознаны. Проверьте формат документа.');
    return {bank,rows:core.identifyRows(bank,rows),warnings};
  }
  let libraryPromise;
  function horizontalRules(operators,OPS){
    const rules=[],stack=[];let matrix=[1,0,0,1,0,0];
    const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
    for(let n=0;n<operators.fnArray.length;n++){
      const op=operators.fnArray[n],args=operators.argsArray[n];
      if(op===OPS.save)stack.push([...matrix]);
      else if(op===OPS.restore)matrix=stack.pop()||[1,0,0,1,0,0];
      else if(op===OPS.transform)matrix=multiply(matrix,args);
      else if(op===OPS.constructPath){
        // PDF.js 6.4.299 gives the path's [minX,minY,maxX,maxY] bounds.
        const bounds=args[2];
        if(bounds?.length!==4||Math.abs(bounds[1]-bounds[3])>.1)continue;
        const [a,b,c,d,e,f]=matrix;
        const x1=a*bounds[0]+c*bounds[1]+e,y1=b*bounds[0]+d*bounds[1]+f,x2=a*bounds[2]+c*bounds[3]+e,y2=b*bounds[2]+d*bounds[3]+f;
        if(Math.abs(y1-y2)<.2&&Math.abs(x2-x1)>50)rules.push({x1:Math.min(x1,x2),y1,x2:Math.max(x1,x2),y2});
      }
    }
    return rules;
  }
  async function loadLibrary(){
    if(!libraryPromise)libraryPromise=(async()=>{
      const path=scriptURL?new URL('../vendor/pdfjs/pdf.mjs',scriptURL).href:'../vendor/pdfjs/pdf.mjs';
      const lib=await import(path);
      lib.GlobalWorkerOptions.workerSrc=scriptURL?new URL('../vendor/pdfjs/pdf.worker.mjs',scriptURL).href:'../vendor/pdfjs/pdf.worker.mjs';
      return lib;
    })().catch(error=>{libraryPromise=null;throw error;});
    return libraryPromise;
  }
  async function read(file,{onProgress}={}){
    if(!file||typeof file.arrayBuffer!=='function')throw new Error('Не выбран файл PDF.');
    if(!Number.isFinite(file.size)||file.size<=0||file.size>MAX_BYTES)throw new Error('Недопустимый размер PDF (не более 50 МБ).');
    const data=new Uint8Array(await file.arrayBuffer());
    if(!new TextDecoder('ascii').decode(data.subarray(0,1024)).includes('%PDF-'))throw new Error('Файл не является PDF.');
    let task,doc,passwordRequested=false;
    try{
      const lib=await loadLibrary();
      task=lib.getDocument({data,isEvalSupported:false,enableXfa:false,useSystemFonts:false,disableFontFace:true,stopAtErrors:true,verbosity:0});
      task.onPassword=()=>{passwordRequested=true;void task.destroy();};
      doc=await task.promise;
      if(doc.numPages>MAX_PAGES)throw new Error('Слишком много страниц PDF (не более 200).');
      const pages=[];let count=0;
      for(let n=1;n<=doc.numPages;n++){
        const page=await doc.getPage(n),viewport=page.getViewport({scale:1});
        if(viewport.rotation!==0)throw new Error('Неподдерживаемый поворот страницы PDF.');
        const text=await page.getTextContent();count+=text.items.length;
        if(count>MAX_ITEMS)throw new Error('PDF содержит слишком много текста.');
        pages.push({pageNumber:n,width:viewport.width,height:viewport.height,items:text.items});
        onProgress?.({page:n,totalPages:doc.numPages,progress:n/doc.numPages});
        page.cleanup();
      }
      if(detect(pages.slice(0,2).flatMap(p=>p.items.map(i=>i.str)).join(' '),pages)==='vtb'){
        for(let n=1;n<=doc.numPages;n++){
          const page=await doc.getPage(n);
          pages[n-1].horizontalLines=horizontalRules(await page.getOperatorList(),lib.OPS);
          page.cleanup();
        }
      }
      return parsePages(pages);
    }catch(error){
      if(passwordRequested||error?.name==='PasswordException'||/password|passwordcancel|loading aborted/i.test(error?.message||''))throw new Error('PDF защищён паролем. Экспортируйте незашифрованную выписку.');
      if(error?.name==='InvalidPDFException'||error?.name==='UnknownErrorException')throw new Error('Повреждённый или неподдерживаемый PDF.');
      throw error;
    }finally{if(task)await task.destroy();}
  }
  return {read,parsePages};
});
