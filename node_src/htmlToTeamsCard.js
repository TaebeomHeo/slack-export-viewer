import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { JSDOM } from 'jsdom';

// 환경변수 로드
dotenv.config();

// webhook URL을 환경변수에서 가져오기
const webhookUrl = process.env.WEB_HOOK_URL;

if (!webhookUrl) {
  console.error('❌ WEB_HOOK_URL 환경변수가 설정되지 않았습니다.');
  console.log('📝 .env 파일에 WEB_HOOK_URL을 설정해주세요.');
  process.exit(1);
}

// const webhookUrl = 'https://agenergycorp.webhook.office.com/webhookb2/ae672a30-2857-4d85-aa75-79da4d4e6a98@a9c060ff-95d2-49d0-b593-1408e5e1ae63/IncomingWebhook/de07b1cf78ed498ca5cf16de7e58477b/7d569f06-60b1-45bf-af21-bd10c6484a06/V2tmf626vLnXs_C6HlIuoKDIbUS0Qj8fCaX10EwqBUDGw1';

// Teams Rate Limit 관리 클래스 (보수적 설정)
class TeamsRateLimiter {
  constructor() {
    this.requestTimes = [];
    this.rateLimits = [
      { window: 1, maxRequests: 1 },      // 1초에 1회 (보수적)
      { window: 30, maxRequests: 15 },    // 30초에 15회 (보수적)
      { window: 3600, maxRequests: 25 },  // 1시간에 25회 (보수적)
      { window: 7200, maxRequests: 37 },  // 2시간에 37회 (보수적)
      { window: 86400, maxRequests: 450 } // 24시간에 450회 (보수적)
    ];
  }

  // 현재 시간 기준으로 요청 기록 추가
  addRequest() {
    const now = Date.now();
    this.requestTimes.push(now);

    // 오래된 요청 기록 정리 (24시간 이전 데이터 삭제)
    const oneDayAgo = now - 86400 * 1000;
    this.requestTimes = this.requestTimes.filter(time => time > oneDayAgo);
  }

  // 각 시간 윈도우별로 요청 수 확인
  checkRateLimits() {
    const now = Date.now();
    const violations = [];

    for (const limit of this.rateLimits) {
      const windowStart = now - limit.window * 1000;
      const requestsInWindow = this.requestTimes.filter(time => time > windowStart).length;

      if (requestsInWindow >= limit.maxRequests) {
        violations.push({
          window: limit.window,
          maxRequests: limit.maxRequests,
          currentRequests: requestsInWindow,
          waitTime: this.calculateWaitTime(windowStart, limit)
        });
      }
    }

    return violations;
  }

  // 대기 시간 계산
  calculateWaitTime(windowStart, limit) {
    const requestsInWindow = this.requestTimes.filter(time => time > windowStart);
    if (requestsInWindow.length === 0) return 0;

    // 윈도우가 끝나는 시간까지 대기
    const windowEnd = windowStart + limit.window * 1000;
    const waitTime = Math.max(0, windowEnd - Date.now());

    return waitTime;
  }

  // 다음 요청까지 대기해야 할 시간 계산
  getWaitTime() {
    const violations = this.checkRateLimits();
    if (violations.length === 0) return 0;

    // 가장 긴 대기 시간 반환
    return Math.max(...violations.map(v => v.waitTime));
  }

  // 현재 상태 로그
  logStatus() {
    const now = Date.now();
    console.log('📊 Rate Limit 상태:');

    for (const limit of this.rateLimits) {
      const windowStart = now - limit.window * 1000;
      const requestsInWindow = this.requestTimes.filter(time => time > windowStart).length;
      const percentage = (requestsInWindow / limit.maxRequests * 100).toFixed(1);

      console.log(`  ${limit.window}초 윈도우: ${requestsInWindow}/${limit.maxRequests} (${percentage}%)`);
    }
  }
}

// 전송된 메시지 추적 클래스
class MessageTracker {
  constructor() {
    this.sentMessages = new Set();
    this.trackerFile = 'sent_messages.json';
  }

  // 전송된 메시지 로드
  async loadSentMessages() {
    try {
      const data = await fs.readFile(this.trackerFile, 'utf-8');
      const messages = JSON.parse(data);
      this.sentMessages = new Set(messages);
      console.log(`📋 ${this.sentMessages.size}개의 이전 전송 기록을 로드했습니다.`);
    } catch (error) {
      console.log('📋 이전 전송 기록이 없습니다. 처음부터 시작합니다.');
    }
  }

  // 전송된 메시지 저장
  async saveSentMessages() {
    try {
      const messages = Array.from(this.sentMessages);
      await fs.writeFile(this.trackerFile, JSON.stringify(messages, null, 2), 'utf-8');
      console.log(`💾 ${messages.length}개의 전송 기록을 저장했습니다.`);
    } catch (error) {
      console.error('❌ 전송 기록 저장 실패:', error.message);
    }
  }

  // 메시지 ID로 이미 전송되었는지 확인
  isMessageSent(messageId) {
    return this.sentMessages.has(messageId);
  }

  // 메시지 ID를 전송됨으로 표시
  markMessageAsSent(messageId) {
    this.sentMessages.add(messageId);
  }

  // 전송된 메시지 수 반환
  getSentCount() {
    return this.sentMessages.size;
  }

  // 모든 기록 삭제 (옵션용)
  clearAll() {
    this.sentMessages.clear();
    console.log('🗑️ 모든 전송 기록을 삭제했습니다.');
  }
}

// 전역 인스턴스들
const rateLimiter = new TeamsRateLimiter();
const messageTracker = new MessageTracker();

// 종료 핸들러 함수
const gracefulShutdown = async (signal) => {
  console.log(`\n🛑 ${signal} 신호를 받았습니다. 안전하게 종료 중...`);

  try {
    // 전송 기록 저장
    await messageTracker.saveSentMessages();
    console.log('💾 전송 기록이 저장되었습니다.');

    console.log('👋 프로그램을 종료합니다.');
    process.exit(0);
  } catch (error) {
    console.error('❌ 종료 중 오류 발생:', error.message);
    process.exit(1);
  }
};

// 시그널 핸들러 등록
process.on('SIGINT', () => gracefulShutdown('SIGINT (Ctrl+C)'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// 예상치 못한 오류 처리
process.on('uncaughtException', async (error) => {
  console.error('❌ 예상치 못한 오류 발생:', error);
  await gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('❌ 처리되지 않은 Promise 거부:', reason);
  await gracefulShutdown('unhandledRejection');
});

// HTML 요소를 Teams 카드로 변환하는 함수
const convertHtmlToTeamsCard = (htmlElement) => {
  // DOM 파싱
  const dom = new JSDOM(htmlElement);
  const document = dom.window.document;

  const extractInfo = () => {
    // 메시지 ID 추출 (timestamp)
    const messageContainer = document.querySelector('.message-container');
    const messageId = messageContainer ? messageContainer.id || messageContainer.querySelector('[id]')?.id : null;

    // 사용자 이름 추출
    const usernameElement = document.querySelector('.username');
    const username = usernameElement ? usernameElement.textContent.trim() : 'Unknown User';

    // 시간 추출
    const timeElement = document.querySelector('.time');
    const time = timeElement ? timeElement.textContent.trim() : '';

    // 메시지 내용 추출
    const msgElement = document.querySelector('.msg p');
    const message = msgElement ? msgElement.innerHTML.replace(/<br>/g, '\n').trim() : '';

    // 파일 첨부 추출
    const fileElements = document.querySelectorAll('.link-title a');
    const files = Array.from(fileElements).map(a => a.textContent.trim());

    // 반응 추출
    const reactionElement = document.querySelector('.message-reaction');
    const reaction = reactionElement ? reactionElement.textContent.trim() : '';

    // reply 메시지 확인
    const isReply = document.querySelector('.message-container').classList.contains('reply') ||
      document.querySelector('.reply') !== null;

    return { messageId, username, time, message, files, reaction, isReply };
  };

  const info = extractInfo();

  // Teams 카드 생성
  const card = {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    "themeColor": "0076D7",
    "summary": `${info.username}의 메시지`,
    "sections": [
      {
        "activityTitle": `${info.isReply ? '↳ ' : ''}**${info.username}** (${info.time})`,
        "activitySubtitle": info.isReply ? `    ${info.message}` : info.message,
        "activityImage": "https://img.icons8.com/color/48/000000/user.png"
      }
    ]
  };

  // 파일 첨부가 있는 경우
  if (info.files.length > 0) {
    const facts = info.files.map((file, index) => ({
      "name": `📎 파일 ${index + 1}`,
      "value": info.isReply ? `    ${file}` : file
    }));

    card.sections[0].facts = facts;
  }

  // 반응이 있는 경우
  if (info.reaction) {
    if (!card.sections[0].facts) {
      card.sections[0].facts = [];
    }
    card.sections[0].facts.push({
      "name": "👍 반응",
      "value": info.isReply ? `    ${info.reaction}` : info.reaction
    });
  }

  return { card, messageId: info.messageId };
};

// Teams에 카드 전송 (재시도 로직 포함)
const sendCardToTeams = async (card, retryCount = 0) => {
  const maxRetries = 3;
  const baseDelay = 2000; // 2초

  try {
    // Rate limit 체크 및 대기
    const waitTime = rateLimiter.getWaitTime();
    if (waitTime > 0) {
      console.log(`⏳ Rate limit 대기: ${(waitTime / 1000).toFixed(1)}초`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    console.log(`📤 요청 전송 중... (재시도: ${retryCount}/${maxRetries})`);

    const response = await axios.post(webhookUrl, card, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10초 타임아웃
    });

    // 성공한 요청 기록
    rateLimiter.addRequest();

    console.log(`📊 응답 상태: ${response.status}`);
    // console.log(`📊 응답 헤더:`, response.headers);
    console.log(`📊 응답 데이터:`, response.data);
    console.log(`📊 응답 데이터 타입:`, typeof response.data);

    // 응답 데이터에서 429 에러 확인 (안전한 타입 체크)
    const isRateLimitInResponse = response.data &&
      typeof response.data === 'string' &&
      response.data.includes('HTTP error 429');

    if (response.status === 200 && !isRateLimitInResponse) {
      console.log('✅ Teams 카드 전송 성공!');
      return { success: true, status: response.status };
    } else if (isRateLimitInResponse) {
      console.error(`❌ Teams API에서 429 에러 발생`);
      return { success: false, status: 429, error: 'Rate limit exceeded' };
    } else {
      console.error(`❌ Teams 카드 전송 실패: ${response.status}`);
      return { success: false, status: response.status, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    console.error(`❌ 요청 실패 상세 정보:`);
    console.error(`  - 에러 메시지: ${error.message}`);
    console.error(`  - 에러 코드: ${error.code}`);

    if (error.response) {
      console.error(`  - 응답 상태: ${error.response.status}`);
      // console.error(`  - 응답 헤더:`, error.response.headers);
      console.error(`  - 응답 데이터:`, error.response.data);
    } else if (error.request) {
      console.error(`  - 요청은 전송되었지만 응답이 없음`);
    }

    const isRateLimit = error.response && (error.response.status === 429 || error.response.status === 503);
    const isTimeout = error.code === 'ECONNABORTED';

    if (isRateLimit) {
      console.warn(`⚠️ 요청 제한 도달 (${error.response.status}). 재시도 중...`);
    } else if (isTimeout) {
      console.warn('⚠️ 요청 타임아웃. 재시도 중...');
    } else {
      console.error(`❌ Teams 카드 전송 오류: ${error.message}`);
    }

    // 재시도 로직
    if (retryCount < maxRetries && (isRateLimit || isTimeout)) {
      let delay;
      if (isRateLimit) {
        // 429 에러의 경우 1초부터 시작하는 지수 백오프 (1초, 2초, 4초)
        delay = 1000 * Math.pow(2, retryCount);
      } else {
        // 타임아웃의 경우 기존 로직
        delay = baseDelay * Math.pow(2, retryCount);
      }
      console.log(`⏳ ${delay / 1000}초 후 재시도... (${retryCount + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return await sendCardToTeams(card, retryCount + 1);
    }

    return {
      success: false,
      status: error.response?.status || 'NETWORK_ERROR',
      error: error.message
    };
  }
};

// 실패한 메시지들을 재전송하는 함수
const retryFailedMessages = async (failedMessages, originalFilePath) => {
  if (failedMessages.length === 0) return null;

  console.log(`\n🔄 ${failedMessages.length}개의 실패한 메시지를 재전송합니다...`);

  // 원본 HTML 파일에서 메시지들을 다시 읽어옴
  const htmlContent = await fs.readFile(originalFilePath, 'utf-8');
  const dom = new JSDOM(htmlContent);
  const document = dom.window.document;
  const messageContainers = document.querySelectorAll('.message-container');

  let retrySuccessCount = 0;
  let retryFailureCount = 0;

  for (const failedMsg of failedMessages) {
    const containerIndex = failedMsg.index - 1; // 0-based index
    if (containerIndex >= messageContainers.length) {
      console.log(`⚠️ 메시지 ${failedMsg.index}를 찾을 수 없습니다.`);
      retryFailureCount++;
      continue;
    }

    const container = messageContainers[containerIndex];
    const { card, messageId } = convertHtmlToTeamsCard(container.outerHTML);

    console.log(`\n🔄 메시지 ${failedMsg.index} 재전송 중...`);
    if (messageId) {
      console.log(`🆔 메시지 ID: ${messageId}`);
    }
    console.log(`📊 현재 전송된 메시지: ${messageTracker.getSentCount()}개`);

    const result = await sendCardToTeams(card);

    if (result.success) {
      console.log(`✅ 메시지 ${failedMsg.index} 재전송 성공`);
      retrySuccessCount++;

      // 성공한 메시지 ID 기록
      if (messageId) {
        messageTracker.markMessageAsSent(messageId);
      }
    } else {
      console.log(`❌ 메시지 ${failedMsg.index} 재전송 실패: ${result.error}`);

      // 429 에러 발생 시 즉시 종료
      if (result.status === 429) {
        console.log(`\n⚠️ Teams API Rate Limit에 도달했습니다.`);
        console.log(`📊 현재 전송된 메시지: ${messageTracker.getSentCount()}개`);
        console.log('🔄 잠시 후 다시 시작하거나 webhook을 교체해주세요.');

        // 전송 기록 저장
        await messageTracker.saveSentMessages();

        console.log('👋 프로그램을 종료합니다.');
        process.exit(0);
      }

      retryFailureCount++;
    }

    // 주기적으로 전송 기록 저장
    if ((retrySuccessCount + retryFailureCount) % 10 === 0) {
      await messageTracker.saveSentMessages();
    }
  }

  // 최종 전송 기록 저장
  await messageTracker.saveSentMessages();

  console.log(`\n📊 재전송 결과: 성공 ${retrySuccessCount}개, 실패 ${retryFailureCount}개`);

  return { retrySuccessCount, retryFailureCount };
};

// HTML 파일에서 메시지들을 읽어와서 Teams에 전송
const processHtmlFile = async (filePath, options = {}) => {
  try {
    console.log('📄 HTML 파일 읽는 중...');
    const htmlContent = await fs.readFile(filePath, 'utf-8');

    // DOM 파싱
    const dom = new JSDOM(htmlContent);
    const document = dom.window.document;

    // CSS 선택자로 message-container 찾기
    const messageContainers = document.querySelectorAll('.message-container');

    if (messageContainers.length === 0) {
      console.log('❌ 메시지 컨테이너를 찾을 수 없습니다.');
      return;
    }

    console.log(`📨 총 ${messageContainers.length}개의 메시지를 발견했습니다.`);

    // 전송 기록 로드 (--force 옵션이 없을 때만)
    if (!options.force) {
      await messageTracker.loadSentMessages();
    } else {
      console.log('🔄 --force 옵션: 모든 메시지를 처음부터 전송합니다.');
      messageTracker.clearAll();
    }

    // 통계 추적
    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;
    const failedMessages = [];
    const statusInterval = 50; // 50개 메시지마다 상태 표시

    // 각 메시지를 순차적으로 전송
    for (let i = 0; i < messageContainers.length; i++) {
      const container = messageContainers[i];
      const isReply = container.classList.contains('reply') || container.querySelector('.reply') !== null;

      // 메시지 정보 추출
      const { card, messageId } = convertHtmlToTeamsCard(container.outerHTML);

      // 중복 체크 (--force 옵션이 없을 때만)
      if (!options.force && messageId && messageTracker.isMessageSent(messageId)) {
        console.log(`⏭️ 메시지 ${i + 1}/${messageContainers.length} ${isReply ? '(답글)' : ''} 건너뜀 (이미 전송됨): ${messageId}`);
        skippedCount++;
        continue;
      }

      console.log(`\n📤 메시지 ${i + 1}/${messageContainers.length} ${isReply ? '(답글)' : ''} 전송 중...`);
      if (messageId) {
        console.log(`🆔 메시지 ID: ${messageId}`);
      }
      console.log(`📊 현재 전송된 메시지: ${messageTracker.getSentCount()}개`);

      const result = await sendCardToTeams(card);

      if (result.success) {
        console.log(`✅ 메시지 ${i + 1} 전송 완료`);
        successCount++;

        // 성공한 메시지 ID 기록
        if (messageId) {
          messageTracker.markMessageAsSent(messageId);
        }

        // 주기적으로 전송 기록 저장
        if (successCount % 10 === 0) {
          await messageTracker.saveSentMessages();
        }
      } else {
        console.log(`❌ 메시지 ${i + 1} 전송 실패: ${result.error}`);

        // 429 에러 발생 시 즉시 종료
        if (result.status === 429) {
          console.log(`\n⚠️ Teams API Rate Limit에 도달했습니다.`);
          console.log(`📊 현재 전송된 메시지: ${messageTracker.getSentCount()}개`);
          console.log('🔄 잠시 후 다시 시작하거나 webhook을 교체해주세요.');

          // 최종 전송 기록 저장
          await messageTracker.saveSentMessages();

          console.log('👋 프로그램을 종료합니다.');
          process.exit(0);
        }

        failureCount++;
        failedMessages.push({
          index: i + 1,
          messageId: messageId,
          username: card.sections[0].activityTitle,
          error: result.error,
          status: result.status
        });
      }

      // 주기적으로 rate limit 상태 표시
      if ((i + 1) % statusInterval === 0) {
        rateLimiter.logStatus();
        console.log(`📊 진행 상황: 성공 ${successCount}, 실패 ${failureCount}, 건너뜀 ${skippedCount}`);
      }
    }

    // 최종 전송 기록 저장
    await messageTracker.saveSentMessages();

    // 최종 결과 출력
    console.log('\n📊 전송 결과 요약:');
    console.log(`✅ 성공: ${successCount}개`);
    console.log(`❌ 실패: ${failureCount}개`);
    console.log(`⏭️ 건너뜀: ${skippedCount}개`);
    console.log(`📈 성공률: ${((successCount / (successCount + failureCount)) * 100).toFixed(1)}%`);

    if (failedMessages.length > 0) {
      console.log('\n❌ 실패한 메시지 목록:');
      failedMessages.forEach(msg => {
        console.log(`  - 메시지 ${msg.index}: ${msg.username} (${msg.error})`);
      });

      // 실패한 메시지들을 별도 파일로 저장
      const failedLogPath = `failed_messages_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      await fs.writeFile(failedLogPath, JSON.stringify(failedMessages, null, 2), 'utf-8');
      console.log(`\n📄 실패한 메시지 목록이 ${failedLogPath}에 저장되었습니다.`);

      // 재전송 시도
      const retryResult = await retryFailedMessages(failedMessages, filePath);
      if (retryResult) {
        console.log(`\n🎯 최종 결과: 총 성공 ${successCount + retryResult.retrySuccessCount}개, 총 실패 ${retryResult.retryFailureCount}개`);
      }
    }

    if (successCount > 0) {
      console.log('\n🎉 메시지 전송 완료!');
    } else {
      console.log('\n⚠️ 모든 메시지 전송이 실패했습니다.');
    }

  } catch (error) {
    console.error('❌ 파일 처리 오류:', error.message);
  }
};

// HTML 요소를 Teams에 전송하는 함수
const sendHtmlElement = async (htmlElement) => {
  try {
    console.log('🔄 HTML 요소를 Teams 카드로 변환 중...');

    // HTML을 Teams 카드로 변환
    const { card, messageId } = convertHtmlToTeamsCard(htmlElement);

    if (messageId) {
      console.log(`🆔 메시지 ID: ${messageId}`);
    }

    console.log(`📊 현재 전송된 메시지: ${messageTracker.getSentCount()}개`);
    console.log('📤 Teams에 전송 중...');

    // Teams에 전송
    const result = await sendCardToTeams(card);

    if (result.success) {
      console.log('✅ HTML 요소 전송 완료!');

      // 성공한 메시지 ID 기록
      if (messageId) {
        messageTracker.markMessageAsSent(messageId);
        await messageTracker.saveSentMessages();
      }
    } else {
      console.log(`❌ HTML 요소 전송 실패: ${result.error}`);

      // 429 에러 발생 시 즉시 종료
      if (result.status === 429) {
        console.log(`\n⚠️ Teams API Rate Limit에 도달했습니다.`);
        console.log(`📊 현재 전송된 메시지: ${messageTracker.getSentCount()}개`);
        console.log('🔄 잠시 후 다시 시작하거나 webhook을 교체해주세요.');

        // 전송 기록 저장
        await messageTracker.saveSentMessages();

        console.log('👋 프로그램을 종료합니다.');
        process.exit(0);
      }
    }

    return result;

  } catch (error) {
    console.error('❌ HTML 요소 처리 오류:', error.message);
    return { success: false, error: error.message };
  }
};

// 사용 예시
const main = async () => {
  // CLI 인자 확인
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('📝 사용법: node htmlToTeamsCard.js <HTML_파일_경로> [옵션]');
    console.log('예시: node htmlToTeamsCard.js ./slack-data/example.html');
    console.log('\n옵션:');
    console.log('  --force    : 모든 메시지를 처음부터 전송 (중복 체크 무시)');
    console.log('  --example  : 예시 HTML 요소 전송');
    console.log('\n또는 직접 HTML 요소를 전송하려면:');
    console.log('node htmlToTeamsCard.js --example');
    return;
  }

  const filePath = args[0];

  // 예시 모드인 경우
  if (filePath === '--example') {
    console.log('🔄 예시 HTML 요소를 Teams에 전송합니다...');

    // 예시 HTML 요소 (사용자가 제공한 것)
    const exampleHtml = `<div class="message-container">
  <div id="2023-06-20 19:32:54">
     
      <div class="message">
           
          <img src="../../external_resources/87919904cd2255dc72a9715968481d42_407910c4.jpg" class="user_icon" loading="lazy">
            
          <div class="username">
            김기용 
            <span class="print-only user-email">(gykim@knotz.co.kr)</span>
          </div>
          <a href="#2023-06-20 19:32:54"><div class="time">2023-06-20 19:32:54</div></a>
          <div class="msg">
            <p>사전기술검토 신청을 완료하였습니다.<br><br>프로젝트명: 3호기_아쿠아피시 소안1호(현진수산)<br>제출처: 전기안전공사 전력설비검사처</p>  <div class="message-upload">
              
              <div class="link-title">
                <a href="../../external_resources/0_____________________________________1____________d5bb0e0e.pdf">0. 사전 기술검토 신청서_소안1호(현진수산).pdf</a>
              </div>
                 
<a href="../../external_resources/0_____________________________________1____________d5bb0e0e.pdf">
  <img class="preview" src="../../external_resources/0_____________________________________1____________16fc9907.png" loading="lazy" width="909" height="1286">
</a>
 
            </div>
            <div class="message-upload">
              
              <div class="link-title">
                <a href="../../external_resources/1________________________1__________________2e87c854.pdf">1. 공사 계획서_소안1호(현진수산).pdf</a>
              </div>
                 
<a href="../../external_resources/1________________________1__________________2e87c854.pdf">
  <img class="preview" src="../../external_resources/1________________________1__________________thumb__bd82d48b.png" loading="lazy" width="909" height="1285">
</a>
 
            </div>
            <div class="message-upload">
              
              <div class="link-title">
                <a href="../../external_resources/2_____________________________________8_______2____2646acf3.pdf">2. 전기설비 종류에 따른 별표8의 제2호_소안1호(현진수산).pdf</a>
              </div>
                 
<a href="../../external_resources/2_____________________________________8_______2____2646acf3.pdf">
  <img class="preview" src="../../external_resources/2_____________________________________8_______2____ff5d2c2a.png" loading="lazy" width="909" height="1285">
</a>
 
            </div>
            <div class="message-upload">
              
              <div class="link-title">
                <a href="../../external_resources/3_______________________1__________________e067a732.pdf">3. 공사공정표_소안1호(현진수산).pdf</a>
              </div>
                 
<a href="../../external_resources/3_______________________1__________________e067a732.pdf">
  <img class="preview" src="../../external_resources/3_______________________1__________________thumb_p_9f287c5b.png" loading="lazy" width="1286" height="909">
</a>
 
            </div>
            <div class="message-upload">
              
              <div class="link-title">
                <a href="../../external_resources/4_______________________1__________________f1ef52de.pdf">4. 기술시방서_소안1호(현진수산).pdf</a>
              </div>
                 
<a href="../../external_resources/4_______________________1__________________f1ef52de.pdf">
  <img class="preview" src="../../external_resources/4_______________________1__________________thumb_p_71b7483f.png" loading="lazy" width="909" height="1285">
</a>
 
            </div>
            <div class="message-upload">
              
              <div class="link-title">
                <a href="../../external_resources/5________________________________1_________________e74c65d6.pdf">5. 감리원배치확인서_소안1호(현진수산).pdf</a>
              </div>
                 
<a href="../../external_resources/5________________________________1_________________e74c65d6.pdf">
  <img class="preview" src="../../external_resources/5________________________________1_________________f993cb84.png" loading="lazy" width="909" height="1286">
</a>
 
            </div>
            <div class="message-upload">
              
              <div class="link-title">
                <a href="../../external_resources/7___________________________________________1______11d05951.pdf">7. 공사계획 기술규격서_수력_소안1호(현진수산).pdf</a>
              </div>
                 
<a href="../../external_resources/7___________________________________________1______11d05951.pdf">
  <img class="preview" src="../../external_resources/7___________________________________________1______9abc336e.png" loading="lazy" width="909" height="1285">
</a>
 
            </div>
            <div class="message-upload">
              
              <div class="link-title">
                <a href="../../external_resources/______-1_______________________1___________________373d4ca7.pdf">첨부-1. 수리계산서_소안1호 소수력발전소(현진수산).pdf</a>
              </div>
                 
<a href="../../external_resources/______-1_______________________1___________________373d4ca7.pdf">
  <img class="preview" src="../../external_resources/______-1_______________________1___________________fb32605c.png" loading="lazy" width="909" height="1285">
</a>
 
            </div>
            <div class="message-upload">
              
              <div class="link-title">
                <a href="../../external_resources/______-2___________________________________________6d5a8660.pdf">첨부-2. 발전기 정지회로도(수차발전기 Block Diagram)_소안1호(현진수산).pdf</a>
              </div>
                 
<a href="../../external_resources/______-2___________________________________________6d5a8660.pdf">
  <img class="preview" src="../../external_resources/______-2___________________________________________34d7cbd2.png" loading="lazy" width="1820" height="1286">
</a>
 
            </div>
            <div class="message-upload">
              
              <div class="link-title">
                <a href="../../external_resources/______-3______________________________1____________b6331186.pdf">첨부-3. 도면_아쿠아피시 소안1호(현진수산).pdf</a>
              </div>
                 
<a href="../../external_resources/______-3______________________________1____________b6331186.pdf">
  <img class="preview" src="../../external_resources/______-3______________________________1____________19f6b35f.png" loading="lazy" width="1820" height="1286">
</a>
 
            </div>
             
            <div class="message-reaction">
              👍 강형구
            </div>
            
          </div>
        </div>
      </div>
    </div>
</div>`;

    // HTML 요소를 Teams에 전송
    await sendHtmlElement(exampleHtml);
    return;
  }

  // 옵션 파싱
  const options = {
    force: args.includes('--force')
  };

  // 파일 경로 확인
  try {
    await fs.access(filePath);
    console.log(`📄 파일 경로 확인됨: ${filePath}`);
  } catch (error) {
    console.error(`❌ 파일을 찾을 수 없습니다: ${filePath}`);
    console.log('절대 경로 또는 상대 경로를 확인해주세요.');
    return;
  }

  // HTML 파일 처리
  await processHtmlFile(filePath, options);
};

// 모듈로 내보내기
export { sendHtmlElement, processHtmlFile, convertHtmlToTeamsCard };

// 스크립트가 직접 실행될 때만 main 함수 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}