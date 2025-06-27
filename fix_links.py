#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from slackviewer.utils.downloader import ExternalResourceDownloader
import glob
import os

def fix_html_links():
    print("🔗 HTML 파일들의 링크 수정 시작...")
    
    # 다운로더 초기화
    downloader = ExternalResourceDownloader('html_output')
    
    # 모든 HTML 파일 찾기
    html_files = glob.glob("html_output/**/*.html", recursive=True)
    print(f"📁 발견된 HTML 파일 수: {len(html_files)}")
    
    total_modified = 0
    
    for html_file in html_files:
        try:
            print(f"\n🔧 처리 중: {html_file}")
            
            with open(html_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # href/src 모두 치환 (HTML 파일 경로 전달)
            modified_content = downloader.replace_all_slack_links_in_html(content, html_file)
            
            # 변경사항이 있으면 파일에 저장
            if modified_content != content:
                with open(html_file, 'w', encoding='utf-8') as f:
                    f.write(modified_content)
                print(f"  ✅ 링크 수정 완료")
                total_modified += 1
            else:
                print(f"  ⏭️  수정할 링크 없음")
                
        except Exception as e:
            print(f"  ❌ 링크 수정 실패: {e}")
    
    print(f"\n🎉 모든 HTML 파일의 링크 수정이 완료되었습니다!")
    print(f"📊 수정된 파일 수: {total_modified}/{len(html_files)}")

if __name__ == "__main__":
    fix_html_links() 