import assert from 'node:assert/strict';
import { placeMatchesArea, areaQuery } from '../src/geo.js';
import { loadPlaces } from '../src/data.js';
import { planRouteHandler } from '../src/tools/planRoute.js';
import { findPlacesHandler } from '../src/tools/findPlaces.js';
import { resetState, updateState } from '../src/state.js';

const places = await loadPlaces();
const bts = places.filter((p) => p.visits.some((v) => v.group === 'BTS'));
const count = (q: string, list = places) => list.filter((p) => placeMatchesArea(p, q)).length;

// ── 1. 영어·일본어·중국어 지명 → 한국어 지역명과 같은 결과 ─────────────────
const seoulKo = count('서울', bts);
assert.equal(seoulKo, 52, 'BTS 서울 성지 52곳');
for (const q of ['Seoul', 'seoul', 'SEOUL', ' Seoul ', 'Seoul City', '首尔', '首爾', 'ソウル']) assert.equal(count(q, bts), seoulKo, q);
const yongsanKo = count('용산구');
for (const q of ['Yongsan-gu', 'yongsan-gu', 'Yongsan gu', 'Yongsangu', 'Yongsan', '龍山区', '龙山区', '龍山', 'ヨンサン', 'Itaewon']) assert.equal(count(q), yongsanKo, q);
assert.equal(count('Busan'), count('부산'));
assert.equal(count('釜山'), count('부산'));
assert.equal(count('Gangnam-gu'), count('강남구'));
assert.equal(count('Hongdae'), count('홍대'));
assert.equal(count('Seongsu-dong'), count('성수'));
assert.equal(count('Jeonju'), count('전주'));
assert.equal(count('Mokpo'), count('목포'));
assert.equal(count('木浦'), count('목포'));
assert.equal(count('Gangneung'), count('강릉'));
assert.equal(count('Daegu'), count('대구'));
assert.equal(count('대구'), places.filter((p) => p.region.startsWith('대구')).length, '대구가 해운대구에 걸리지 않음');
assert.equal(count('Korea'), places.length);
assert.equal(count('韓国'), places.length);
assert.equal(count('Atlantis'), 0);
assert.ok(areaQuery('Seoul').latin.includes('seoul'));

// planRoute: area="Seoul"/"seoul"/"Yongsan-gu"/"首尔"/"ソウル"로 BTS 코스가 나온다. 화면용 지역명은 한국어로 정리.
const user = 'test-places';
const ctx = { user, causedBy: [] } as any;
const plan = (args: Record<string, unknown>) => planRouteHandler({ key: 'plan_route', args } as any, ctx) as Promise<any>;
try {
  await resetState(user);
  for (const [area, label, en] of [['Seoul', '서울', 'Seoul'], ['seoul', '서울', 'Seoul'], ['Yongsan-gu', '서울 용산구', 'Seoul Yongsan-gu'], ['首尔', '서울', 'Seoul'], ['ソウル', '서울', 'Seoul']]) {
    const r = await plan({ area, group: 'BTS' });
    assert.ok(r.course.length > 0, `${area}: BTS 코스`);
    assert.ok(r.course.every((s: any) => s.visitGroups.includes('BTS')), `${area}: BTS가 다녀간 곳으로`);
    assert.equal(r.area, label, area);
    assert.equal(r.areaEn, en, area);
  }

  // ── 2. 성지는 그룹 단위: 최애가 멤버여도 그룹 성지 전체 ──────────────────
  const jimin = await plan({ area: 'Seoul', member: 'jimin' });
  assert.ok(jimin.course.length > 0, '지민 → BTS 서울 코스');
  assert.ok(jimin.course.every((s: any) => s.visitLabel?.kind === 'group' && s.visitLabel.name === 'BTS'), '지민 개인 기록이 없으니 "BTS가 다녀간 곳"');
  const fp = await findPlacesHandler({ key: 'find_places', args: { member: '지민' } } as any, ctx) as any;
  assert.equal(fp.totalCount, bts.length, '지민 → BTS 성지 78곳 전부');
  assert.equal(fp.regions[0].region, '서울');
  assert.equal(fp.regions[0].count, 52);
  assert.equal(fp.scope, 'group');
  assert.deepEqual(fp.searchedGroups, ['BTS']);
  assert.ok(fp.regions.every((r: any) => !r.hasFavoriteMemberVisit), '지민 개인 기록은 없음');
  // 멤버 개인 기록이 있는 멤버(RM)는 같은 78곳 + 개인 기록 표시, 코스에서 개인 기록 장소가 먼저
  const rm = await findPlacesHandler({ key: 'find_places', args: { member: 'RM' } } as any, ctx) as any;
  assert.equal(rm.totalCount, bts.length);
  assert.ok(rm.regions.some((r: any) => r.hasFavoriteMemberVisit));
  const rmRoute = await plan({ area: '서울', member: 'RM' });
  assert.equal(rmRoute.course[0].visitLabel.kind, 'member', 'RM 개인 기록이 있는 곳이 먼저');
  assert.equal(rmRoute.course[0].visitLabel.name, 'RM');
  // 저장된 최애가 멤버(지민)일 때도 그룹 단위
  await updateState(user, (s) => { s.preferences.favorites = [{ group: 'BTS', member: '지민' }]; });
  const saved = await findPlacesHandler({ key: 'find_places', args: {} } as any, ctx) as any;
  assert.equal(saved.totalCount, bts.length);

  // ── 3. 지역 없이 코스: 그 그룹 성지가 가장 많은 지역을 골라 하루 코스 ──────
  await resetState(user);
  const aespa = await plan({ group: '에스파' });
  assert.equal(aespa.area, '서울 용산구');
  assert.equal(aespa.areaEn, 'Seoul Yongsan-gu');
  assert.equal(aespa.autoArea.region, '서울특별시 용산구');
  assert.equal(aespa.autoArea.favoritePlaceCount, 6);
  assert.deepEqual(aespa.autoArea.groups, ['aespa']);
  assert.match(aespa.autoArea.reason, /서울 용산구/);
  assert.ok(aespa.course.length >= 3 && aespa.course.every((s: any) => s.visitGroups.includes('aespa')), '에스파가 다녀간 곳으로 하루 코스');
  assert.ok(aespa.course.every((s: any) => s.day === 1));
  // 멤버만 말해도(카리나) 같은 지역
  assert.equal((await plan({ member: '카리나' })).area, '서울 용산구');
  // 저장된 최애로도
  await updateState(user, (s) => { s.preferences.favorites = [{ group: 'aespa', member: '카리나' }]; });
  assert.equal((await plan({})).autoArea.region, '서울특별시 용산구');
  // 최애도 지역도 없으면 거절
  await resetState(user);
  assert.equal((await plan({})).status, 'rejected');
  console.log('PASS: 영어·일본어·중국어 지명 매칭, 성지는 그룹 단위(멤버는 우선순위만), 지역 없는 코스는 성지 최다 지역 자동 선택');
} finally {
  await resetState(user);
}
