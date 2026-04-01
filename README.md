# Jira Worklog Analytics Dashboard

사내 Jira Server/Data Center 인스턴스와 연동하여 개인 할당 이슈를 조회하고, 커스텀 JQL(필터)을 로컬에 저장하며, 검색 결과를 Excel 형식으로 내보낼 수 있는 Next.js 15 기반 대시보드 애플리케이션입니다. 

## ✨ 핵심 기능

- **🏠 홈 대시보드**: Jira 연동을 통해 나에게 할당된 진행 중인 최신 이슈를 빠르게 요약하여 보여줍니다.
- **📋 Filter Generation (필터 관리)**: 
  - 복잡한 JQL 쿼리를 입력하여 실시간으로 Jira 이슈를 가져옵니다.
  - 자주 쓰는 JQL을 이름을 붙여 로컬 데이터베이스(SQLite)에 저장하고 클릭 한 번으로 불러올 수 있습니다.
- **📥 엑셀 내보내기**: 화면에 표시된 이슈 데이터(이슈 키, 요약, 상태, 담당자, 생성일/업데이트일 등)를 `.xlsx` 파일로 로컬 PC에 추출합니다.

## 🏗️ 아키텍처 및 스택
- **Framework**: Next.js 15 (App Router, React 19)
- **Design/UX**: Confluence 스타일의 Dark Mode UX 적용
- **데이터베이스**: `better-sqlite3` (로컬 파일 기반 `jira_filters.db`)
- **디자인 패턴**: Controller(API Route), Service(jiraClient), Business Logic(useJiraIssues Custom Hook), View(UI Component)로 서버/클라이언트 로직이 완벽하게 분리된 구조 적용.

---

## 🚀 설치 방법 (필독: 사내망/프록시 환경 에러 대응)

본 프로젝트는 보안이 적용된 사내망 환경(자체 서명된 SSL 인증서 적용 환경)에서 Linux 서버를 타겟으로 동작하도록 구성되었습니다.
패키지를 설치할 때 사내 방화벽이나 프록시가 외부 라이브러리 정보 다운로드를 해킹으로 간주하고 차단(`SELF_SIGNED_CERT_IN_CHAIN` 에러)하는 문제를 반드시 우회해야 합니다.

**리눅스 터미널에서 아래 명령어를 순서대로 실행하세요:**

### 1단계: NPM SSL 검증 무시 설정 (1회성 우회)
C++ 컴파일(node-gyp)이 필요한 `better-sqlite3` 패키지를 다운로드할 때 튕기는 현상과 패키지 메타데이터 오류를 방지합니다.

```bash
# npm 자체의 SSL 인증 무시
npm config set strict-ssl false

# node-gyp 등 Node.js 환경의 전역 SSL 인증 무시 강제
export NODE_TLS_REJECT_UNAUTHORIZED=0

# 필요한 패키지 전체 설치 및 better-sqlite3 수동 설치
npm install
npm install better-sqlite3
```
> **⚠️ 주의:** 윈도우 환경(네트워크 공유 폴더)에서 `npm install better-sqlite3`를 편하게 실행하시면 윈도우용으로 빌드되기 때문에 나중에 리눅스 서버에서 Node 아키텍처 불일치 에러가 발생합니다. **반드시 🚀 실제 서버가 구동되는 리눅스 환경 터미널**에서 설치하셔야 합니다!

### 2단계: 환경 변수 설정
프로젝트 최상단 폴더에 `.env` 파일과 토큰이 잘 있는지 확인합니다.
```env
JIRA_HOST=https://jira.yourcompany.com
JIRA_EMAIL=your_email@yourcompany.com
JIRA_API_TOKEN=발급받은_Personal_Access_Token_문자열
```

---

## 🏃‍♂️ 최종 실행 방법 (사내망 웹소켓 차단 에러 주의)

Next.js의 개발 모드(`npm run dev`)는 코드 자동 반영(HMR)을 위해 **강제로 리눅스 서버와 브라우저 사이에 웹소켓(ws://) 통신 연결을 시도**합니다.
하지만 사내 방화벽이나 VPN이 이 **웹소켓(ws://) 프로토콜을 차단**해 버릴 경우, 브라우저의 React 클라이언트 엔진이 이를 감지하지 못하고 치명적인 충돌(Crash)을 일으킵니다. (결과적으로 화면 껍데기만 렌더링되고 버튼 클릭 등의 자바스크립트는 100% 무시되는 이른바 **'하이드레이션 붕괴'** 현상이 발생합니다.)

이러한 사내망 환경에서 버튼을 정상 작동시키고 애플리케이션을 구동하기 위한 유일하고 완벽한 해법은 **웹소켓 동기화 기능이 완전히 아예 제거되는 "운영(Production) 모드"로 빌드**하여 켜는 것입니다.

### 추천 실행 명령어 (운영 모드)
터미널에서 명령어 2개를 순차적으로 적용합니다.

```bash
# 1. 운영 환경용으로 파일 최적화 및 빌드 (웹소켓 코드 박멸)
npm run build

# 2. 프로덕션 서버 시작 (포트 3000 오픈)
npm start
```

서버가 구동되면 웹 브라우저에서 `http://[리눅스_서버_IP]:3000` 으로 접속하여 이용하시면 됩니다. 이제 화면 새로고침 시 100% 정상 작동하며 필터 기능도 문제없이 돌아갑니다!
