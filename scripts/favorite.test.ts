import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { appStateFile } from '../src/paths.js';
import { extractExplicitPreferences } from '../src/explicitPreferences.js';
import { applyFavoriteChange, buildFavoriteCatalog, canonicalGroup, detectFavoriteMode, noteFavoriteChange } from '../src/favorite.js';
import { savePreferencesHandler } from '../src/tools/savePreferences.js';
import { searchItemHandler } from '../src/tools/searchItem.js';
import { planRouteHandler } from '../src/tools/planRoute.js';
import { readState, resetState, updateState, type FavoriteEntry } from '../src/state.js';
import { loadAliases, loadItems, type Item } from '../src/data.js';

const items = await loadItems();
const aliases = await loadAliases();
const catalog = buildFavoriteCatalog(items, aliases);
const user = 'test-favorite';
const ctx = { user, causedBy: [] } as unknown as Parameters<typeof savePreferencesHandler>[1];
const inv = (key: string, args: Record<string, unknown>) => ({ key, args }) as Parameters<typeof savePreferencesHandler>[0];
const save = (args: Record<string, unknown>) => savePreferencesHandler(inv('save_preferences', args), ctx) as Promise<any>;
const favoritesOf = async () => (await readState(user)).preferences.favorites ?? [];

// server.ts /send와 같은 순서: 문장에서 추출 → applyFavoriteChange
async function say(text: string) {
  const { favorite } = extractExplicitPreferences(text, items, aliases, catalog);
  if (!favorite) return null;
  return updateState(user, (s) => {
    const applied = applyFavoriteChange(s.preferences.favorites, favorite.mode, favorite.entries);
    s.preferences.favorites = applied.favorites;
    return applied;
  });
}
const TAESAN: FavoriteEntry = { group: 'BOYNEXTDOOR', member: '태산' };
const KARINA: FavoriteEntry = { group: 'aespa', member: '카리나' };

try {
  // ── 요청한 테스트 ────────────────────────────────────────────────────────
  // 1) 태산 저장 → "카리나도 있어" → 둘 다 남음
  await resetState(user);
  await say('내 최애는 태산이야');
  assert.deepEqual(await favoritesOf(), [TAESAN]);
  await say('내 최애는 카리나도 있어');
  assert.deepEqual(await favoritesOf(), [TAESAN, KARINA]);

  // 2) "최애 카리나로 바뀌었어" → 카리나만
  await say('최애 카리나로 바뀌었어');
  assert.deepEqual(await favoritesOf(), [KARINA]);

  // 3) "태산은 빼줘" → 태산만 삭제 ("최애"라는 말이 없어도)
  await updateState(user, (s) => { s.preferences.favorites = [TAESAN, KARINA]; });
  await say('태산은 빼줘');
  assert.deepEqual(await favoritesOf(), [KARINA]);

  // 4) 예전 형식 app-state(favoriteGroup/favoriteMember) 불러오기
  await mkdir(path.dirname(appStateFile(user)), { recursive: true });
  await writeFile(appStateFile(user), JSON.stringify({
    wishlist: ['item_096'], owned: [], visitedPlaces: [], purchaseClicks: 2,
    preferences: { favoriteGroup: 'BOYNEXTDOOR', favoriteMember: '태산', budget: 50000 },
  }));
  const legacy = await readState(user);
  assert.deepEqual(legacy.preferences, { favorites: [TAESAN], budget: 50000 });
  assert.deepEqual(legacy.wishlist, ['item_096']);
  // 예전 형식에서 이어서 추가해도 예전 최애가 남는다 (이번 버그 그대로의 상황)
  await say('내 최애는 카리나도 있어');
  assert.deepEqual(await favoritesOf(), [TAESAN, KARINA]);
  const raw = await readState(user);
  assert.ok(!('favoriteGroup' in raw.preferences) && !('favoriteMember' in raw.preferences), '저장은 새 형식으로만');
  // 그룹만 있던 예전 형식
  await writeFile(appStateFile(user), JSON.stringify({ preferences: { favoriteGroup: 'IVE' } }));
  assert.deepEqual((await readState(user)).preferences, { favorites: [{ group: 'IVE' }] });

  // ── 추가/교체/삭제 구분 ──────────────────────────────────────────────────
  assert.equal(detectFavoriteMode('카리나도 좋아'), 'add');
  assert.equal(detectFavoriteMode('또 최애 생겼어 카리나'), 'add');
  assert.equal(detectFavoriteMode('최애 추가해줘 카리나'), 'add');
  assert.equal(detectFavoriteMode('내 최애는 카리나야'), 'add'); // 애매하면 추가
  assert.equal(detectFavoriteMode('최애 바뀌었어 카리나'), 'replace');
  assert.equal(detectFavoriteMode('이제 카리나만 좋아'), 'replace');
  assert.equal(detectFavoriteMode('카리나로 갈아탔어'), 'replace');
  assert.equal(detectFavoriteMode('태산은 이제 아니야'), 'remove');
  assert.equal(detectFavoriteMode('최애에서 태산 빼줘'), 'remove');

  await updateState(user, (s) => { s.preferences = { favorites: [TAESAN, KARINA] }; });
  await say('이제 카리나만 좋아');
  assert.deepEqual(await favoritesOf(), [KARINA]);
  await updateState(user, (s) => { s.preferences = { favorites: [TAESAN, KARINA] }; });
  await say('태산은 이제 아니야');
  assert.deepEqual(await favoritesOf(), [KARINA]);
  // 그룹만 말하고 빼면 그 그룹 항목 전부
  await updateState(user, (s) => { s.preferences = { favorites: [TAESAN, { group: 'BOYNEXTDOOR', member: '이한' }, KARINA] }; });
  await say('보이넥스트도어는 이제 최애 아니야');
  assert.deepEqual(await favoritesOf(), [KARINA]);
  // "사쿠야 가방 빼줘"(찜 이야기)는 최애를 건드리지 않는다
  await updateState(user, (s) => { s.preferences = { favorites: [{ group: 'NCT WISH', member: '사쿠야' }] }; });
  assert.equal(await say('사쿠야 가방 빼줘'), null);
  assert.deepEqual(await favoritesOf(), [{ group: 'NCT WISH', member: '사쿠야' }]);

  // ── 중복·같은 그룹 ───────────────────────────────────────────────────────
  await updateState(user, (s) => { s.preferences = { favorites: [TAESAN] }; });
  await say('내 최애는 태산이야'); // 중복 저장 안 함
  assert.deepEqual(await favoritesOf(), [TAESAN]);
  await say('최애 이한도 있어'); // 같은 그룹 멤버 추가 → 그룹 하나에 멤버 둘
  assert.deepEqual(await favoritesOf(), [TAESAN, { group: 'BOYNEXTDOOR', member: '이한' }]);
  await say('내 최애 그룹은 보이넥스트도어야'); // 이미 그 그룹 멤버가 있으면 그룹만 따로 안 늘어남
  assert.deepEqual((await favoritesOf()).length, 2);
  // 그룹만 저장돼 있다가 그 그룹 멤버가 생기면 그 자리를 멤버 항목이 대신
  assert.deepEqual(applyFavoriteChange([{ group: 'IVE' }, KARINA], 'add', [{ group: 'IVE', member: '장원영' }]).favorites,
    [{ group: 'IVE', member: '장원영' }, KARINA]);
  // 한 문장에 여러 명
  await resetState(user);
  await say('내 최애는 보이넥스트도어 태산이랑 에스파 카리나야');
  assert.deepEqual(await favoritesOf(), [TAESAN, KARINA]);

  // ── 멤버만 말해도 그룹 추론(이전 버그) ───────────────────────────────────
  assert.deepEqual(extractExplicitPreferences('내 최애는 사쿠야야', items, aliases).favorite?.entries, [{ group: 'NCT WISH', member: '사쿠야' }]);
  assert.deepEqual(extractExplicitPreferences('나 원영이 최애야', items, aliases).favorite?.entries, [{ group: 'IVE', member: '장원영' }]);
  assert.equal(canonicalGroup('엔시티 위시', catalog), 'NCT WISH');
  assert.deepEqual(extractExplicitPreferences('최애는 위시 리쿠!', items, aliases).favorite?.entries, [{ group: 'NCT WISH', member: '리쿠' }]);
  assert.equal(extractExplicitPreferences('최애템 위시리스트에 넣어줘', items, aliases).favorite, undefined);
  assert.equal(extractExplicitPreferences('최애 한 번 맞혀 봐', items, aliases).favorite, undefined);
  // 두 그룹에 같은 멤버명 → 저장 안 하고 되묻기
  const twoGroups = [{ group: 'NCT WISH', member: '사쿠야' }, { group: 'TEST GROUP', member: '사쿠야' }] as Item[];
  const amb = extractExplicitPreferences('내 최애는 사쿠야야', twoGroups).favorite!;
  assert.deepEqual(amb.entries, []);
  assert.deepEqual(amb.ambiguous[0]!.candidateGroups.sort(), ['NCT WISH', 'TEST GROUP']);

  // ── savePreferences Tool (mode) ─────────────────────────────────────────
  await resetState(user);
  let r = await save({ favoriteMember: '태산' });
  assert.equal(r.status, 'saved');
  r = await save({ favoriteMember: '카리나', favoriteMode: 'add' });
  assert.deepEqual(await favoritesOf(), [TAESAN, KARINA]);
  assert.equal(r.favorites.nowSaved, 'BOYNEXTDOOR 태산 · aespa 카리나');
  r = await save({ favoriteGroup: '아이브', favoriteMember: '사쿠야' }); // 모델이 엉뚱한 그룹을 붙여도 데이터 그룹으로
  assert.deepEqual((await favoritesOf()).at(-1), { group: 'NCT WISH', member: '사쿠야' });
  r = await save({ favoriteMember: '태산', favoriteMode: 'remove' });
  assert.deepEqual(await favoritesOf(), [KARINA, { group: 'NCT WISH', member: '사쿠야' }]);
  assert.equal(r.favorites.removed.length, 1);
  r = await save({ favoriteMember: '태산', favoriteMode: 'remove' }); // 없는 걸 지우면 그대로 알려 준다
  assert.match(r.note, /저장돼 있지 않아 지우지 못했다/);
  r = await save({ favoriteMember: '카리나', favoriteMode: 'replace' });
  assert.deepEqual(await favoritesOf(), [KARINA]);
  r = await save({ favoriteMember: '태산, 이한' }); // 쉼표로 여러 명
  assert.deepEqual(await favoritesOf(), [KARINA, TAESAN, { group: 'BOYNEXTDOOR', member: '이한' }]);
  // 같은 턴에 앱이 먼저 반영했으면 Tool도 "방금 저장/삭제됨"으로 보고한다(덕메가 거꾸로 말하지 않게)
  await resetState(user);
  const applied = await say('내 최애는 태산이야');
  noteFavoriteChange(user, applied!);
  r = await save({ favoriteMember: '태산' });
  assert.equal(r.favorites.added.length, 1);
  assert.equal(r.note, undefined);
  const removedFirst = await say('태산은 빼줘');
  noteFavoriteChange(user, removedFirst!);
  r = await save({ favoriteMember: '태산', favoriteMode: 'remove' });
  assert.equal(r.favorites.removed.length, 1);
  assert.equal(r.note, undefined);
  // 동명이인 그룹(Tool 경로)
  const sakuyaItem = items.find((i) => i.member === '사쿠야')!;
  items.push({ ...sakuyaItem, id: 'test_dup_sakuya', group: 'TEST GROUP' });
  try {
    await updateState(user, (s) => { s.preferences = { favorites: [{ group: 'IVE' }] }; });
    const ambiguous = await save({ favoriteMember: '사쿠야' });
    assert.equal(ambiguous.status, 'needs_group');
    assert.deepEqual(await favoritesOf(), [{ group: 'IVE' }]);
  } finally {
    items.pop();
  }

  // ── 검색·코스: 멤버/그룹을 안 정하면 최애 전체 기준(첫 번째 우선) ───────
  await updateState(user, (s) => { s.preferences = { favorites: [TAESAN, KARINA] }; });
  const found = await searchItemHandler(inv('search_item', { limit: 50 }), ctx) as any;
  assert.ok(found.results.length > 0);
  assert.ok(found.results.every((x: any) => x.group === 'BOYNEXTDOOR' || x.group === 'aespa'), '최애 그룹 템만');
  assert.equal(found.results[0].group, 'BOYNEXTDOOR', '첫 번째 최애 먼저');
  assert.equal(found.results[0].member, '태산', '첫 번째 최애 멤버 템이 맨 앞');
  assert.equal(found.results[1].group, 'aespa', '두 번째 최애 템도 개수 상한 안에 들어온다(번갈아)');
  assert.equal(found.results[1].member, '카리나');

  const route = await planRouteHandler(inv('plan_route', { area: '양평군' }), ctx) as any; // member/group 없이
  assert.ok(route.course.length > 0);
  // 성지는 그룹 단위: 양평 기록은 BOYNEXTDOOR 단체 방문이라 "태산이 다녀간 곳"이 아니라 그룹 이름으로 안내한다.
  assert.deepEqual(route.course[0].visitLabel, { kind: 'group', name: 'BOYNEXTDOOR', nameKo: '보이넥스트도어' }, '저장된 최애(태산)의 그룹이 다녀간 곳이 먼저');

  // 기억 초기화(scope=all)의 app-state 쪽: 최애까지 전부 비워진다
  await resetState(user);
  assert.deepEqual((await readState(user)).preferences, {});
  console.log('PASS: 최애 여러 명(추가/교체/삭제·중복 없음·같은 그룹), 예전 형식 변환, 검색·코스 최애 전체 기준');
} finally {
  await resetState(user);
}
