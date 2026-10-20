/* Optional local PostgreSQL integration test; never connects to Supabase.
 * FINORA_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node tests/bank-import-sql.mjs
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
if(!process.env.FINORA_PGLITE_MODULE)throw Error('Set FINORA_PGLITE_MODULE to the optional local PGlite module.');
const {PGlite}=await import(pathToFileURL(process.env.FINORA_PGLITE_MODULE).href),db=new PGlite();
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
try {
 await db.exec(await readFile(new URL('./fixtures/bank-import-schema.sql',import.meta.url),'utf8'));
 const migration=await readFile(new URL('../supabase/migrations/202610200002_bank_import.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);
 const login=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 await login(a);await db.query("select public.finora_import_add_category('expense','Food',$1,'Shop')",[a]);await db.query("select public.finora_import_add_category('expense','Food',$1,'Other')",[a]);
 assert.equal((await db.query('select type,data from categories')).rows[0].type,'budget');assert.deepEqual((await db.query('select data from categories')).rows[0].data.expense,[{name:'Food',subcategories:['Shop','Other']}]);
 const hash='a'.repeat(64),op={type:'expense',category:'Food',subcategory:'Shop',date:'2026-10-20',amount:10,currency:'RUB',note:'Shop'};
 const save=async(key,operation=op,confirmed=false)=>(await db.query('select public.finora_import_operation($1,$2,$3,$4,$5::jsonb,$6) as result',[a,key,key.slice(0,64),'tbank:synthetic:1',JSON.stringify(operation),confirmed])).rows[0].result;
 const first=await save(hash+':row:1');assert.equal(first.status,'created');const retry=await save(hash+':row:1');assert.equal(retry.status,'existing');assert.equal(retry.operation.id,first.operation.id);
 assert.equal((await save(hash+':row:2')).status,'created');assert.equal((await db.query('select count(*)::int n from budget_items')).rows[0].n,2);
 assert.equal((await save('b'.repeat(64)+':row:1')).status,'ambiguous');assert.equal((await save('b'.repeat(64)+':row:1',op,true)).status,'created');
 await assert.rejects(save(hash+':invalid',{...op,category:'Missing'}),/category/i);assert.equal((await db.query('select count(*)::int n from bank_import_keys')).rows[0].n,3);
 await assert.rejects(save(hash+':badAmount',{...op,amount:-1}),/amount|payload/i);
 // Force the second write to fail: the preceding budget insert must roll back.
 await db.exec("reset role; create function public.reject_test_import_key() returns trigger language plpgsql as $$ begin raise exception 'synthetic key failure'; end $$; create trigger reject_test_import_key before insert on public.bank_import_keys for each row execute function public.reject_test_import_key();");
 await login(a);await assert.rejects(save(hash+':rollback',{...op,amount:11},true),/synthetic key failure/);assert.equal((await db.query('select count(*)::int n from budget_items')).rows[0].n,3);
 await db.exec('reset role; drop trigger reject_test_import_key on public.bank_import_keys; drop function public.reject_test_import_key();');await login(a);
 await assert.rejects(db.query('insert into bank_import_keys(user_id,import_key,file_hash,source_id,operation_id) values($1,$2,$3,$4,$5)',[a,hash+':direct',hash,'row',first.operation.id]),/permission denied/i);
 await db.query("insert into bank_import_rules(type,match_type,pattern,category) values('expense','description','Shop','Food')");
 await login(b);assert.equal((await db.query('select * from bank_import_rules')).rows.length,0);assert.equal((await db.query('select * from bank_import_keys')).rows.length,0);assert.equal((await db.query('select * from budget_items')).rows.length,0);
 await assert.rejects(db.query('insert into bank_import_rules(user_id,type,match_type,pattern,category) values($1,$2,$3,$4,$5)',[a,'expense','description','other','Food']),/row.level security/i);
 await assert.rejects(save(hash+':row:1'),/Authentication changed/i);
 await assert.rejects(db.query("select public.finora_import_operation($1,$2,$3,'row',$4::jsonb,false)",[b,hash+':row:1',hash,JSON.stringify(op)]),/category/i);
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)");await db.exec('set role anon');await assert.rejects(db.query("select public.finora_import_add_category('expense','Bad',$1,'')",[a]),/permission denied/i);
 console.log('PASS: migration rerun, atomic keys/retry, two purchases, ambiguity override, validation rollback, category merge, RLS isolation, anon rejection');
} finally {await db.close();}
