import axios from 'axios';
import dotenv from 'dotenv';

// 환경변수 로드
dotenv.config();

// webhook URL을 환경변수에서 가져오기
const webhookUrl = process.env.WEB_HOOK_URL;

const testNewWebhook = async () => {
    if (!webhookUrl) {
        console.log('❌ WEB_HOOK_URL 환경변수가 설정되지 않았습니다.');
        console.log('📝 .env 파일에 WEB_HOOK_URL을 설정해주세요.');
        console.log('📝 예시: WEB_HOOK_URL=https://your-webhook-url-here');
        return;
    }

    console.log('🧪 Webhook URL 테스트 시작...');
    console.log(`🔗 URL: ${webhookUrl.substring(0, 50)}...`);

    try {
        const response = await axios.post(webhookUrl, {
            text: `🧪 Webhook 테스트 - ${new Date().toLocaleString('ko-KR')}`
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        });

        console.log(`✅ Webhook 테스트 성공: ${response.status}`);
        // console.log(`📊 응답 헤더:`, response.headers);
        console.log(`📊 응답 데이터:`, response.data);
        console.log(`📊 응답 데이터 타입:`, typeof response.data);

        // 안전한 타입 체크
        const has429Error = response.data &&
            typeof response.data === 'string' &&
            response.data.includes('429');

        if (has429Error) {
            console.log('❌ 429 에러가 발생합니다. Rate limit이 적용 중입니다.');
        } else {
            console.log('✅ Webhook이 정상 작동합니다!');
            console.log('\n🚀 이제 메인 스크립트를 실행할 수 있습니다.');
        }

    } catch (error) {
        console.error(`❌ Webhook 테스트 실패:`, error.message);
        if (error.response) {
            console.error(`📊 상태 코드: ${error.response.status}`);
            console.error(`📊 응답 데이터:`, error.response.data);
        }
    }
};

testNewWebhook().catch(console.error); 