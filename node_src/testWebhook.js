import axios from 'axios';

const webhookUrl = 'https://agenergycorp.webhook.office.com/webhookb2/ae672a30-2857-4d85-aa75-79da4d4e6a98@a9c060ff-95d2-49d0-b593-1408e5e1ae63/IncomingWebhook/de07b1cf78ed498ca5cf16de7e58477b/7d569f06-60b1-45bf-af21-bd10c6484a06/V2tmf626vLnXs_C6HlIuoKDIbUS0Qj8fCaX10EwqBUDGw1';

const testWebhook = async () => {
    console.log('🔍 Teams webhook 연결 테스트 시작...');

    // 1. 간단한 텍스트 메시지 테스트
    console.log('\n1️⃣ 간단한 텍스트 메시지 테스트');
    try {
        const textResponse = await axios.post(webhookUrl, {
            text: `🧪 Webhook 테스트 - ${new Date().toLocaleString('ko-KR')}`
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        });

        console.log(`✅ 텍스트 메시지 전송 성공: ${textResponse.status}`);
        console.log(`📊 응답 데이터:`, textResponse.data);
    } catch (error) {
        console.error(`❌ 텍스트 메시지 전송 실패:`, error.message);
        if (error.response) {
            console.error(`📊 상태 코드: ${error.response.status}`);
            console.error(`📊 응답 데이터:`, error.response.data);
        }
    }

    // 2. MessageCard 테스트
    console.log('\n2️⃣ MessageCard 테스트');
    try {
        const cardResponse = await axios.post(webhookUrl, {
            "@type": "MessageCard",
            "@context": "http://schema.org/extensions",
            "themeColor": "0076D7",
            "summary": "테스트 카드",
            "sections": [
                {
                    "activityTitle": "**테스트 사용자** (2024-01-01 12:00:00)",
                    "activitySubtitle": "이것은 테스트 메시지입니다.",
                    "activityImage": "https://img.icons8.com/color/48/000000/user.png"
                }
            ]
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        });

        console.log(`✅ MessageCard 전송 성공: ${cardResponse.status}`);
        console.log(`📊 응답 데이터:`, cardResponse.data);
    } catch (error) {
        console.error(`❌ MessageCard 전송 실패:`, error.message);
        if (error.response) {
            console.error(`📊 상태 코드: ${error.response.status}`);
            console.error(`📊 응답 데이터:`, error.response.data);
        }
    }

    // 3. 네트워크 연결 테스트
    console.log('\n3️⃣ 네트워크 연결 테스트');
    try {
        const pingResponse = await axios.get('https://agenergycorp.webhook.office.com', {
            timeout: 5000
        });
        console.log(`✅ Teams 서버 연결 성공: ${pingResponse.status}`);
    } catch (error) {
        console.error(`❌ Teams 서버 연결 실패:`, error.message);
    }

    console.log('\n🏁 테스트 완료');
};

testWebhook().catch(console.error); 