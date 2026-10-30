#!/usr/bin/env python3
"""Merge rows-data from the exported '손민수 사진 작업대.html' into data/items.json.

This is a *catalog seed*, not an identity/stock verification job. No personal
Claude workbench image assets are embedded in the HTML snapshot. Existing
records take priority; rows not already cataloged become source_only.

Usage: python3 scripts/import_workbench_html.py '/path/to/손민수 사진 작업대.html'
       python3 scripts/import_workbench_html.py --dry-run '/path/to/file.html'
"""
from __future__ import annotations
import argparse, collections, csv, datetime, hashlib, html, json, re, shutil, sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT/'data/items.json'
AUDIT = ROOT/'data/workbench_catalog_audit.csv'

GROUP_NAMES = {
    'ive':'IVE','aespa':'aespa','le-sserafim':'LE SSERAFIM',
    'blackpink':'BLACKPINK','newjeans':'NewJeans','boynextdoor':'BOYNEXTDOOR',
    'cortis':'CORTIS','tws':'TWS','riize':'RIIZE','bts':'BTS',
    'allday-project':'ALLDAY PROJECT','nct-wish':'NCT WISH',
}
TOP_CAT = {
    'outer':'의류','top':'의류','bottom':'의류','dress':'의류',
    'hat':'모자','bag':'가방','shoes':'신발','acc':'액세서리',
    'eyewear':'액세서리','living':'생활','beauty':'뷰티',
}

class ScriptCollector(HTMLParser):
    def __init__(self):
        super().__init__(); self.capture=False; self.parts=[]; self.seen=False
    def handle_starttag(self, tag, attrs):
        if tag=='script' and dict(attrs).get('id')=='rows-data':
            self.capture=True; self.seen=True
    def handle_endtag(self,tag):
        if tag=='script': self.capture=False
    def handle_data(self,data):
        if self.capture:self.parts.append(data)

def norm(t):return re.sub(r'[^\w가-힣]+','', str(t or '').casefold())
def valid_https(v):
    if not isinstance(v,str) or len(v)>2000:return False
    try:
        p=urlparse(v)
        return p.scheme=='https' and bool(p.hostname) and not p.username and not p.password
    except ValueError:return False

def is_x(v):
    if not valid_https(v):return False
    return urlparse(v).hostname in ('x.com','www.x.com','twitter.com','www.twitter.com') and bool(re.search(r'/status/\d+',urlparse(v).path))

def price_value(s):
    s=str(s or '').strip()
    if not s:return None,None
    if s.startswith('$') or '¥' in s or s.startswith('€') or s.startswith('£'):
        return None,s
    if re.fullmatch(r'[\d,]+(?:원)?',s):
        return int(re.sub(r'[^\d]','',s)), None
    # Avoid silently guessing a currency from a free-form price string
    return None,s

def category(v):
    parts=[p.strip() for p in (v or '').split('|') if p.strip()]
    detail=parts[-1] if parts else '기타'
    return TOP_CAT.get(parts[1] if len(parts)>1 else (parts[0] if parts else ''),'의류' if parts[:1]==['fashion'] else '기타'),detail

def load_rows(html_path):
    parser=ScriptCollector()
    parser.feed(html_path.read_text(encoding='utf-8'))
    if not parser.seen or not parser.parts:raise ValueError('이 HTML에는 rows-data가 없습니다. 작업대 HTML을 다시 내보내 주세요.')
    rows=json.loads(''.join(parser.parts))
    if not isinstance(rows,list):raise ValueError('rows-data is not a JSON list')
    return rows

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('html',type=Path);p.add_argument('--dry-run',action='store_true')
    a=p.parse_args()
    rows=load_rows(a.html)
    original=json.loads(TARGET.read_text(encoding='utf-8'))
    db=list(original)
    # Do not overwrite verified wiki data with unverified sources.
    existing={(norm(x['group']),norm(x['member']),norm(x['brand']),norm(x['name'])):x for x in db}
    existing_ids={x['id'] for x in db}
    audit=[]; added=0; duplicates=0; enriched=0; invalid=0
    for r in rows:
        rid=str(r.get('id') or '').strip()
        g=GROUP_NAMES.get(r.get('g'))
        m=str(r.get('m') or '').strip(); brand=str(r.get('b') or '').strip(); prod=str(r.get('p') or '').strip()
        sources=[x for x in (r.get('t') or []) if is_x(x)]
        shops=[x for x in (r.get('l') or []) if valid_https(x) and not is_x(x) and urlparse(x).hostname not in ('x.com','twitter.com','www.x.com','www.twitter.com')]
        price,price_text=price_value(r.get('pr'))
        status=str(r.get('st') or '').strip()
        cat,detail=category(r.get('cat'))
        record={'workbench_id':rid,'group':g or '', 'member':m,'brand':brand,'name':prod,
                'price_recorded':str(r.get('pr') or ''),'stock_recorded':status,
                'source_x':';'.join(sources),'purchase_url':shops[0] if shops else '', 'action':'','matched_id':''}
        if not g or not m or not brand or not prod or not sources or not rid:
            record['action']='invalid'; invalid+=1; audit.append(record);continue
        key=tuple(norm(x) for x in (g,m,brand,prod))
        if key in existing:
            found=existing[key]; changed=False
            # Match already stored: NEVER downgrade 'exact'/wiki verified data.
            # Attach additional fan-source and purchase metadata only when absent.
            if shops and not found.get('url'):
                found['url']=shops[0];found['shop']=urlparse(shops[0]).hostname;changed=True
            if sources:
                if not found.get('sourceUrl'):
                    found['sourceUrl']=sources[0];changed=True
                elif found['sourceUrl'] != sources[0]:
                    refs=found.setdefault('fanSourceUrls',[])
                    if sources[0] not in refs:
                        refs.append(sources[0]);changed=True
            if (found.get('price') is None and not found.get('priceText')) and (price is not None or price_text):
                found['price']=price;found['priceText']=price_text
                found['priceProvenance']='workbench_unverified';changed=True
            ids=found.setdefault('workbenchIds',[])
            if rid != found.get('workbenchId') and rid not in ids:
                ids.append(rid);changed=True
            if status and not found.get('workbenchStock'):
                found['workbenchStock']=status;changed=True
            record['action']='duplicate_enriched' if changed else 'duplicate'
            record['matched_id']=found['id'];duplicates+=1;enriched+=int(changed);audit.append(record);continue
        ident='wb_'+re.sub(r'[^a-z0-9_-]','_',rid.lower())
        if ident in existing_ids:
            ident='wb_'+hashlib.sha256(('|'.join(key)).encode()).hexdigest()[:14]
        existing_ids.add(ident)
        # No sold-out rows are present in this HTML. '판매중' is a past workbench observation
        # rather than a live inventory check, so don't claim live in-stock status.
        desc=f"팬 계정 X 게시물에서 수집한 제품 후보 · {r.get('sit') or '착용 상황 미확인'}"
        if status: desc+=f" · 작업대 기록: {status} (실시간 검증 아님)"
        row={
            'id':ident,'group':g,'member':m,'situation':str(r.get('sit') or '').strip(),
            'date':str(r.get('d') or '').strip(),'category':cat,'detailCategory':detail,
            'brand':brand,'name':prod,
            'price':price,'priceText':price_text,'url':shops[0] if shops else '',
            'shop':urlparse(shops[0]).hostname if shops else None,'wikiUrl':None,
            'sourceUrl':sources[0],'features':desc,'accuracy':'unverified_fan_source',
            'soldOut':False,'stockStatus':'unknown','workbenchStock':status,
            'workbenchId':rid,'isOriginal':False,'matchType':'source_only',
            'alternativeOf':None,'isSample':False,
        }
        db.append(row); existing[key]=row; record['action']='added';record['matched_id']=ident; added+=1; audit.append(record)
    counts={'source_rows':len(rows),'added':added,'duplicates':duplicates,'enriched':enriched,'invalid':invalid,'total':len(db),'groups':dict(collections.Counter(r['group'] for r in db))}
    print(json.dumps(counts,ensure_ascii=False,indent=2))
    if not a.dry_run:
        bak=TARGET.with_suffix('.json.backup-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
        shutil.copy2(TARGET,bak)
        TARGET.write_text(json.dumps(db,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        with AUDIT.open('w',encoding='utf-8-sig',newline='') as f:
            w=csv.DictWriter(f,fieldnames=list(audit[0]))
            w.writeheader();w.writerows(audit)
        print('Backup:',bak.name,'Audit:',AUDIT.name)

if __name__=='__main__':main()
