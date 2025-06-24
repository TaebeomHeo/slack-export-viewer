#!/usr/bin/env python3
"""
외부 리소스 다운로더 테스트 스크립트
"""

import os
import sys
import logging
from pathlib import Path

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

# 프로젝트 루트를 Python 경로에 추가
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from slackviewer.utils.downloader import ExternalResourceDownloader

def test_token_extraction():
    """URL에서 토큰 추출 기능을 테스트합니다."""
    
    print("\n" + "="*60)
    print("🔍 토큰 추출 테스트 시작")
    print("="*60)
    
    # html_output/external_resources 디렉토리 사용
    test_dir = Path("html_output/external_resources")
    test_dir.mkdir(parents=True, exist_ok=True)
    
    downloader = ExternalResourceDownloader(str(test_dir))
    
    # 테스트 URL들
    test_urls = [
        "https://files.slack.com/files-pri/T05BAJKCUCT-F05BBFEHSF4/download/_____________1_______________________________________2022.02.07.pdf?t=xoxe-5384631436435-9046309256643-9044546037059-284e1a69d32fcf30be37ecec7b47bda3",
        "https://a.slack-edge.com/0180/img/slackbot_24.png?t=xoxb-1234567890-abcdef",
        "https://httpbin.org/image/png",  # 토큰 없는 URL
    ]
    
    for i, url in enumerate(test_urls, 1):
        print(f"\n📋 테스트 {i}: {url}")
        token = downloader._extract_token_from_url(url)
        if token:
            print(f"  ✅ 추출된 토큰: {token[:20]}...")
        else:
            print(f"  ❌ 토큰 없음")

def test_downloader():
    """다운로더 기능을 테스트합니다."""
    
    print("\n" + "="*60)
    print("📥 다운로드 테스트 시작")
    print("="*60)
    
    # html_output/external_resources 디렉토리 사용
    test_dir = Path("html_output/external_resources")
    test_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"📁 테스트 디렉토리: {test_dir.absolute()}")
    
    # 환경변수에서 Slack 토큰 가져오기
    slack_token = os.environ.get('SEV_SLACK_TOKEN')
    
    # 다운로더 초기화
    downloader = ExternalResourceDownloader(str(test_dir), slack_token=slack_token)
    
    if slack_token:
        print(f"🔑 Slack 토큰이 설정되어 있습니다: {slack_token[:10]}...")
    else:
        print("⚠️  Slack 토큰이 설정되지 않았습니다. 인증이 필요한 리소스는 다운로드되지 않을 수 있습니다.")
    
    # 테스트 URL들
    test_urls = [
        "https://a.slack-edge.com/0180/img/slackbot_24.png",
        "https://a.slack-edge.com/2fac/plugins/slackbot/assets/service_32.png",
        "https://httpbin.org/image/png",  # 테스트용 이미지
    ]
    
    print(f"\n🚀 {len(test_urls)}개 URL 다운로드 테스트 시작...")
    
    for i, url in enumerate(test_urls, 1):
        print(f"\n📥 다운로드 {i}/{len(test_urls)}: {url}")
        local_path = downloader.download_file(url)
        
        if local_path:
            full_path = test_dir / local_path
            print(f"  ✅ 성공: {local_path}")
            print(f"  📊 파일 크기: {full_path.stat().st_size:,} bytes")
            print(f"  📍 파일 존재: {full_path.exists()}")
        else:
            print(f"  ❌ 실패: 다운로드할 수 없음")
    
    # 중복 다운로드 테스트
    print(f"\n🔄 중복 다운로드 테스트...")
    duplicate_path = downloader.download_file(test_urls[0])
    print(f"중복 URL 다운로드 결과: {duplicate_path}")
    
    print(f"\n📋 다운로드된 파일들:")
    for url, local_path in downloader.downloaded_files.items():
        print(f"  🔗 {url}")
        print(f"     📁 {local_path}")
    
    # 통계 출력
    stats = downloader.stats
    print(f"\n📊 다운로드 통계:")
    print(f"  📈 시도: {stats['total_attempted']}개")
    print(f"  ✅ 성공: {stats['total_success']}개")
    print(f"  ❌ 실패: {stats['total_failed']}개")
    print(f"  ⏭️  스킵: {stats['total_skipped']}개")
    
    print(f"\n🎉 테스트 완료! 다운로드된 파일들은 {test_dir.absolute()}에 저장되었습니다.")

if __name__ == "__main__":
    print("🚀 외부 리소스 다운로더 테스트 시작")
    test_token_extraction()
    test_downloader()
    print("\n✨ 모든 테스트 완료!") 