# HTML to Teams Card Converter

HTML 요소를 Microsoft Teams 카드 형태로 변환하여 전송하는 Node.js 스크립트입니다.

## 기능

- HTML 메시지 요소를 Teams MessageCard로 변환
- 사용자 이름, 시간, 메시지 내용, 첨부 파일, 반응 정보 추출
- Teams webhook을 통한 자동 전송
- HTML 파일에서 여러 메시지 일괄 처리

## 설치

```bash
cd node_src
npm install
```

## 사용법

### 1. HTML 파일에서 메시지들 전송

```bash
node htmlToTeamsCard.js <HTML_파일_경로>
```

**예시:**

```bash
# 상대 경로
node htmlToTeamsCard.js ./slack-data/example.html

# 절대 경로
node htmlToTeamsCard.js /Users/username/slack-data/example.html
```

### 2. 예시 HTML 요소 전송 (테스트용)

```bash
node htmlToTeamsCard.js --example
```

### 3. 도움말 보기

```bash
node htmlToTeamsCard.js
```

## 지원하는 HTML 구조

다음과 같은 HTML 구조를 지원합니다:

```html
<div class="message-container">
  <div id="2023-06-20 19:32:54">
    <div class="message">
      <img src="user_icon.jpg" class="user_icon" />
      <div class="username">사용자명</div>
      <div class="time">2023-06-20 19:32:54</div>
      <div class="msg">
        <p>메시지 내용</p>
        <div class="message-upload">
          <div class="link-title">
            <a href="file.pdf">파일명.pdf</a>
          </div>
        </div>
      </div>
      <div class="message-reaction">👍 반응</div>
    </div>
  </div>
</div>
```

## 추출되는 정보

- **사용자 이름**: `<div class="username">` 태그 내용
- **시간**: `<div class="time">` 태그 내용
- **메시지 내용**: `<div class="msg"><p>` 태그 내용
- **첨부 파일**: `<div class="link-title"><a>` 태그의 파일명
- **반응**: `<div class="message-reaction">` 태그 내용

## Teams 카드 형태

변환된 Teams 카드는 다음과 같은 형태로 표시됩니다:

```
┌─────────────────────────────────────┐
│ 👤 김기용 (2023-06-20 19:32:54)     │
│                                     │
│ 사전기술검토 신청을 완료하였습니다.   │
│ 프로젝트명: 3호기_아쿠아피시 소안1호  │
│                                     │
│ 📎 파일 1: 사전 기술검토 신청서.pdf  │
│ 📎 파일 2: 공사 계획서.pdf          │
│ 📎 파일 3: 전기설비 종류에 따른...  │
│ ...                                 │
│ 👍 반응: 👍 강형구                   │
└─────────────────────────────────────┘
```

## 환경 설정

Teams webhook URL은 스크립트 내부에 하드코딩되어 있습니다.
필요한 경우 `htmlToTeamsCard.js` 파일에서 `webhookUrl` 변수를 수정하세요.

## 주의사항

- API 제한을 방지하기 위해 메시지 간 2초의 대기 시간이 있습니다
- HTML 파일이 UTF-8 인코딩으로 저장되어 있어야 합니다
- Teams webhook URL이 유효해야 합니다

## 오류 처리

- 파일을 찾을 수 없는 경우: 파일 경로를 확인하세요
- 네트워크 오류: 인터넷 연결과 webhook URL을 확인하세요
- HTML 파싱 오류: HTML 구조가 지원되는 형태인지 확인하세요
