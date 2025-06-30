from flask_frozen import Freezer
from pathlib import Path
import shutil
import os
import tempfile

class CustomFreezer(Freezer):

    cf_output_dir = None

    @property
    def root(self):
        # Use the specified cf_output_dir if set
        if self.cf_output_dir:
            return Path(self.cf_output_dir)
        # Otherwise, follow the default behavior of flask_frozen
        else:
            root = Path(self.app.root_path)
            return root / self.app.config['FREEZER_DESTINATION']
    
    def freeze_yield(self):
        """
        Override freeze_yield to protect external_resources directory
        """
        from flask_frozen import Page
        from contextlib import suppress
        
        # external_resources 디렉토리 경로 확인
        external_resources_path = None
        if self.cf_output_dir:
            external_resources_path = Path(self.cf_output_dir) / "external_resources"
        
        # 원래 freeze_yield 로직 실행
        seen_urls = set()
        seen_endpoints = set()
        built_paths = set()

        for url, endpoint, last_modified in self._generate_all_urls():
            seen_endpoints.add(endpoint)
            if url in seen_urls:
                # Don't build the same URL more than once
                continue
            seen_urls.add(url)
            new_path = self._build_one(url, last_modified)
            built_paths.add(new_path)
            yield Page(url, new_path.relative_to(self.root))

        self._check_endpoints(seen_endpoints)
        
        # Remove extra files logic - modified to protect external_resources
        remove_extra = self.app.config['FREEZER_REMOVE_EXTRA_FILES']
        if remove_extra:
            # Remove files from the previous build that are not here anymore.
            ignore = self.app.config['FREEZER_DESTINATION_IGNORE']
            previous_paths = set(
                Path(self.root / name) for name in
                self._walk_directory(self.root, ignore=ignore))
            
            # external_resources 디렉토리와 그 하위 파일들을 보호
            protected_paths = set()
            if external_resources_path and external_resources_path.exists():
                # external_resources 디렉토리와 모든 하위 파일/디렉토리를 보호 목록에 추가
                for path in external_resources_path.rglob('*'):
                    protected_paths.add(path)
                protected_paths.add(external_resources_path)
            
            # 보호된 파일들을 제외하고 삭제
            for extra_path in previous_paths - built_paths:
                if extra_path not in protected_paths:
                    if extra_path.is_file():
                        extra_path.unlink()
                    elif extra_path.is_dir():
                        with suppress(OSError):
                            extra_path.rmdir()
    
    def _walk_directory(self, directory, ignore=None):
        """
        Walk directory and yield relative paths, excluding ignored patterns.
        This is a copy of the original method to avoid import issues.
        """
        from pathlib import Path
        
        if ignore is None:
            ignore = []
        
        for root, dirs, files in os.walk(directory):
            # Remove ignored directories
            dirs[:] = [d for d in dirs if not any(
                pattern in os.path.join(root, d) for pattern in ignore)]
            
            for file in files:
                file_path = os.path.join(root, file)
                if not any(pattern in file_path for pattern in ignore):
                    yield os.path.relpath(file_path, directory)
    
    def freeze(self):
        """
        Override freeze method to use our custom freeze_yield
        """
        return set(page.url for page in self.freeze_yield())
