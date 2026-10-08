# RUNNING/03 iOS 출시 인계

## 현재 상태

- GitHub 저장소: `https://github.com/xploride/running-dashboard`
- 기준 브랜치: `master`
- iOS 앱 이름: `RUNNING/03`
- Bundle ID: `com.xploride.running`
- React/Vite 및 Capacitor iOS 프로젝트 생성 완료
- Apple HealthKit 러닝 읽기, 운동 저장, 운동 경로 읽기·쓰기 구현 완료
- HealthKit entitlement, 권한 설명, 개인정보 매니페스트 적용 완료
- iOS 기록 요약은 기기 로컬 저장, GPS 좌표는 세션에만 저장
- Xcode 26.6 / iOS 26.5 SDK의 서명 없는 시뮬레이터 빌드 성공
- Vercel 프로덕션 및 개인정보 처리방침·지원 페이지 배포 완료

## Mac에서 먼저 실행

```bash
git pull origin master
npm install
npm run ios:sync
npm run ios:open
```

## Xcode에서 남은 작업

1. `App` 타깃의 Signing & Capabilities에서 Apple Developer Team을 선택한다.
2. Bundle Identifier가 App Store Connect의 App ID와 일치하는지 확인한다.
3. HealthKit capability와 `App.entitlements`가 적용됐는지 확인한다.
4. 실제 iPhone에서 Apple 건강 권한, Apple Watch 러닝 가져오기, GPX 운동 저장과 경로 저장을 테스트한다.
5. 버전 `1.0.0`, 빌드 `1`을 확인한다.
6. Product > Archive > Validate App을 실행한다.
7. App Store Connect에 업로드하고 TestFlight에서 설치·검증한다.
8. `docs/APP_STORE_RELEASE.md`의 메타데이터와 개인정보 응답을 사용해 심사를 제출한다.

## 작업 원칙

- 기존 구현과 디자인을 되돌리지 않는다.
- 서버나 JSONBin에 GPS 경로 좌표를 저장하지 않는다.
- HealthKit 데이터는 광고, 추적 또는 마케팅에 사용하지 않는다.
- 인증서, 개인키, 프로비저닝 프로파일은 Git에 커밋하지 않는다.
- 수정 전 `git status`와 `git pull origin master`를 확인한다.
- 완료 후 변경 내용을 커밋하고 `git push origin master`를 실행한다.

## Mac Codex 첫 요청

`docs/MAC_HANDOFF.md와 docs/APP_STORE_RELEASE.md를 읽고, 현재 구현을 유지하면서 iOS 서명, 실제 iPhone HealthKit 테스트, Archive와 TestFlight 업로드를 진행해줘.`
