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

## 📦 5. 배포 빌드 (단독 실행 파일 및 설치본 만들기)

개발 모드가 아닌, Vite 개발 서버 없이 언제든 클릭 한 번으로 실행할 수 있는 독립형 `.exe` 실행 파일이나 설치용 셋업 파일을 만들 때 사용합니다.

### 5.1 단일 포터블 실행 파일(.exe) 빌드 (추천)
설치 마법사(NSIS/MSI) 패키징 과정 없이 가볍고 빠른 단독 실행 파일만 생성하려면 `--no-bundle` 옵션을 사용합니다.

```powershell
# (D:\works\win-client 경로에서 실행)
npm run tauri build -- --no-bundle
```
* **생성 위치:** `src-tauri/target/release/win-client.exe` (또는 `app.exe`)
* 이 파일은 프론트엔드 UI(HTML/CSS/JS)가 바이너리 내부에 완전히 번들링되어 있어 **Vite 개발 서버 없이도 단독 실행**이 가능합니다.
* **작업 표시줄 및 바탕화면 바로가기(단축 아이콘)를 만들 때는 반드시 이 릴리즈 경로의 실행 파일을 등록**해야 합니다.

### 5.2 정식 설치 마법사(Installer) 빌드
```powershell
npm run tauri build
```
* 빌드가 완료되면 `src-tauri/target/release/bundle/nsis` 폴더에 설치 마법사 파일이 생성되며, 이를 통해 PC 시작 시 자동 실행되도록 윈도우에 앱을 정식으로 배포/설치할 수 있습니다.

---

## 🚨 6. 자주 발생하는 오류 및 트러블슈팅

### ❌ 6.1 단축실행 버튼/바로가기 실행 시 "이 페이지에 연결할 수 없습니다 (ERR_CONNECTION_REFUSED)" 오류

![localhost 연결 거부 에러](https://via.placeholder.com/800x400?text=ERR_CONNECTION_REFUSED)

* **증상:** 작업 표시줄 또는 바탕화면 바로가기를 눌러 실행했을 때 화면에 `"이 페이지에 연결할 수 없습니다. localhost 연결을 거부했습니다. ERR_CONNECTION_REFUSED"` 창이 나타남.
* **원인:** 바로가기(단축 아이콘)의 대상 파일이 **디버그 빌드(`src-tauri/target/debug/app.exe`)**로 연결되어 있기 때문입니다.
  * 디버그(Debug) 모드로 컴파일된 바이너리는 실시간 코드 수정(HMR) 반영을 위해 웹뷰가 로컬 개발 서버(`http://localhost:5173`)로 접속하도록 동작합니다.
  * 따라서 터미널에서 Vite 개발 서버(`npm run dev` 또는 `npm run tauri dev`)가 켜져 있지 않은 상태에서 `target/debug/app.exe`를 단독 실행하면 포트가 닫혀 있어 연결 거부 에러가 발생합니다.
* **해결 방법 (2가지 중 선택):**
  1. **해결책 A (독립 실행 - 권장):** 
     * `5.1 단일 포터블 실행 파일 빌드`를 참고하여 `npm run tauri build -- --no-bundle` 명령어로 릴리즈 버전을 빌드합니다.
     * 빌드 완료 후 바로가기(단축 아이콘)의 속성에서 **대상(TargetPath)**을 `D:\works\win-client\src-tauri\target\release\win-client.exe`로 교체합니다.
  2. **해결책 B (개발 모드 구동):**
     * 개발/수정 작업 중이라면 `.exe`를 직접 클릭하지 말고 터미널에서 아래 명령어를 실행하여 Vite 서버와 Tauri 창을 함께 띄웁니다:
       ```powershell
       cd D:\works\win-client
       npm run tauri dev
       ```

### ❌ 6.2 빌드 시 Tauri 패키지 버전 불일치 오류 (`Found version mismatched Tauri packages`)
* **증상:** `npm run tauri build` 실행 시 아래와 같은 오류와 함께 빌드 중단
  ```
  Found version mismatched Tauri packages. Make sure the NPM package and Rust crate versions are on the same major/minor releases:
  tauri (v2.11.1) : @tauri-apps/api (v2.0.0)
  ```
* **원인:** Rust 백엔드의 `tauri` 크레이트 버전(2.11.x)과 NPM 패키지인 `@tauri-apps/api` 버전(2.0.x)의 마이너 버전이 일치하지 않을 때 Tauri CLI가 빌드를 차단합니다.
* **해결 방법:** `package.json`에서 `@tauri-apps/api` 버전을 `^2.11.1`로 상향 지정한 후 `npm install`을 수행합니다.

### ❌ 6.3 빌드 시 `bundle identifier (com.tauri.dev)` 오류
* **증상:** `The default value com.tauri.dev is not allowed as it must be unique across applications.`
* **원인:** 릴리즈 빌드 시 Tauri는 기본 식별자(`com.tauri.dev`) 사용을 금지합니다.
* **해결 방법:** `src-tauri/tauri.conf.json`의 `"identifier"`를 고유한 패키지명(예: `"com.selvas.jira-notifier"`)으로 변경합니다.
