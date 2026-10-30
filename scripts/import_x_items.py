#!/usr/bin/env python3
"""Import X fan account research into dukme/data/items.json without treating it as verified.
Usage: python3 scripts/import_x_items.py path/to/workbench_export.csv
Required CSV columns: 그룹,멤버,브랜드,제품명,색상/옵션,가격,구매링크(있는경우에),카테고리,착용 상황,날짜,원본 트윗 주소
or English aliases (group,member,brand,name,color,price,buyUrl,category,situation,date,sourceUrl).
Existing rows are never modified. Makes a dated backup if changes are written.
"""
import csv, hashlib, json, sys, shutil, datetime, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
DB=ROOT/'data/items.json'
MAP={
 'group':['그룹','group'], 'member':['멤버','member'], 'brand':['브랜드','brand'],
 'name':['제품명','name'], 'color':['색상/옵션','color'], 'price':['가격','price'],
 'buyUrl':['구매링크(있는경우에)','구매링크','buyUrl','url'], 'category':['카테고리','category'],
 'situation':['착용 상황','situation'], 'date':['날짜','date'], 'sourceUrl':['원본 트윗 주소','sourceUrl','원본 링크']
}
CAT={'티셔츠':'의류','셔츠':'의류','폴로셔츠':'의류','니트베스트':'의류','스카프':'액세서리','셔츠드레스':'의류','튜닉셔츠':'의류','데님팬츠':'의류','진':'의류','벨트':'액세서리','의류':'의류','후드':'의류','폰케이스':'디지털','그립톡':'디지털','조거':'의류','스니커즈':'신발','자켓':'의류','스웻팬츠':'의류','체인':'액세서리','헤드폰':'디지털','백팩':'가방','모자':'모자','오버롤':'의류','시계':'액세서리','이어머프':'액세서리','베스트':'의류','집업':'의류','트랙탑':'의류'}
def val(row, key):
 return next((str(row.get(k) or '').strip() for k in MAP[key] if str(row.get(k) or '').strip()),'')
def norm(s):return re.sub(r'\s+', ' ', s.strip().casefold())
def main(path):
 with open(path,encoding='utf-8-sig',newline='') as f: rows=list(csv.DictReader(f))
 db=json.loads(DB.read_text(encoding='utf-8'))
 seen={(norm(d['group']),norm(d['member']),norm(d['brand']),norm(d['name']),norm(d.get('sourceUrl') or '')) for d in db}
 added=0; invalid=[]
 for i,row in enumerate(rows,2):
  v={key:val(row,key) for key in MAP}
  if not all(v[k] for k in ('group','member','brand','sourceUrl')):
   invalid.append(i);continue
  if not re.match(r'^https://(x\.com|twitter\.com)/[^/]+/status/\d+', v['sourceUrl'],re.I):
   invalid.append(i);continue
  if not v['name']: v['name']='제품명 미확인'
  key=tuple(norm(v[k]) for k in ('group','member','brand','name','sourceUrl'))
  if key in seen:continue
  seen.add(key)
  sig='|'.join(v[k] for k in ('group','member','brand','name','color','sourceUrl'))
  ident='x_'+hashlib.sha256(sig.encode()).hexdigest()[:12]
  # X fan source is NOT verification of appearance, price, exactness or stock.
  db.append({'id':ident,'group':v['group'],'member':v['member'],'situation':v['situation'],'date':v['date'],
             'category':CAT.get(v['category'], v['category'] or '기타'), 'detailCategory':v['category'] or None,
             'brand':v['brand'],'name':v['name'],'price':None,'priceText':None,
             'url':'','shop':None,'wikiUrl':None,'sourceUrl':v['sourceUrl'],
             'features':'팬 계정 수집 · '+v['situation']+((' · 옵션: '+v['color']) if v['color'] else '')+' · 착용·재고 확인 필요',
             'accuracy':'unverified_fan_source','soldOut':False,'stockStatus':'unknown',
             'isOriginal':False,'matchType':'source_only','alternativeOf':None,'isSample':False})
  added+=1
 if added:
  backup=DB.with_name('items.backup-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.json')
  shutil.copy2(DB,backup)
  DB.write_text(json.dumps(db,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(f'추가: {added}건 / 기존·중복: {len(rows)-added-len(invalid)}건 / 제외(필수값·X URL 오류): {len(invalid)}건 / 총 {len(db)}건')
 if invalid:print('제외된 CSV 행:', invalid[:50])
 print('중요: X 게시물만으로 착용·품절·가격·구매가능 여부가 검수된 것은 아닙니다.')
if __name__=='__main__':
 if len(sys.argv)!=2:sys.exit('Usage: python3 scripts/import_x_items.py export.csv')
 main(sys.argv[1])
