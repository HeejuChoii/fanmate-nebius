# 덕메 작업대 452개 통합 패치 — 530개 제품

이 ZIP 하나만으로 이전 `dukme_update.zip`의 수정사항까지 적용됩니다.
기존 기억·구매/찜·방문 정보(`.croche/`, `app-state/`)와 Croche 비밀키(`.env`)는 포함하지 않습니다.

## 맥 적용법

1. 압축파일을 **다운로드** 폴더에 저장 (`dukme_workbench_530_patch.zip`).
2. 작동 중인 덕메 서버 터미널에서 `Ctrl+C`로 종료. Claude Code 터미널일 필요 없음.
3. 새 터미널에서 아래 명령어 실행.

```bash
cp -R ~/dukme ~/dukme-backup-20261017
unzip -o ~/Downloads/dukme_workbench_530_patch.zip -d ~/dukme
cd ~/dukme
npm run typecheck
node --import tsx scripts/smoke.test.ts
npm start
```

이 명령은 기존 기억·앱 상태 파일을 지우지 않습니다. 원래 Mac 프로젝트의 파일이 ZIP 내 파일과 겹치면 덮어쓰므로 백업이 필수입니다.

## 무엇이 달라지나

- 기존 121개 + HTML 작업대 신규 409개 = 530개. 43개는 중복으로 판단하고 누락된 출처/판매처 메타만 보충.
- X 데이터는 `팬 계정 출처 · 미검증`, 가격 및 재고는 당시 기록으로 표시.
- 판매처 링크가 있는 경우에만 `판매처 확인하기`, 그렇지 않으면 `X 원본에서 보기`.
- 그룹 검색 분리, 아이찡 검색에 NCT WISH 단체템 섞임 방지, 예산 상한 필터, 상품명/색/카테고리 일부 동의어.
- Croche 대화에서 한국어 기본, 요청 시 영어·일본어·번체중국어 응답으로 전환하는 초기 규칙 + 선호언어 저장. 다국어 UI/제품 번역까지 완성됐다는 뜻은 아님.

## 데이터 확인용

- `WORKBENCH_IMPORT_REPORT.md`: 그룹별 총량·검증 주의사항
- `data/workbench_catalog_audit.csv`: 작업대 452행 중 신규/중복 및 원본/구매처
- `scripts/import_workbench_html.py`: 새 작업대 HTML 재반영 (반복 실행시 중복 추가 X, --dry-run 지원)

## 중요한 경계

실제 X 로그인·실시간 재고 검증, Claude 작업대 별도 사진 52개 다운로드, 관광상품 예약 결제·제휴 계약, 언어별 번역 품질 검수는 아직 완료하지 않았습니다.
코드는 정적 검사와 도구 단위 테스트를 통과해야 하며, 실제 Croche 런타임 대화 시연은 맥에서 실행해 확인해주세요.

발표자료/대본은 사용자 요청대로 **이 단계에서 건드리지 않았습니다**.
