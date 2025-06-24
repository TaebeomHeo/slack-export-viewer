import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

// 환경변수 로드
dotenv.config();

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
        throw new Error('환경변수가 설정되지 않았습니다. .env 파일을 확인해주세요.');
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

// 1. 사이트 ID 획득
const getSiteId = async (siteName, accessToken) => {
    const response = await axios.get(
        `https://graph.microsoft.com/v1.0/sites/agenergycorp.sharepoint.com:/sites/${siteName}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return response.data.id;
};

// 2. 파일 업로드 및 링크 생성
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

// 메인 업로드 함수 (모듈화)
export const uploadFileToSharePoint = async (siteName, filePath) => {
    try {
        // 파일 존재 확인
        await fs.access(filePath);

        console.log('액세스 토큰 획득 중...');
        const accessToken = await getAccessToken();

        console.log('파일 읽는 중...');
        const fileBuffer = await fs.readFile(filePath);

        console.log('SharePoint에 파일 업로드 중...');

        // 토큰 재시도 로직 적용
        const siteId = await withTokenRetry(
            (token) => getSiteId(siteName, token),
            accessToken
        );

        const shareLink = await withTokenRetry(
            (token) => uploadAndGetLink(siteId, filePath, fileBuffer, token),
            accessToken
        );

        console.log("생성된 링크:", shareLink);
        return shareLink;
    } catch (error) {
        console.error('오류:', error.message);
        throw error;
    }
};

// /** 
// 기본 사용 예시 (테스트용)
const main = async () => {
    try {
        const siteName = "Slack_BackUp";
        const filePath = "./slack-data/HOME_발전설비_발전기별.xlsx";

        const shareLink = await uploadFileToSharePoint(siteName, filePath);
        console.log("업로드 완료:", shareLink);
    } catch (error) {
        console.error('메인 함수 오류:', error.message);
    }
};

// 스크립트 실행
main().catch(console.error);
// */
