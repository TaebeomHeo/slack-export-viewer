import axios from 'axios';
import dotenv from 'dotenv';

// 환경변수 로드
dotenv.config();

// webhook URL을 환경변수에서 가져오기
const webhookUrl = process.env.WEB_HOOK_URL;

if (!webhookUrl) {
    console.error('❌ WEB_HOOK_URL 환경변수가 설정되지 않았습니다.');
    console.log('📝 .env 파일에 WEB_HOOK_URL을 설정해주세요.');
    process.exit(1);
}

const testWebhook = async () => {
    try {
        const response = await axios.post(webhookUrl, {
            text: `🔄 Rate limit 복구 테스트 - ${new Date().toLocaleString('ko-KR')}`
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        });

        console.log(`✅ Webhook 테스트 성공: ${response.status}`);
        console.log(`📊 응답 데이터:`, response.data);

        // 안전한 타입 체크
        const has429Error = response.data &&
            typeof response.data === 'string' &&
            response.data.includes('HTTP error 429');

        if (has429Error) {
            return false; // 아직 429 에러
        }
        return true; // 성공
    } catch (error) {
        if (error.response && error.response.status === 429) {
            return false; // 429 에러
        }
        return true; // 다른 에러는 무시하고 성공으로 처리
    }
};

const waitForRateLimitRecovery = async () => {
    console.log('⏳ Teams webhook rate limit 복구 대기 중...');
    console.log('📊 Microsoft Teams API의 rate limit은 보통 30분~2시간 후에 해제됩니다.');
    console.log('💡 권장사항:');
    console.log('   1. 최소 1시간 대기');
    console.log('   2. 2시간 후에 테스트');
    console.log('   3. 그 후에 메인 스크립트 실행');

    const waitTime = 2 * 60 * 60 * 1000; // 2시간 (밀리초)
    const checkInterval = 30 * 60 * 1000; // 30분마다 체크

    console.log(`\n⏰ ${waitTime / 1000 / 60}분 후에 자동으로 테스트를 시작합니다...`);

    // 2시간 대기
    await new Promise(resolve => setTimeout(resolve, waitTime));

    console.log('\n🔄 Rate limit 해제 여부를 테스트합니다...');

    const isRecovered = await testWebhook();

    if (isRecovered) {
        console.log('✅ Rate limit이 해결되었습니다! 이제 메시지를 전송할 수 있습니다.');
        console.log('\n🚀 다음 명령어로 메인 스크립트를 실행하세요:');
        console.log('   node htmlToTeamsCard.js <HTML_파일_경로>');
        return true;
    } else {
        console.log('❌ 아직 rate limit이 적용 중입니다.');
        console.log('💡 추가로 1시간 더 기다린 후 다시 시도하세요.');
        console.log('   또는 새로운 webhook URL을 생성하는 것을 고려하세요.');
        return false;
    }
};

// 옵션: 수동으로 대기 시간 설정
const args = process.argv.slice(2);
if (args.length > 0) {
    const hours = parseInt(args[0]);
    if (!isNaN(hours)) {
        console.log(`⏰ ${hours}시간 후에 테스트를 시작합니다...`);
        setTimeout(async () => {
            console.log('\n🔄 Rate limit 해제 여부를 테스트합니다...');
            const isRecovered = await testWebhook();
            if (isRecovered) {
                console.log('✅ Rate limit이 해결되었습니다!');
            } else {
                console.log('❌ 아직 rate limit이 적용 중입니다.');
            }
        }, hours * 60 * 60 * 1000);
    } else {
        console.log('사용법: node waitForRateLimit.js [대기시간_시간]');
        console.log('예시: node waitForRateLimit.js 1  (1시간 대기)');
    }
} else {
    waitForRateLimitRecovery().catch(console.error);
} 