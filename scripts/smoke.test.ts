import assert from 'node:assert/strict';
import {searchItemHandler} from '../src/tools/searchItem.js';
import {savePreferencesHandler} from '../src/tools/savePreferences.js';
import {readState,resetState} from '../src/state.js';
import {loadItems} from '../src/data.js';

const user='test-workbench-catalog';
const ctx={user,causedBy:[]} as Parameters<typeof searchItemHandler>[1];
const inv=(key:string,args:Record<string,unknown>)=>({key,args}) as Parameters<typeof searchItemHandler>[0];
try {
  const items=await loadItems();
  assert.ok(items.length>=530, '작업대 합본 530개 이상');
  assert.ok(items.filter(x=>x.group==='IVE').length>=119);
  assert.ok(items.filter(x=>x.group==='NCT WISH').length>=116);
  assert.ok(items.filter(x=>x.group==='BOYNEXTDOOR').length>=52);
  assert.ok(items.filter(x=>x.group==='TWS').length>=35);
  assert.ok(items.filter(x=>x.matchType==='source_only').every(x=>x.stockStatus==='unknown'));
  assert.ok(items.some(x=>x.group==='IVE' && x.priceText?.startsWith('$')), 'USD 기록 유지');
  assert.ok(items.every(x=>!x.url || /^https:\/\//.test(x.url)),'구매 URL 스킴');

  const a2o=await searchItemHandler(inv('search_item',{member:'아이찡'}),ctx) as any;
  assert.equal(a2o.query.group,'a2o lite');
  assert.ok(a2o.results.length && a2o.results.every((x:any)=>x.group==='A2O LITE'));
  const ive=await searchItemHandler(inv('search_item',{group:'아이브',member:'장원영'}),ctx) as any;
  assert.ok(ive.results.length && ive.results.every((x:any)=>x.group==='IVE'&&x.member==='장원영'));
  const searchBudget=await searchItemHandler(inv('search_item',{group:'IVE',maxPrice:50000}),ctx) as any;
  assert.ok(searchBudget.results.length && searchBudget.results.every((x:any)=>x.price !== null && x.price<=50000));

  const saved=await savePreferencesHandler(inv('save_preferences',{favoriteGroup:'IVE',budget:50000,colors:'브라운',language:'en',shoppingMode:'travel'}),ctx) as any;
  assert.equal(saved.status,'saved');
  assert.equal((await readState(user)).preferences.language,'en');
  const rec=await searchItemHandler(inv('search_item',{recommendationsOnly:true,limit:5}),ctx) as any;
  assert.equal(rec.query.group,'ive');
  assert.equal(rec.appliedPreferences.budget,50000);
  console.log('PASS: catalog 530, group isolation, X provenance, currency, budget, personalization, language preference');
} finally {
  await resetState(user);
}
