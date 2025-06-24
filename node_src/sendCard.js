//
// incoming webhook
// 
// https://agenergycorp.webhook.office.com/webhookb2/ae672a30-2857-4d85-aa75-79da4d4e6a98@a9c060ff-95d2-49d0-b593-1408e5e1ae63/IncomingWebhook/de07b1cf78ed498ca5cf16de7e58477b/7d569f06-60b1-45bf-af21-bd10c6484a06/V2tmf626vLnXs_C6HlIuoKDIbUS0Qj8fCaX10EwqBUDGw1            
//


// main.js
import axios from 'axios';

const webhookUrl = 'https://agenergycorp.webhook.office.com/webhookb2/ae672a30-2857-4d85-aa75-79da4d4e6a98@a9c060ff-95d2-49d0-b593-1408e5e1ae63/IncomingWebhook/de07b1cf78ed498ca5cf16de7e58477b/7d569f06-60b1-45bf-af21-bd10c6484a06/V2tmf626vLnXs_C6HlIuoKDIbUS0Qj8fCaX10EwqBUDGw1';
//
// NOTE: CAUTION:
// 포맷팅
// 줄바꿈은 \n\n 으로 반복해야함
// 링크는 띄어쓰지 않고 (url) 로 처리해야함
// 
const message = {
    "text": `**김상우** (2023-06-12 16:29:52)
회의록을 재공유합니다. \n\n파일명을 **'날짜(2023xxxx)*회의록*주제'** 로 양식 맞춰서 '#공통' 채널에 탑재해주시면, 추후에 분류 및 검색이 용이할 것 같습니다.
회의록은 검색 편의를 위해 주 단위/월 단위 로 취합하여 공유하도록 하겠습니다.
\n
📎 **File:** [2023xxxx_회의록_주제.docx](https://agenergycorp.sharepoint.com/:x:/s/Slack_BackUp/EWb0WJU-0WhKujhE2tX-LXwB63P9M-YTKyJObmvZaDcpnw)
\n
👍 **Reactions:** 👀 전솔, 🙂 김기용
`
};

axios.post(webhookUrl, message)
    .then(response => console.log('메시지 전송 성공!'))
    .catch(error => console.error('메시지 전송 실패:', error));
