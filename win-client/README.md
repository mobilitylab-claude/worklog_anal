# 🚀 Jira Worklog Studio (Windows 데스크톱 클라이언트)

Tauri v2(Rust + Webview) 기반으로 개발된 **Windows 전용 Jira 업무 대시보드 & 실시간 모니터링 하이브리드 데스크톱 애플리케이션**입니다.

웹 브라우저 없이 독립된 창과 시스템 트레이에서 지라 업무 대시보드, 팀원별 당일 작업시간 모니터링, 실시간 이상 기록 알림을 효율적으로 사용할 수 있습니다.

---

## ✨ 주요 기능

1. **📊 업무 대시보드 통합**:
   - 웹 브라우저를 열지 않고도 앱 내부에서 홈 대시보드, 프로젝트 모니터링, 월간 리포트, 팀원 관리 등을 즉시 전환하며 사용.
   - 상단 바로가기 툴바를 통해 원하는 분석 화면으로 원클릭 이동.
2. **🔔 실시간 모니터링 & 도넛 차트**:
   - 팀원별 당일 누적 작업시간을 시각화(8시간 기준 달성률 도넛 차트).
   - Server-Sent Events(SSE) 스트림 기반 실시간 워크로그 등록 및 비정상 입력(프로젝트 오기재, 초과 근무 등) 알림 수신.
   - **수동 갱신 기능**: 팀원 카드 클릭 시 즉시 최신 데이터 반영, 상단 [전체 갱신] 버튼으로 일괄 최신화.
3. **🛡️ 단일 인스턴스 (중복 실행 방지)**:
   - 앱이 이미 실행 중인 상태에서 바로가기나 실행 파일을 다시 클릭하면 새 창이 중복 생성되지 않고 기존 창이 자동으로 최상위로 활성화(Focus)됩니다.
4. **📌 시스템 트레이 및 컨텍스트 메뉴**:
   - 창 닫기(X) 버튼 클릭 시 프로그램이 꺼지지 않고 윈도우 작업표시줄 우측 하단 트레이로 안전하게 숨겨집니다.
   - **트레이 아이콘 우클릭 메뉴**:
     - `창 열기`: 숨겨진 창을 다시 화면에 표시하고 맨 앞으로 가져옵니다.
     - `창 숨기기`: 작업 중인 화면을 트레이로 최소화합니다.
     - `종료`: 프로그램을 완전히 종료합니다.
5. **📥 네이티브 엑셀 다운로드 브릿지**:
   - 웹앱(iframe) 내에서 엑셀 내보내기 시, 브라우저 다운로드 팝업 대신 Tauri 네이티브 I/O를 통해 로컬 PC의 `Downloads` 폴더에 즉시 저장하고 토스트 알림을 제공합니다.
6. **📋 OS 레벨 클립보드 복사 브릿지**:
   - iframe의 권한 제약(Permissions Policy)을 극복하기 위해 Windows 내장 무창(`CREATE_NO_WINDOW`) `clip.exe` 유틸리티를 호출하는 Rust 커맨드를 탑재하여 사용자 비밀번호 등의 텍스트를 100% 안전하게 복사합니다.
7. **🔒 항상 위 고정(Always-on-Top)**:
   - 업무 중 언제든 참고할 수 있도록 창 상단 헤더의 📌 버튼으로 화면 항상 고정을 토글할 수 있습니다.
8. **🌐 안전한 서버 통신 및 터널링 지원**:
   - 사내망 리눅스 서버 직접 접속(`http://192.168.105.x:3000`) 또는 SSH 포트 포워딩(`start-tunnel.bat`, `start-tunnel.ps1`)을 통한 보안 접속 지원.

---

## 💻 시스템 요구사항

Windows에서 Tauri 네이티브 앱을 빌드하고 실행하려면 아래 개발 환경이 설치되어 있어야 합니다:

1. **Visual Studio C++ Build Tools**: "C++를 사용한 데스크톱 개발" 설치 필수
2. **Rust 컴파일러 (Cargo)**: [rust-lang.org](https://www.rust-lang.org/) (최신 stable)
3. **Node.js**: v18 이상 권장

---

## 🚨 주의사항 (네트워크 드라이브 빌드 금지)

Windows 정책상 **네트워크 매핑 드라이브(Z:\ 등)에서는 파일 락 및 권한 문제(`Access is denied`, `os error 5`)로 Rust 네이티브 컴파일이 차단**됩니다.

따라서 소스 파일 수정 후 반드시 **로컬 드라이브(예: `D:\works\win-client`)로 동기화**한 뒤 로컬 경로에서 빌드를 진행해야 합니다.

### 🔄 로컬 드라이브 동기화 명령어 (PowerShell/CMD)
```powershell
robocopy Z:\workspace\worklog_anal\win-client D:\works\win-client /mir /xd node_modules target src-tauri\target .next
```

---

## 📦 배포 빌드 및 실행 가이드

### 방법 1. 단독 실행형 포터블 바이너리 빌드 (추천)
설치 마법사 없이 독립 실행형 `.exe` 파일 하나만 빠르게 생성합니다.

1. **로컬 폴더로 이동**:
   ```powershell
   cd D:\works\win-client
   ```
2. **배포용 빌드 실행**:
   ```powershell
   npm run tauri:build
   ```
   *(내부적으로 `tauri build --no-bundle` 실행)*
3. **생성 파일 위치**:
   - **경로**: `D:\works\win-client\src-tauri\target\release\app.exe`
4. **바탕화면 바로가기 아이콘 생성**:
   - `app.exe` 파일 마우스 우클릭 → **[보내기]** → **[바탕 화면에 바로 가기 만들기]**
   - 이제 바탕화면 아이콘 더블클릭으로 언제든 독립 실행 가능합니다.

---

### 방법 2. Windows 설치 프로그램(인스톨러) 빌드
바탕화면 및 시작 메뉴에 아이콘이 자동 등록되는 설치 마법사(`Setup.exe`)를 생성합니다.

```powershell
cd D:\works\win-client
npx tauri build
```
* **생성 위치**: `src-tauri/target/release/bundle/nsis/win-client_0.1.0_x64-setup.exe`

---

## 🛠️ 트러블슈팅

### ❌ 1. 빌드 시 "액세스가 거부되었습니다. (os error 5)" 에러
* **원인**: 이전 버전의 `app.exe`가 실행 중이거나 백그라운드 프로세스로 남아 있어 파일 덮어쓰기가 차단된 경우입니다.
* **해결 방법**:
  PowerShell에서 실행 중인 프로세스를 종료한 뒤 빌드를 재시도합니다:
  ```powershell
  Stop-Process -Name "app" -Force -ErrorAction SilentlyContinue
  npm run tauri:build
  ```

### ❌ 2. 바로가기 실행 시 "ERR_CONNECTION_REFUSED" 오류
* **원인**: 디버그 모드 바이너리(`target/debug/app.exe`)로 바로가기가 생성된 경우, Vite 개발 서버가 켜져 있지 않으면 화면이 뜨지 않습니다.
* **해결 방법**: 반드시 **릴리즈 빌드 바이너리(`target/release/app.exe`)**를 대상으로 바로가기를 생성하세요.

### ❌ 3. 클립보드 복사가 되지 않을 때
* 앱 최신 버전(`app.exe`)에는 Windows OS 레벨의 무창 `clip.exe` 브릿지가 적용되어 있어 별도의 권한 허용 없이도 복사가 즉시 작동합니다. 이전 빌드를 사용 중이시라면 최신 릴리즈 빌드로 업데이트해 주세요.
