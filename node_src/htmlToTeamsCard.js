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

// 파일 업로드 관리 클래스
class FileUploadManager {
  constructor() {
    this.uploadedFiles = new Map(); // fileName -> shareLink
    this.filesTrackerFile = 'uploaded_files.json';
    this.siteName = process.env.SHAREPOINT_SITE_NAME || 'Slack_BackUp';
    this.slackDataPath = process.env.SLACK_DATA_PATH || './html_output';
  }

  // 업로드된 파일 기록 로드
  async loadUploadedFiles() {
    try {
      const data = await fs.readFile(this.filesTrackerFile, 'utf-8');
      const files = JSON.parse(data);
      this.uploadedFiles = new Map(Object.entries(files));
      console.log(`📁 ${this.uploadedFiles.size}개의 업로드된 파일 기록을 로드했습니다.`);
    } catch (error) {
      console.log('📁 이전 파일 업로드 기록이 없습니다.');
    }
  }

  // SharePoint에서 실제 파일 목록 확인
  async syncWithSharePoint() {
    try {
      console.log('🔄 SharePoint 파일 목록과 동기화 중...');
      const accessToken = await getAccessToken();
      const siteId = await withTokenRetry(
        (token) => getSiteId(this.siteName, token),
        accessToken
      );


      const sharePointFiles = await withTokenRetry(
        (token) => getSharePointFiles(siteId, token),
        accessToken
      );

      console.log(`📊 SharePoint에 ${sharePointFiles.length}개의 파일이 있습니다.`);

      // 로컬 기록과 SharePoint 실제 파일 목록 비교
      const localFiles = Array.from(this.uploadedFiles.keys());
      const missingInLocal = sharePointFiles.filter(file => !localFiles.includes(file));

      if (missingInLocal.length > 0) {
        console.log(`⚠️ 로컬 기록에 없는 SharePoint 파일 ${missingInLocal.length}개 발견`);
        // 누락된 파일들의 링크를 조회하여 로컬 기록에 추가
        for (const file of missingInLocal) {
          try {
            const shareLink = await withTokenRetry(
              (token) => getFileShareLink(siteId, file.id, token),
              accessToken
            );

            if (shareLink) {
              this.uploadedFiles.set(file.name, shareLink);
              console.log(`✅ 파일 링크 복원: ${file.name}`);
            } else {
              console.log(`⚠️ 파일 링크 복원 실패: ${file.name} (계속 진행)`);
            }
          } catch (error) {
            console.log(`⚠️ 파일 링크 복원 중 오류 발생: ${file.name} - ${error.message} (계속 진행)`);
          }
        }
      }

    } catch (error) {
      console.error('❌ SharePoint 동기화 실패:', error.message);
    }
  }

  // 업로드된 파일 기록 저장
  async saveUploadedFiles() {
    try {
      const files = Object.fromEntries(this.uploadedFiles);
      await fs.writeFile(this.filesTrackerFile, JSON.stringify(files, null, 2), 'utf-8');
      console.log(`💾 ${this.uploadedFiles.size}개의 파일 업로드 기록을 저장했습니다.`);
    } catch (error) {
      console.error('❌ 파일 업로드 기록 저장 실패:', error.message);
    }
  }

  // 파일이 이미 업로드되었는지 확인
  isFileUploaded(fileName) {
    return this.uploadedFiles.has(fileName);
  }

  // 파일의 SharePoint 링크 가져오기
  getFileLink(fileName) {
    return this.uploadedFiles.get(fileName);
  }

  // 파일을 SharePoint에 업로드
  async uploadFile(fileName) {
    try {
      // 이미 업로드된 파일인지 확인
      if (this.isFileUploaded(fileName)) {
        console.log(`⏭️ 파일 "${fileName}" 이미 업로드됨`);
        return this.getFileLink(fileName);
      }

      // 파일 경로 구성 - external_resources 폴더에서 찾기
      const filePath = path.join(this.slackDataPath, 'external_resources', fileName);

      // 파일 존재 확인
      try {
        await fs.access(filePath);
      } catch (error) {
        console.log(`⚠️ 파일을 찾을 수 없음: ${filePath}`);
        return null;
      }

      console.log(`📤 파일 업로드 중: ${fileName}`);

      // SharePoint에 업로드
      const accessToken = await getAccessToken();
      const siteId = await withTokenRetry(
        (token) => getSiteId(this.siteName, token),
        accessToken
      );

      const fileBuffer = await fs.readFile(filePath);
      const shareLink = await withTokenRetry(
        (token) => uploadAndGetLink(siteId, fileName, fileBuffer, token),
        accessToken
      );

      // 업로드 성공 시 기록에 추가
      this.uploadedFiles.set(fileName, shareLink);
      console.log(`✅ 파일 업로드 완료: ${fileName}`);

      return shareLink;

    } catch (error) {
      console.log(`⚠️ 파일 업로드 실패 "${fileName}": ${error.message}`);
      return null;
    }
  }

  // 여러 파일을 배치로 업로드
  async uploadFiles(fileNames) {
    const results = [];
    for (const fileName of fileNames) {
      const link = await this.uploadFile(fileName);
      results.push({ fileName, link });
    }
    return results;
  }

  // 업로드된 파일 수 반환
  getUploadedCount() {
    return this.uploadedFiles.size;
  }
}

// 전역 인스턴스들
const rateLimiter = new TeamsRateLimiter();
const messageTracker = new MessageTracker();
const fileUploadManager = new FileUploadManager();

// 종료 핸들러 함수
const gracefulShutdown = async (signal) => {
  console.log(`\n🛑 ${signal} 신호를 받았습니다. 안전하게 종료 중...`);

  try {
    // 전송 기록 저장
    await messageTracker.saveSentMessages();
    console.log('💾 전송 기록이 저장되었습니다.');

    // 파일 업로드 기록 저장
    await fileUploadManager.saveUploadedFiles();
    console.log('💾 파일 업로드 기록이 저장되었습니다.');

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

// SharePoint 파일 업로드 관련 함수들
let cachedToken = null;
let tokenExpiry = null;

const getAccessToken = async () => {
  // 토큰이 유효하면 캐시된 토큰 반환
  if (cachedToken && tokenExpiry && new Date() < tokenExpiry) {
    return cachedToken;
  }

  const tenantId = process.env.TENANT_ID;
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;

  // 환경변수 검증
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('SharePoint 환경변수가 설정되지 않았습니다. .env 파일을 확인해주세요.');
  }

  const response = await axios.post(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials'
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  // 토큰 캐시 (만료 5분 전에 갱신)
  cachedToken = response.data.access_token;
  const expiresIn = response.data.expires_in || 3600; // 기본 1시간
  tokenExpiry = new Date(Date.now() + (expiresIn - 300) * 1000); // 5분 전에 만료

  return cachedToken;
};

// 토큰 재발급 및 재시도 래퍼 함수
const withTokenRetry = async (apiCall, accessToken) => {
  try {
    return await apiCall(accessToken);
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.log('토큰 만료 감지, 토큰 재발급 중...');
      // 토큰 캐시 초기화
      cachedToken = null;
      tokenExpiry = null;
      // 새 토큰으로 재시도
      const newToken = await getAccessToken();
      return await apiCall(newToken);
    }
    throw error;
  }
};

// SharePoint 사이트 ID 획득
const getSiteId = async (siteName, accessToken) => {
  const response = await axios.get(
    `https://graph.microsoft.com/v1.0/sites/agenergycorp.sharepoint.com:/sites/${siteName}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return response.data.id;
};

// SharePoint에 파일 업로드 및 링크 생성
const uploadAndGetLink = async (siteId, fileName, fileBuffer, accessToken) => {
  // 파일명만 추출 (경로 제거)
  const baseFileName = path.basename(fileName);

  // Slack_BackUp 채널(폴더) 안에 파일 업로드
  const uploadResponse = await axios.put(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/Slack_BackUp/${baseFileName}:/content`,
    fileBuffer,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream'
      }
    }
  );

  // 공유 링크 생성
  const itemId = uploadResponse.data.id;
  const linkResponse = await axios.post(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${itemId}/createLink`,
    { type: 'view', scope: 'organization' },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  return linkResponse.data.link.webUrl;
};

// SharePoint에서 파일 목록 조회
const getSharePointFiles = async (siteId, accessToken) => {
  try {
    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/Slack_BackUp:/children`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response.data.value.map(item => ({
      name: item.name,
      id: item.id,
      webUrl: item.webUrl
    }));
  } catch (error) {
    console.log('SharePoint 파일 목록 조회 실패, 빈 배열 반환:', error.message);
    return [];
  }
};

// SharePoint에서 파일의 공유 링크 조회
const getFileShareLink = async (siteId, fileId, accessToken) => {
  try {
    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${fileId}?$select=id,@microsoft.graph.downloadUrl`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    // 공유 링크 생성
    const linkResponse = await axios.post(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${fileId}/createLink`,
      { type: 'view', scope: 'organization' },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return linkResponse.data.link.webUrl;
  } catch (error) {
    console.error(`파일 링크 조회 실패: ${error.message}`);
    return null;
  }
};

// HTML에서 파일 참조 추출 함수
const extractFileReferences = (htmlElement) => {
  const dom = new JSDOM(htmlElement);
  const document = dom.window.document;

  const fileRefs = [];

  // 1. user_icon 클래스의 이미지 처리 (프로필 이미지)
  console.log('🔍 user_icon 검색 중...');

  // 다양한 방법으로 user_icon 찾기
  let userIconElement = document.querySelector('img.user_icon');
  if (!userIconElement) {
    userIconElement = document.querySelector('img[class*="user_icon"]');
  }
  if (!userIconElement) {
    userIconElement = document.querySelector('img[class="user_icon"]');
  }
  if (!userIconElement) {
    // 모든 img 태그에서 user_icon 클래스를 가진 것 찾기
    const allImages = document.querySelectorAll('img');
    for (const img of allImages) {
      const className = img.getAttribute('class');
      if (className && className.includes('user_icon')) {
        userIconElement = img;
        break;
      }
    }
  }

  if (userIconElement) {
    console.log('✅ user_icon 요소 발견');
    const userIconSrc = userIconElement.getAttribute('src');
    const userIconClass = userIconElement.getAttribute('class');
    console.log(`🔗 user_icon src: ${userIconSrc}`);
    console.log(`🏷️ user_icon class: ${userIconClass}`);
    if (userIconSrc && userIconSrc.includes('external_resources/')) {
      const fileName = userIconSrc.split('external_resources/')[1];
      console.log(`📁 추출된 파일명: ${fileName}`);
      if (fileName) {
        fileRefs.push({
          type: 'user_icon',
          originalName: fileName,
          actualFileName: fileName,
          order: 0 // user_icon은 가장 먼저
        });
        console.log('✅ user_icon 파일 참조 추가됨');
      }
    } else {
      console.log('⚠️ user_icon src가 external_resources/를 포함하지 않음');
    }
  } else {
    console.log('❌ user_icon 요소를 찾을 수 없음');
    // 모든 img 태그 확인
    const allImages = document.querySelectorAll('img');
    console.log(`📊 총 ${allImages.length}개의 img 태그 발견`);
    allImages.forEach((img, index) => {
      const src = img.getAttribute('src');
      const className = img.getAttribute('class');
      console.log(`  ${index + 1}. src: ${src}, class: ${className}`);
    });
  }

  // 2. message-upload 클래스에서 파일 첨부 추출
  const uploadElements = document.querySelectorAll('.message-upload');
  console.log(`📁 message-upload 요소 ${uploadElements.length}개 발견`);
  uploadElements.forEach((uploadElement, index) => {
    // link-title에서 원본 파일명과 업로드 대상 파일 추출
    const linkTitleElement = uploadElement.querySelector('.link-title a');
    if (linkTitleElement) {
      const originalFileName = linkTitleElement.textContent.trim();
      const uploadFilePath = linkTitleElement.getAttribute('href');

      if (uploadFilePath && uploadFilePath.includes('external_resources/')) {
        const actualFileName = uploadFilePath.split('external_resources/')[1];
        if (actualFileName) {
          fileRefs.push({
            type: 'upload_file',
            originalName: originalFileName,
            actualFileName: actualFileName,
            order: index + 1
          });
        }
      }
    }
  });

  console.log(`📋 총 ${fileRefs.length}개의 파일 참조 추출됨`);
  fileRefs.forEach((ref, index) => {
    console.log(`  ${index + 1}. ${ref.type}: ${ref.originalName}`);
  });

  return fileRefs;
};

// HTML 요소를 Teams 카드로 변환하는 함수
const convertHtmlToTeamsCard = async (htmlElement) => {
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

  // 파일 참조 추출
  const fileRefs = extractFileReferences(htmlElement);
  const uploadedFiles = [];
  let userIconFile = null;

  if (fileRefs.length > 0) {
    console.log(`📁 메시지에서 ${fileRefs.length}개의 파일 참조 발견`);

    // 1단계: 모든 파일들을 먼저 업로드
    console.log('🔄 파일 업로드 시작...');
    for (const fileRef of fileRefs) {
      try {
        // user_icon은 별도 처리 (프로필 이미지) - 현재 비활성화 (SharePoint 링크가 private이라 Teams 카드에서 표시 불가)
        if (fileRef.type === 'user_icon') {
          console.log(`👤 사용자 아이콘 발견: ${fileRef.originalName} (Teams 카드에서는 기본 아이콘 사용)`);
          // SharePoint 링크는 private이라 Teams 카드의 ActivityImage로 사용할 수 없음
          // 나중에 Base64 인코딩이나 공개 호스팅 서비스 사용 고려
          continue;
        }

        // upload_file만 Teams 카드에 표시
        if (fileRef.type === 'upload_file') {
          console.log(`📤 파일 업로드 중: ${fileRef.originalName}`);
          const shareLink = await fileUploadManager.uploadFile(fileRef.actualFileName);
          if (shareLink) {
            uploadedFiles.push({
              type: fileRef.type,
              originalName: fileRef.originalName,
              actualFileName: fileRef.actualFileName,
              link: shareLink,
              order: fileRef.order
            });
            console.log(`✅ 파일 업로드 완료: ${fileRef.originalName}`);
          } else {
            console.log(`⚠️ 파일 업로드 실패: ${fileRef.originalName} (${fileRef.actualFileName}) (계속 진행)`);
          }
        }
      } catch (error) {
        console.log(`⚠️ 파일 업로드 중 오류 발생: ${fileRef.originalName} (${fileRef.actualFileName}) - ${error.message} (계속 진행)`);
      }
    }
    console.log('✅ 모든 파일 업로드 완료');
  }

  // 2단계: 업로드된 파일들을 바탕으로 Teams 카드 생성
  console.log('🔄 Teams 카드 생성 중...');

  // userIconFile 상태 디버깅
  console.log(`🔍 userIconFile 상태: ${userIconFile ? '설정됨' : 'null'}`);
  if (userIconFile) {
    console.log(`🔍 userIconFile.link: ${userIconFile.link}`);
  }

  const card = {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    "themeColor": "0076D7",
    "summary": `${info.username}의 메시지`,
    "activityImage": "https://img.icons8.com/color/48/000000/user.png",
    "sections": [
      {
        "activityTitle": `${info.isReply ? '↳ ' : ''}**${info.username}** (${info.time})`
      }
    ]
  };

  // 메시지가 있고 비어있지 않은 경우에만 activitySubtitle 추가
  if (info.message && info.message.trim() !== '') {
    card.sections[0].activitySubtitle = info.message;
  }

  // 카드 생성 후 activityImage 확인
  console.log('📋 Teams 카드 내용:');
  console.log(`  - ActivityImage: ${card.activityImage}`);
  console.log(`  - ActivityTitle: ${card.sections[0].activityTitle}`);
  if (card.sections[0].activitySubtitle) {
    console.log(`  - ActivitySubtitle: ${card.sections[0].activitySubtitle}`);
  } else {
    console.log(`  - ActivitySubtitle: [메시지 없음]`);
  }
  if (card.sections[0].facts) {
    console.log(`  - Facts 개수: ${card.sections[0].facts.length}`);
  }

  // 사용자 아이콘 사용 여부 로그
  console.log(`🖼️ Teams 카드에 기본 아이콘 사용`);
  console.log(`🖼️ ActivityImage URL: https://img.icons8.com/color/48/000000/user.png`);

  // 업로드된 파일이 있는 경우
  if (uploadedFiles.length > 0) {
    // 순서대로 정렬
    uploadedFiles.sort((a, b) => a.order - b.order);

    const facts = uploadedFiles.map((file, index) => ({
      "name": `📎 파일 ${file.order}`,
      "value": `[${file.originalName}](${file.link})`
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
      "value": info.reaction
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

    console.log('📤 요청 전송 중... (재시도: 0/3)');

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
    const { card, messageId } = await convertHtmlToTeamsCard(container.outerHTML);

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

    // 파일 업로드 기록 로드 및 SharePoint 동기화
    await fileUploadManager.loadUploadedFiles();
    await fileUploadManager.syncWithSharePoint();

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

      // 메시지 ID 추출 (중복 체크용)
      const tempDom = new JSDOM(container.outerHTML);
      const tempDocument = tempDom.window.document;
      const messageContainer = tempDocument.querySelector('.message-container');
      const messageId = messageContainer ? messageContainer.id || messageContainer.querySelector('[id]')?.id : null;

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
      console.log(`📁 현재 업로드된 파일: ${fileUploadManager.getUploadedCount()}개`);

      // 메시지 정보 추출 (파일 업로드 + 카드 생성)
      const { card, messageId: extractedMessageId } = await convertHtmlToTeamsCard(container.outerHTML);

      const result = await sendCardToTeams(card);

      if (result.success) {
        console.log(`✅ 메시지 ${i + 1} 전송 완료`);
        successCount++;

        // 성공한 메시지 ID 기록
        if (extractedMessageId) {
          messageTracker.markMessageAsSent(extractedMessageId);
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
          messageId: extractedMessageId,
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
    console.log(`📁 업로드된 파일: ${fileUploadManager.getUploadedCount()}개`);

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
    const { card, messageId } = await convertHtmlToTeamsCard(htmlElement);

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
    console.log('\n환경변수 설정 (.env 파일):');
    console.log('  WEB_HOOK_URL=your_teams_webhook_url');
    console.log('  TENANT_ID=your_tenant_id');
    console.log('  CLIENT_ID=your_client_id');
    console.log('  CLIENT_SECRET=your_client_secret');
    console.log('  SHAREPOINT_SITE_NAME=Slack_BackUp');
    console.log('  SLACK_DATA_PATH=./html_output');
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