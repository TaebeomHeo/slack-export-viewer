#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from slackviewer.utils.downloader import ExternalResourceDownloader
import os

def test_link_replacement():
    print("🔗 링크 수정 기능 테스트 시작...")
    
    # 다운로더 초기화
    downloader = ExternalResourceDownloader('html_output')
    
    print(f"📊 다운로드된 파일 수: {len(downloader.downloaded_files)}")
    
    if downloader.downloaded_files:
        # 첫 번째 파일 예시 출력
        first_url, first_path = list(downloader.downloaded_files.items())[0]
        print(f"📁 첫 번째 파일 예시:")
        print(f"   URL: {first_url}")
        print(f"   로컬 경로: {first_path}")
        
        # 테스트 HTML 내용 생성
        test_html = f'''
        <html>
        <body>
            <a href="{first_url}">원본 링크</a>
            <img src="external_resources/test.jpg" />
            <a href="https://files.slack.com/files-pri/T05BAJKCUCT-F082KEWD6RK/20240618_204727.jpg?t=xoxe-5384631436435-9046309256643-9044546037059-284e1a69d32fcf30be37ecec7b47bda3">
                <img src="external_resources/20240618_204727_360_927e5c12.jpg" />
            </a>
        </body>
        </html>
        '''
        
        print(f"\n🔧 테스트 HTML 내용:")
        print(test_html)
        
        # 링크 수정 테스트
        modified_html = downloader.replace_urls_in_html(test_html)
        
        print(f"\n✅ 수정된 HTML 내용:")
        print(modified_html)
        
        # 변경사항 확인
        if modified_html != test_html:
            print("✅ 링크 수정이 성공적으로 작동했습니다!")
        else:
            print("⚠️  링크 수정이 작동하지 않았습니다.")
    else:
        print("❌ 다운로드된 파일이 없습니다.")

if __name__ == "__main__":
    test_link_replacement() 