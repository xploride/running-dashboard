# RUNNING/03 App Store 출시

## 앱 정보

- 앱 이름: RUNNING/03
- Bundle ID: com.xploride.running
- 버전: 1.0.0
- 빌드: 1
- 기본 언어: 한국어
- 카테고리: 건강 및 피트니스
- 부제: 러닝 기록과 경로를 한눈에
- 개인정보 처리방침: https://running-dashboard-two.vercel.app/privacy.html
- 지원 URL: https://running-dashboard-two.vercel.app/support.html

## 설명

RUNNING/03은 Apple Watch와 Apple 건강의 러닝 기록을 간결하게 정리하는 개인 러닝 대시보드입니다.

주간 거리와 최근 러닝을 빠르게 확인하고, 페이스 흐름과 훈련 강도를 분석하세요. Apple 건강에서 러닝 요약과 경로를 가져오거나 GPX 파일을 연결해 실제 코스를 지도에서 재생할 수 있습니다. 선택한 러닝은 Apple 건강에 다시 저장할 수 있습니다.

- Apple 건강 및 Apple Watch 러닝 동기화
- 거리, 시간, 페이스, 심박수, 칼로리 요약
- GPX 경로 지도와 애니메이션
- 주간 목표와 최근 10주 훈련 흐름
- 선택형 AI 러닝 코치
- 광고와 사용자 추적 없음

RUNNING/03은 의료 진단 또는 치료를 제공하지 않습니다.

## 키워드

러닝,달리기,조깅,애플워치,건강,GPX,페이스,운동기록,경로

## App Review 메모

HealthKit 기능은 실제 iPhone에서 확인할 수 있습니다.

1. 앱의 설정 탭을 엽니다.
2. APPLE 건강 동기화를 누릅니다.
3. 운동, 걷기 및 달리기 거리, 활동 에너지, 심박수, 운동 경로 권한을 허용합니다.
4. Apple 건강에 러닝 기록이 있으면 앱의 기록과 경로 탭에 표시됩니다.
5. 기록 탭의 건강 저장은 GPX 또는 수동 러닝을 Apple 건강에 저장합니다.

GPS 좌표는 서버로 전송하지 않고 현재 기기 세션에서만 사용합니다. iOS 앱의 러닝 요약은 기기 로컬에 저장됩니다. AI 코치는 사용자가 직접 질문하고 최초 전송 동의에 확인한 경우에만 최근 러닝 요약을 전송하며 GPS 좌표는 포함하지 않습니다.

## App Privacy 응답

- 추적에 사용되는 데이터: 없음
- 사용자에게 연결되는 데이터: 없음
- 건강: 앱 기능, 추적 안 함, 사용자 신원에 연결 안 함
- 피트니스: 앱 기능, 추적 안 함, 사용자 신원에 연결 안 함
- 기타 사용자 콘텐츠: AI 코치 질문, 앱 기능, 추적 안 함, 사용자 신원에 연결 안 함
- 정확한 위치: 수집하지 않음. 경로 좌표는 기기 세션에서만 처리

## iMac에서 실행

    git pull
    npm install
    npm run ios:sync
    npm run ios:open

Xcode 26 이상에서:

1. App 타깃 → Signing & Capabilities에서 개발자 Team을 선택합니다.
2. Bundle Identifier가 App Store Connect의 App ID와 일치하는지 확인합니다.
3. HealthKit capability가 보이고 Clinical Health Records가 꺼져 있는지 확인합니다.
4. 실제 iPhone을 연결하고 Debug 빌드에서 읽기, 경로 가져오기, 쓰기를 모두 테스트합니다.
5. Product → Archive → Validate App을 실행합니다.
6. TestFlight에 업로드해 최소 1회 외부 또는 내부 테스트 후 심사를 제출합니다.

앱을 새로 업로드할 때마다 CURRENT_PROJECT_VERSION을 증가시켜야 합니다.
