# 🔔 JIRA 백그라운드 알림 클라이언트 (Windows PC 용)

본 프로그램은 Linux 웹앱 서버(Next.js)에서 발생하는 JIRA 이슈 모니터링 이벤트를 Server-Sent Events (SSE) 방식으로 수신하여, **Windows PC 환경에 네이티브 시스템 알림(Toast)**을 띄우는 데스크톱 클라이언트입니다. 

Tauri(웹 기술 + Rust 백엔드)를 사용하여 매우 가볍고 메모리 점유율이 낮은 백그라운드 프로그램으로 구동됩니다.

---

## 💻 1. 시스템 요구사항

### 1.1 필수 설치 항목 (개발 및 구동 환경)
Windows에서 Tauri 네이티브 앱을 빌드하고 실행하려면 아래 개발 도구들이 필수적으로 설치되어 있어야 합니다.

1. **C++ Build Tools**
   - 다운로드: [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/ko/visual-cpp-build-tools/)
   - 설치 시 **"C++를 사용한 데스크톱 개발"** 항목을 반드시 체크하고 설치합니다.
2. **Rust 컴파일러 (Cargo)**
   - 다운로드: [Rust 공식 홈페이지](https://www.rust-lang.org/tools/install)
   - `rustup-init.exe`를 다운로드 받아 실행 후, 숫자 `1` (기본값)을 선택하여 설치합니다.
3. **Node.js (npm)**
   - 다운로드: [Node.js 공식 홈페이지](https://nodejs.org/) (버전 18 이상 권장)

> **⚠️ 중요 (환경 변수 갱신):** Rust와 C++ Build Tools를 설치한 직후에는 **열려있는 모든 터미널(VSCode 등)을 완전히 종료하고 다시 열어야** `cargo` 명령어가 정상적으로 인식됩니다.

---

## 🚨 2. 주의 사항 (네트워크 드라이브 접근 오류)

본 프로젝트는 Rust 코드를 네이티브 바이너리(`.exe`)로 컴파일하는 과정을 거칩니다. Windows 정책상 **Z드라이브 같은 매핑된 네트워크 드라이브(SMB/공유 폴더) 위에서는 권한 문제(`Access is denied`, `ERR_DLOPEN_FAILED`)로 네이티브 라이브러리 실행 및 컴파일(File Lock)이 차단**됩니다.

반드시 이 `win-client` 폴더를 **Windows의 로컬 드라이브(예: `C:\workspace\win-client` 또는 `D:\works\win-client`)로 복사**한 뒤에 아래 설치 과정을 진행해 주세요.

---

## 🚀 3. 설치 및 빌드 방법

로컬 드라이브로 복사한 `win-client` 폴더 경로에서 터미널(PowerShell 또는 CMD)을 열고 아래 명령어를 순서대로 실행합니다.

### 3.1 패키지 초기화 및 설치
```powershell
# (주의) 네트워크 드라이브(Z:)가 아닌 로컬 드라이브(C: 또는 D:) 경로여야 합니다.
cd D:\works\win-client

# 기존 네트워크 드라이브에서 꼬였을 수 있는 npm 캐시 삭제 (에러나면 무시)
rm -r node_modules package-lock.json  

# 의존성 패키지 설치
npm install
```

### 3.2 개발 모드 실행 (테스트용)
```powershell
# 백그라운드에서 Rust 바이너리 컴파일 후 데스크톱 창 띄우기
npm run tauri dev
```
최초 실행 시 C++ 및 Rust 패키지를 다운로드하고 컴파일하므로 1~3분 정도 소요될 수 있습니다. 완료되면 데스크톱 알림 앱 창이 화면에 나타납니다.

---

## 🛠️ 4. 실행 가이드 (알림 테스트 방법)

1. `npm run tauri dev`를 통해 JIRA 알림 데스크톱 앱 창을 띄웁니다.
2. 앱 화면의 주소창에 웹앱 서버의 IP를 올바르게 입력합니다. (기본값: `http://192.168.105.10:3000`)
3. **[서버 연결]** 버튼을 클릭합니다.
4. 화면에 `✅ 서버 연결 완료` 로그가 찍히는지 확인합니다.
5. 리눅스 서버 측의 테스트 API를 호출하여 실제 알림이 Windows 시스템(우측 하단 팝업)에 오는지 확인합니다.
   - 브라우저 등에서 호출: `http://192.168.105.10:3000/api/notifications/test?title=테스트&message=알림테스트`

---

## 📦 5. 배포 빌드 (실행 파일 만들기)

개발 모드가 아닌, 실제 사용할 수 있는 단일 `.exe` 실행 파일 또는 설치용 셋업 파일을 만들고 싶다면 아래 명령어를 실행합니다.

```powershell
npm run tauri build
```
빌드가 완료되면 `src-tauri/target/release/bundle/nsis` 폴더에 설치 마법사 파일이 생성되며, 이를 통해 PC 시작 시 자동 실행되도록 윈도우에 앱을 정식으로 배포/설치할 수 있습니다.
