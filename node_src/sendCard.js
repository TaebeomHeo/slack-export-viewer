//
// incoming webhook
// 
// https://agenergycorp.webhook.office.com/webhookb2/ae672a30-2857-4d85-aa75-79da4d4e6a98@a9c060ff-95d2-49d0-b593-1408e5e1ae63/IncomingWebhook/de07b1cf78ed498ca5cf16de7e58477b/7d569f06-60b1-45bf-af21-bd10c6484a06/V2tmf626vLnXs_C6HlIuoKDIbUS0Qj8fCaX10EwqBUDGw1            
//


// main.js
import axios from 'axios';

const webhookUrl = 'https://agenergycorp.webhook.office.com/webhookb2/ae672a30-2857-4d85-aa75-79da4d4e6a98@a9c060ff-95d2-49d0-b593-1408e5e1ae63/IncomingWebhook/de07b1cf78ed498ca5cf16de7e58477b/7d569f06-60b1-45bf-af21-bd10c6484a06/V2tmf626vLnXs_C6HlIuoKDIbUS0Qj8fCaX10EwqBUDGw1';
const message = {
    "text": "📣 오늘은 주간업무보고 제출일 입니다! 📣\n\n• 마지막장 에너지사업본부 근무표 작성도 같이 부탁드립니다.\n• 작성하신 주간업무보고는 **금일 2시까지** 저에게 공유 부탁드립니다!\n\n[주간업무보고_230616.pptx] 파일 첨부 (https://agenergycorp.sharepoint.com/:b:/s/Slack_BackUp/EYxZReD-BcxGsbFAiXFQpz4BXXtA6VS50GPacrYusmqH5Q?e=u9np5I)"
};

axios.post(webhookUrl, message)
    .then(response => console.log('메시지 전송 성공!'))
    .catch(error => console.error('메시지 전송 실패:', error));
