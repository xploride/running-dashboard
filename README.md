# Running / Move with intent

모바일 우선 러닝 대시보드입니다. 러닝 요약은 JSONBin에 저장하고, GPX 좌표는 현재 브라우저 탭의 세션에만 보관합니다. 지도는 MapLibre GL JS와 OpenFreeMap을 사용합니다.

## 핵심 기능

- 주간 목표, 최근 러닝, 월간 통계, 페이스 추세와 구간 분석
- GPX 파싱, 날짜 기반 기록 연결, 경로 애니메이션
- Apple 건강 `export.xml` 러닝 요약 가져오기
- iOS 앱에서 선택한 러닝과 경로를 Apple HealthKit에 저장
- AI 코치와 로컬 기본 코칭
- 설치 가능한 PWA와 모바일 하단 내비게이션

## 데이터 원칙

- JSONBin 저장: 날짜, 거리, 시간, 페이스, 평균 심박수, 칼로리, 메모, 출처
- 세션 저장: GPX 좌표
- 저장하지 않음: GPX 원본, 위치 좌표, JSONBin 키

JSONBin 요청은 브라우저가 아닌 `/api/runs` 서버 함수에서 처리합니다. `X-Master-Key`는 서버에서만 추가되므로 클라이언트 번들에 키가 포함되지 않습니다.

## 로컬 실행

```bash
npm install
npm run dev
```

루트에 `.env`를 만들고 다음 서버 전용 값을 설정합니다.

```env
JSONBIN_API_KEY=your_master_key_here
JSONBIN_BIN_ID=your_bin_id_here
ANTHROPIC_API_KEY=optional_anthropic_key
```

`VITE_` 접두사는 브라우저에 값을 노출하므로 사용하지 않습니다.

## 확인 명령

```bash
npm run lint
npm run build
```

## Vercel

프로젝트 환경 변수에 `JSONBIN_API_KEY`, `JSONBIN_BIN_ID`를 등록합니다. AI 코치를 원하면 `ANTHROPIC_API_KEY`도 추가합니다. GitHub의 `master` 브랜치가 연결되어 있으면 push 후 자동 배포됩니다.

## iMac에서 iOS 마무리

Apple HealthKit은 브라우저/PWA에서 직접 사용할 수 없으므로 iOS 네이티브 앱이 필요합니다. iOS 프로젝트와 HealthKit 플러그인은 저장소에 포함되어 있습니다.

```bash
npm install
npm run ios:sync
npm run ios:open
```

Xcode에서 다음만 완료합니다.

1. `App` 타깃의 Signing & Capabilities에서 Apple Developer Team을 선택합니다.
2. HealthKit capability가 표시되는지 확인합니다. 없으면 `+ Capability`에서 HealthKit을 추가합니다.
3. Bundle Identifier `com.xploride.running`이 계정에서 사용 가능하지 않으면 고유한 값으로 변경합니다.
4. 실제 iPhone을 연결해 빌드하고 건강 접근을 허용합니다. HealthKit 쓰기는 시뮬레이터보다 실제 기기 검증이 적합합니다.
5. 앱의 Runs 화면에서 `건강 저장`을 눌러 Apple 건강의 운동 기록과 경로를 확인합니다.

서명과 HealthKit capability 활성화에는 Apple Developer 계정과 macOS/Xcode가 필요합니다. Windows에서는 웹 빌드와 iOS 프로젝트 생성·동기화까지만 가능합니다.
