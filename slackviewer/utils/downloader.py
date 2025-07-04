import os
import hashlib
import urllib.parse
import requests
import logging
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import mimetypes
import time
import re

class ExternalResourceDownloader:
    """
    외부 리소스(이미지, 첨부파일 등)를 로컬로 다운로드하고 관리하는 클래스
    """
    
    def __init__(self, output_dir, download_dir="external_resources", slack_token=None):
        self.output_dir = Path(output_dir)
        self.download_dir = self.output_dir / download_dir
        
        print(f"🔧 다운로더 초기화 시작")
        print(f"  📁 출력 디렉토리: {self.output_dir.absolute()}")
        print(f"  📁 다운로드 디렉토리: {self.download_dir.absolute()}")
        logging.info(f"🔧 다운로더 초기화 시작")
        logging.info(f"  📁 출력 디렉토리: {self.output_dir.absolute()}")
        logging.info(f"  📁 다운로드 디렉토리: {self.download_dir.absolute()}")
        
        # 디렉토리 생성
        try:
            self.download_dir.mkdir(parents=True, exist_ok=True)
            print(f"  ✅ 디렉토리 생성 완료: {self.download_dir.exists()}")
            logging.info(f"  ✅ 디렉토리 생성 완료: {self.download_dir.exists()}")
            
            # 쓰기 권한 확인
            if os.access(self.download_dir, os.W_OK):
                print(f"  ✅ 쓰기 권한 확인됨")
                logging.info(f"  ✅ 쓰기 권한 확인됨")
            else:
                print(f"  ❌ 쓰기 권한 없음!")
                logging.error(f"  ❌ 쓰기 권한 없음!")
                
        except Exception as e:
            print(f"  ❌ 디렉토리 생성 실패: {str(e)}")
            logging.error(f"  ❌ 디렉토리 생성 실패: {str(e)}")
        
        # Slack 토큰 (Bearer 인증용)
        self.slack_token = slack_token
        
        # 다운로드된 파일들의 매핑 (URL -> 로컬 경로)
        self.downloaded_files = {}
        
        # 중복 다운로드 방지를 위한 캐시
        self.download_cache = {}
        
        # 원본 파일명과 다운로드된 파일명의 매핑 (원본 파일명 -> 다운로드된 파일명)
        self.original_filename_mapping = {}
        
        # 세션 재사용으로 성능 향상
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Slack-Export-Viewer/3.3.1'
        })
        
        # Slack 토큰이 있으면 Bearer 토큰 설정
        if self.slack_token:
            self.session.headers.update({
                'Authorization': f'Bearer {self.slack_token}'
            })
            logging.info("Slack 토큰이 설정되어 인증된 요청을 사용합니다.")
        
        # 다운로드 통계
        self.stats = {
            'total_attempted': 0,
            'total_success': 0,
            'total_failed': 0,
            'total_skipped': 0
        }
        
        # 기존 다운로드된 파일들을 캐시에 로드
        self._load_existing_files()
        
        # 기존 파일들에서 원본 파일명 매핑 재구성
        self._reconstruct_original_filenames()
        
        logging.info(f"외부 리소스 다운로더가 초기화되었습니다. 저장 위치: {self.download_dir}")
        print(f"🎉 외부 리소스 다운로더가 초기화되었습니다. 저장 위치: {self.download_dir}")
    
    def _load_existing_files(self):
        """
        이미 다운로드된 파일들을 캐시에 로드합니다.
        """
        if not self.download_dir.exists():
            return
        
        existing_files = list(self.download_dir.glob('*'))
        if existing_files:
            logging.info(f"기존 다운로드된 파일 {len(existing_files)}개를 캐시에 로드합니다.")
            print(f"📁 기존 다운로드된 파일 {len(existing_files)}개를 캐시에 로드합니다.")
            
            # 파일명에서 URL 해시를 추출하여 캐시에 추가
            for file_path in existing_files:
                if file_path.is_file():
                    filename = file_path.name
                    relative_path = str(file_path.relative_to(self.output_dir))
                    
                    # 파일명에서 해시 부분 추출 (마지막 8자리)
                    # 확장자가 있는 경우와 없는 경우 모두 처리
                    if '_' in filename:
                        parts = filename.split('_')
                        if len(parts) >= 2:
                            # 마지막 부분에서 확장자 제거 후 해시 확인
                            last_part = parts[-1]
                            if '.' in last_part:
                                # 확장자가 있는 경우
                                url_hash = last_part.split('.')[0]
                            else:
                                # 확장자가 없는 경우
                                url_hash = last_part
                            
                            # 8자리 해시인지 확인 (알파벳과 숫자만)
                            if len(url_hash) == 8 and url_hash.isalnum():
                                # 해시를 기반으로 캐시 키 생성 (실제 URL은 알 수 없으므로 파일명 기반)
                                cache_key = f"local_file_{url_hash}"
                                self.download_cache[cache_key] = relative_path
                                # downloaded_files에도 추가 (URL 매칭을 위해)
                                self.downloaded_files[cache_key] = relative_path
                                self.stats['total_skipped'] += 1
                                logging.debug(f"캐시에 로드: {filename} -> {cache_key}")
            
            logging.info(f"캐시 로드 완료: {len(self.download_cache)}개 파일")
            print(f"✅ 캐시 로드 완료: {len(self.download_cache)}개 파일")
        else:
            logging.info("기존 다운로드된 파일이 없습니다.")
            print("📁 기존 다운로드된 파일이 없습니다.")
    
    def _reconstruct_original_filenames(self):
        """
        기존 다운로드된 파일들에서 원본 파일명을 추정하여 매핑을 생성합니다.
        """
        if not self.download_dir.exists():
            return
        
        existing_files = list(self.download_dir.glob('*'))
        reconstructed_count = 0
        
        for file_path in existing_files:
            if file_path.is_file():
                filename = file_path.name
                
                # 파일명에서 원본 파일명 부분 추출 시도
                if '_' in filename:
                    parts = filename.split('_')
                    # 첫 번째 부분이 원본 파일명일 가능성이 높음
                    potential_original = parts[0]
                    
                    # 확장자 확인
                    if '.' in filename:
                        ext = os.path.splitext(filename)[1]
                        potential_original += ext
                    
                    # 원본 파일명 매핑에 추가
                    self.original_filename_mapping[potential_original] = filename
                    reconstructed_count += 1
                    logging.debug(f"원본 파일명 추정: {potential_original} -> {filename}")
        
        if reconstructed_count > 0:
            logging.info(f"원본 파일명 매핑 {reconstructed_count}개 재구성 완료")
            print(f"🔧 원본 파일명 매핑 {reconstructed_count}개 재구성 완료")
    
    def _extract_token_from_url(self, url):
        """
        URL에서 Slack 토큰을 추출합니다.
        t= 파라미터에서 xoxe- 또는 xoxb- 토큰을 찾습니다.
        """
        try:
            parsed_url = urlparse(url)
            query_params = parse_qs(parsed_url.query)
            
            # t 파라미터에서 토큰 추출
            if 't' in query_params:
                token = query_params['t'][0]
                if token.startswith(('xoxe-', 'xoxb-')):
                    return token
            
            # URL에 직접 토큰이 포함된 경우 (정규식으로 추출)
            token_pattern = r't=xox[eb]-\w+'
            match = re.search(token_pattern, url)
            if match:
                token = match.group(0).split('=')[1]
                return token
                
        except Exception as e:
            logging.debug(f"URL에서 토큰 추출 실패: {url} - {str(e)}")
        
        return None
    
    def get_safe_filename(self, url, content_type=None):
        """
        URL에서 안전한 파일명을 생성합니다.
        중복을 방지하기 위해 URL 해시를 사용합니다.
        """
        # URL에서 파일명 추출 시도
        parsed_url = urlparse(url)
        original_filename = os.path.basename(parsed_url.path)
        
        # URL 해시 생성 (중복 방지)
        url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
        
        # 확장자 결정 (우선순위: URL 경로 > Content-Type > 기본값)
        ext = ''
        
        # 1. URL 경로에서 확장자 추출
        if original_filename and '.' in original_filename:
            ext = os.path.splitext(original_filename)[1]
        
        # 2. Content-Type에서 확장자 추출 (URL에서 확장자를 찾지 못한 경우)
        if not ext and content_type:
            guessed_ext = mimetypes.guess_extension(content_type)
            if guessed_ext:
                ext = guessed_ext
        
        # 3. 기본 확장자 (이미지인 경우)
        if not ext and content_type and 'image' in content_type:
            if 'jpeg' in content_type or 'jpg' in content_type:
                ext = '.jpg'
            elif 'png' in content_type:
                ext = '.png'
            elif 'gif' in content_type:
                ext = '.gif'
            elif 'webp' in content_type:
                ext = '.webp'
            else:
                ext = '.bin'  # 바이너리 파일
        
        # 안전한 파일명 생성
        if original_filename and '.' in original_filename:
            name = os.path.splitext(original_filename)[0]
            # 특수문자 제거 및 안전한 문자로 변환
            safe_name = "".join(c for c in name if c.isalnum() or c in ('-', '_'))[:50]
            filename = f"{safe_name}_{url_hash}{ext}"
        else:
            filename = f"resource_{url_hash}{ext}"
        
        return filename
    
    def download_file(self, url, retry_count=3):
        """
        파일을 다운로드하고 로컬 경로를 반환합니다.
        이미 다운로드된 파일은 캐시에서 반환합니다.
        """
        if not url or not url.startswith(('http://', 'https://')):
            logging.debug(f"유효하지 않은 URL 스킵: {url}")
            return None
        
        self.stats['total_attempted'] += 1
        
        # 이미 다운로드된 파일인지 확인
        if url in self.downloaded_files:
            logging.debug(f"이미 다운로드된 파일 스킵: {url}")
            self.stats['total_skipped'] += 1
            return self.downloaded_files[url]
        
        # 캐시에서 확인
        if url in self.download_cache:
            logging.debug(f"캐시에서 찾은 파일 스킵: {url}")
            self.stats['total_skipped'] += 1
            return self.download_cache[url]
        
        # URL에서 도메인 추출하여 로그에 표시
        try:
            domain = urlparse(url).netloc
            logging.info(f"[{domain}] 다운로드 시작: {url}")
        except:
            logging.info(f"다운로드 시작: {url}")
        
        filename = None
        for attempt in range(retry_count):
            try:
                if attempt > 0:
                    logging.info(f"  재시도 {attempt + 1}/{retry_count}: {url}")
                
                # URL에서 토큰 추출 시도
                url_token = self._extract_token_from_url(url)
                
                # Slack CDN URL인지 확인하고 적절한 헤더 설정
                headers = {}
                if self._is_slack_cdn_url(url):
                    if url_token:
                        # URL에서 추출한 토큰 사용
                        headers['Authorization'] = f'Bearer {url_token}'
                        logging.debug(f"  URL에서 추출한 토큰 사용: {url_token[:10]}...")
                    elif self.slack_token:
                        # 설정된 토큰 사용
                        headers['Authorization'] = f'Bearer {self.slack_token}'
                        logging.debug("  설정된 Slack 토큰 사용")
                    else:
                        logging.warning("  Slack CDN URL이지만 토큰이 없어 인증 없이 시도합니다.")
                
                response = self.session.get(url, timeout=10, stream=True, headers=headers)
                response.raise_for_status()
                
                # Content-Type 확인
                content_type = response.headers.get('content-type', '').split(';')[0]
                content_length = response.headers.get('content-length')
                
                if content_length:
                    logging.info(f"  파일 크기: {int(content_length):,} bytes")
                
                # 안전한 파일명 생성
                filename = self.get_safe_filename(url, content_type)
                file_path = self.download_dir / filename
                
                # 원본 파일명 추출 및 매핑 저장
                parsed_url = urlparse(url)
                original_filename = os.path.basename(parsed_url.path)
                if original_filename:
                    self.original_filename_mapping[original_filename] = filename
                    logging.debug(f"원본 파일명 매핑: {original_filename} -> {filename}")
                
                print(f"  📝 파일 저장 경로: {file_path.absolute()}")
                logging.info(f"  📝 파일 저장 경로: {file_path.absolute()}")
                
                # 파일이 이미 존재하는지 확인 (다른 URL에서 같은 파일을 다운로드한 경우)
                if file_path.exists():
                    logging.info(f"  파일이 이미 존재함: {filename}")
                    print(f"  📁 파일이 이미 존재함: {filename}")
                    self.download_cache[url] = str(file_path.relative_to(self.output_dir))
                    self.stats['total_skipped'] += 1
                    return self.download_cache[url]
                
                # 파일 다운로드
                downloaded_size = 0
                print(f"  💾 파일 다운로드 시작: {filename}")
                logging.info(f"  💾 파일 다운로드 시작: {filename}")
                
                with open(file_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                            downloaded_size += len(chunk)
                
                # 파일 저장 후 존재 확인
                if file_path.exists():
                    actual_size = file_path.stat().st_size
                    print(f"  ✅ 다운로드 완료: {filename} ({downloaded_size:,} bytes)")
                    print(f"  📊 실제 파일 크기: {actual_size:,} bytes")
                    print(f"  📍 파일 존재 확인: {file_path.exists()}")
                    logging.info(f"  ✅ 다운로드 완료: {filename} ({downloaded_size:,} bytes)")
                    logging.info(f"  📊 실제 파일 크기: {actual_size:,} bytes")
                    logging.info(f"  📍 파일 존재 확인: {file_path.exists()}")
                else:
                    print(f"  ❌ 파일 저장 실패: {filename}")
                    logging.error(f"  ❌ 파일 저장 실패: {filename}")
                    return None
                
                # 성공 시 캐시에 저장
                relative_path = str(file_path.relative_to(self.output_dir))
                self.downloaded_files[url] = relative_path
                self.download_cache[url] = relative_path
                
                self.stats['total_success'] += 1
                return relative_path
                
            except Exception as e:
                logging.warning(f"  다운로드 실패 (시도 {attempt + 1}/{retry_count}): {str(e)}")
                print(f"  ❌ 다운로드 실패 (시도 {attempt + 1}/{retry_count}): {str(e)}")
                if attempt < retry_count - 1:
                    time.sleep(1)  # 재시도 전 잠시 대기
                else:
                    logging.error(f"  다운로드 최종 실패: {url} - {str(e)}")
                    print(f"  💥 다운로드 최종 실패: {url} - {str(e)}")
                    self.stats['total_failed'] += 1
                    return None
        
        return None
    
    def _is_slack_cdn_url(self, url):
        """
        URL이 Slack CDN URL인지 확인합니다.
        """
        slack_domains = [
            'a.slack-edge.com',
            'files.slack.com',
            'slack-files.com',
            'slack-imgs.com'
        ]
        
        parsed_url = urlparse(url)
        return any(domain in parsed_url.netloc for domain in slack_domains)
    
    def get_local_path(self, url):
        """
        URL에 대한 로컬 경로를 반환합니다.
        다운로드되지 않은 경우 None을 반환합니다.
        """
        return self.downloaded_files.get(url) or self.download_cache.get(url)
    
    def replace_urls_in_html(self, html_content):
        """
        HTML 내용에서 외부 URL을 로컬 경로로 교체합니다.
        """
        if not html_content:
            return html_content
        
        # 다운로드된 파일들의 URL을 로컬 경로로 교체
        for url, local_path in self.downloaded_files.items():
            if local_path:
                # URL을 로컬 경로로 교체
                html_content = html_content.replace(f'href="{url}"', f'href="{local_path}"')
                html_content = html_content.replace(f"href='{url}'", f"href='{local_path}'")
        
        return html_content
    
    def match_urls_with_files(self, html_content):
        """
        HTML 내용에서 사용되는 URL들을 찾아서 다운로드된 파일들과 매칭합니다.
        """
        import re
        
        # Slack CDN URL 패턴 찾기
        slack_url_pattern = r'https://files\.slack\.com/files-pri/[^"\s>]+'
        urls = re.findall(slack_url_pattern, html_content)
        
        print(f"🔍 HTML에서 발견된 Slack URL 수: {len(urls)}")
        
        # 각 URL에 대해 다운로드된 파일 찾기
        for url in urls:
            # URL에서 파일명 추출
            parsed_url = urlparse(url)
            original_filename = os.path.basename(parsed_url.path)
            
            if original_filename:
                # 다운로드된 파일들 중에서 매칭되는 파일 찾기
                for file_path in self.download_dir.glob('*'):
                    if file_path.is_file():
                        filename = file_path.name
                        
                        # 파일명에 원본 파일명이 포함되어 있는지 확인
                        if original_filename in filename or filename.startswith(original_filename.split('.')[0]):
                            relative_path = str(file_path.relative_to(self.output_dir))
                            self.downloaded_files[url] = relative_path
                            print(f"  ✅ URL 매칭: {url} -> {relative_path}")
                            break
        
        print(f"📊 매칭된 URL 수: {len(self.downloaded_files)}")
    
    def download_all_resources(self, messages):
        """
        모든 메시지에서 외부 리소스를 찾아 다운로드합니다.
        """
        print(f"🔍 download_all_resources 함수 시작! 메시지 개수: {len(messages)}")
        logging.info(f"🔍 download_all_resources 함수 시작! 메시지 개수: {len(messages)}")
        
        # 첫 번째 메시지 구조 확인
        if messages:
            first_msg = messages[0]
            print(f"📋 첫 번째 메시지 타입: {type(first_msg)}")
            print(f"📋 첫 번째 메시지 속성들: {dir(first_msg)}")
            logging.info(f"📋 첫 번째 메시지 타입: {type(first_msg)}")
            logging.info(f"📋 첫 번째 메시지 속성들: {dir(first_msg)}")
        
        total_resources = 0
        downloaded_count = 0
        
        logging.info(f"메시지에서 외부 리소스 검색 시작... (총 {len(messages)}개 메시지)")
        print(f"🚀 메시지에서 외부 리소스 검색 시작... (총 {len(messages)}개 메시지)")
        
        for i, message in enumerate(messages):
            if i % 50 == 0:  # 50개마다 진행률 표시
                logging.info(f"진행률: {i}/{len(messages)} 메시지 처리 완료 ({i/len(messages)*100:.1f}%)")
                print(f"📊 진행률: {i}/{len(messages)} 메시지 처리 완료 ({i/len(messages)*100:.1f}%)")
            
            message_resources = []  # 현재 메시지에서 발견된 리소스들
            
            # 사용자 프로필 이미지
            if hasattr(message, 'img') and message.img:
                total_resources += 1
                message_resources.append(f"프로필 이미지: {message.img}")
                if self.download_file(message.img):
                    downloaded_count += 1
            
            # 첨부파일들
            for j, attachment in enumerate(message.attachments):
                # 첨부파일 썸네일
                thumb = attachment.thumbnail()
                if thumb and thumb.get('src'):
                    total_resources += 1
                    message_resources.append(f"첨부파일{j+1} 썸네일: {thumb['src']}")
                    if self.download_file(thumb['src']):
                        downloaded_count += 1
                
                # 첨부파일 작성자 아이콘
                if hasattr(attachment, 'author_icon') and attachment.author_icon:
                    total_resources += 1
                    message_resources.append(f"첨부파일{j+1} 작성자 아이콘: {attachment.author_icon}")
                    if self.download_file(attachment.author_icon):
                        downloaded_count += 1
                
                # 첨부파일 푸터 아이콘
                if hasattr(attachment, 'footer_icon') and attachment.footer_icon:
                    total_resources += 1
                    message_resources.append(f"첨부파일{j+1} 푸터 아이콘: {attachment.footer_icon}")
                    if self.download_file(attachment.footer_icon):
                        downloaded_count += 1
            
            # 파일들
            for k, file in enumerate(message.files):
                # 파일 썸네일
                thumb = file.thumbnail()
                if thumb and thumb.get('src'):
                    total_resources += 1
                    message_resources.append(f"파일{k+1} 썸네일: {thumb['src']}")
                    if self.download_file(thumb['src']):
                        downloaded_count += 1
                
                # 파일 자체 다운로드 (download_url 사용)
                file_url = getattr(file, 'download_url', None) or file.link
                if file_url and self._is_slack_cdn_url(file_url):
                    total_resources += 1
                    message_resources.append(f"파일{k+1} 다운로드: {file_url}")
                    if self.download_file(file_url):
                        downloaded_count += 1
            
            # 메시지에 리소스가 있으면 로깅
            if message_resources:
                logging.info(f"메시지 {i+1}: {len(message_resources)}개 리소스 발견")
                print(f"📦 메시지 {i+1}: {len(message_resources)}개 리소스 발견")
                for resource in message_resources:
                    logging.info(f"  - {resource}")
                    print(f"    - {resource}")
        
        logging.info(f"외부 리소스 다운로드 완료!")
        print(f"✅ 외부 리소스 다운로드 완료!")
        logging.info(f"  총 발견된 리소스: {total_resources}개")
        logging.info(f"  성공적으로 다운로드: {downloaded_count}개")
        logging.info(f"  다운로드 통계: 시도 {self.stats['total_attempted']}개, 성공 {self.stats['total_success']}개, 실패 {self.stats['total_failed']}개, 스킵 {self.stats['total_skipped']}개")
        print(f"📊 총 발견된 리소스: {total_resources}개")
        print(f"📊 성공적으로 다운로드: {downloaded_count}개")
        print(f"📊 다운로드 통계: 시도 {self.stats['total_attempted']}개, 성공 {self.stats['total_success']}개, 실패 {self.stats['total_failed']}개, 스킵 {self.stats['total_skipped']}개")
        
        return downloaded_count, total_resources
    
    def replace_all_slack_links_in_html(self, html_content, html_file_path=None):
        """
        HTML 내 href/src의 Slack 파일 링크를 다운로드된 파일명과 매칭하여 모두 로컬 경로로 치환합니다.
        html_file_path: HTML 파일의 경로를 전달하여 상대 경로를 올바르게 계산합니다.
        """
        import re
        if not html_content:
            return html_content
        
        print(f"🔍 replace_all_slack_links_in_html 시작: {html_file_path}")
        
        # HTML 파일의 위치에 따라 external_resources 경로 결정
        if html_file_path:
            html_path = Path(html_file_path)
            # html_output/channel/ 하위면 ../../external_resources/
            # 경로에 'html_output', 'channel'이 모두 포함되어 있으면 적용
            parts = [str(p) for p in html_path.parts]
            print(f"🔍 HTML 경로 분석: {parts}")
            if 'html_output' in parts and 'channel' in parts:
                external_resources_prefix = "../../external_resources/"
                print(f"🔍 채널 페이지 감지: {external_resources_prefix}")
            else:
                external_resources_prefix = "external_resources/"
                print(f"🔍 메인 페이지 감지: {external_resources_prefix}")
        else:
            external_resources_prefix = "external_resources/"
            print(f"🔍 기본값 사용: {external_resources_prefix}")
        
        # 디버깅: 다운로드된 파일 목록 확인
        downloaded_files = list(self.download_dir.glob('*'))
        print(f"🔍 다운로드된 파일 수: {len(downloaded_files)}")
        if downloaded_files:
            print(f"🔍 첫 번째 파일 예시: {downloaded_files[0].name}")
        
        # Slack 파일 URL 패턴 (href/src 모두) - 더 포괄적인 패턴으로 수정
        slack_url_patterns = [
            r'(href|src)=["\'](https://files\.slack\.com/files-pri/[^"\'\s>]+)["\']',
            r'(href|src)=["\'](https://files\.slack\.com/files-tmb/[^"\'\s>]+)["\']',
            r'(href|src)=["\'](https://files\.slack\.com/[^"\'\s>]+)["\']'
        ]
        
        all_matches = []
        for pattern in slack_url_patterns:
            matches = re.findall(pattern, html_content)
            all_matches.extend(matches)
        
        print(f"🔍 HTML에서 발견된 Slack URL 수: {len(all_matches)}")
        if all_matches:
            print(f"🔍 첫 번째 URL 예시: {all_matches[0]}")
        
        # 다운로드된 파일 목록 준비
        file_map = {}
        for file_path in self.download_dir.glob('*'):
            if file_path.is_file():
                filename = file_path.name
                file_map[filename] = external_resources_prefix + filename
        
        print(f"🔍 파일 매핑 준비 완료: {len(file_map)}개 파일")
        
        replaced = 0
        for attr, url in all_matches:
            # URL에서 파일명 추출
            parsed_url = urlparse(url)
            original_filename = os.path.basename(parsed_url.path)
            
            print(f"🔍 처리 중인 URL: {url}")
            print(f"🔍 추출된 파일명: {original_filename}")
            
            # 1. 원본 파일명 매핑에서 정확한 매칭 시도
            if original_filename in self.original_filename_mapping:
                downloaded_filename = self.original_filename_mapping[original_filename]
                if downloaded_filename in file_map:
                    rel_path = file_map[downloaded_filename]
                    html_content = html_content.replace(f'{attr}="{url}"', f'{attr}="{rel_path}"')
                    html_content = html_content.replace(f"{attr}='{url}'", f"{attr}='{rel_path}'")
                    replaced += 1
                    print(f"  ✅ 정확한 매칭: {original_filename} -> {downloaded_filename}")
                    continue
            
            # 2. 기존 방식으로 부분 매칭 시도
            matched = False
            for filename, rel_path in file_map.items():
                if original_filename and (original_filename in filename or filename.startswith(original_filename.split('.')[0])):
                    # 치환
                    html_content = html_content.replace(f'{attr}="{url}"', f'{attr}="{rel_path}"')
                    html_content = html_content.replace(f"{attr}='{url}'", f"{attr}='{rel_path}'")
                    replaced += 1
                    print(f"  ⚠️  부분 매칭: {original_filename} -> {filename}")
                    matched = True
                    break
            
            if not matched:
                print(f"  ❌ 매칭 실패: {original_filename}")
        
        print(f"🔗 replace_all_slack_links_in_html: {replaced}개 링크 치환 완료 (경로: {external_resources_prefix})")
        
        # 추가: 이미 external_resources/로 시작하는 경로도 수정 (채널 페이지의 경우)
        if 'html_output' in parts and 'channel' in parts:
            # external_resources/ -> ../../external_resources/ 치환
            old_pattern = 'src="external_resources/'
            new_pattern = 'src="../../external_resources/'
            additional_replaced = html_content.count(old_pattern)
            html_content = html_content.replace(old_pattern, new_pattern)
            
            old_pattern = "src='external_resources/"
            new_pattern = "src='../../external_resources/"
            additional_replaced += html_content.count(old_pattern)
            html_content = html_content.replace(old_pattern, new_pattern)
            
            if additional_replaced > 0:
                print(f"🔗 추가 치환: {additional_replaced}개 external_resources/ 경로를 ../../external_resources/로 수정")
        
        return html_content 