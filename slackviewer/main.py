import webbrowser
import os

import click
import flask

from slackviewer.app import app
from slackviewer.config import Config
from slackviewer.freezer import CustomFreezer
from slackviewer.reader import Reader
from slackviewer.utils.downloader import ExternalResourceDownloader


def configure_app(app, config, downloader=None):
    app.debug = config.debug
    app.no_sidebar = config.no_sidebar
    app.no_external_references = config.no_external_references
    if app.debug:
        print("WARNING: DEBUG MODE IS ENABLED!")
    app.config["PROPAGATE_EXCEPTIONS"] = True

    reader = Reader(config, downloader)

    top = flask._app_ctx_stack
    top.path = reader.archive_path()
    top.channels = reader.compile_channels(config.channels)
    top.groups = reader.compile_groups()
    top.dms = {}
    top.dm_users = []
    top.mpims = {}
    top.mpim_users = []
    if config.show_dms:
        top.dms = reader.compile_dm_messages()
        top.dm_users = reader.compile_dm_users()
        top.mpims = reader.compile_mpim_messages()
        top.mpim_users = reader.compile_mpim_users()

    reader.warn_not_found_to_hide_channels()

    # remove any empty channels & groups. DM's are needed for now
    # since the application loads the first
    top.channels = {k: v for k, v in top.channels.items() if v}
    top.groups = {k: v for k, v in top.groups.items() if v}
    
    # 외부 리소스 다운로드 (download_external 옵션이 활성화된 경우)
    if downloader and config.download_external:
        print("외부 리소스를 다운로드하는 중...")
        all_messages = []
        
        print(f"채널 메시지 수집 중... (총 {len(top.channels)}개 채널)")
        for channel_name, messages in top.channels.items():
            print(f"  채널 '{channel_name}': {len(messages)}개 메시지")
            all_messages.extend(messages)
        
        print(f"그룹 메시지 수집 중... (총 {len(top.groups)}개 그룹)")
        for group_name, messages in top.groups.items():
            print(f"  그룹 '{group_name}': {len(messages)}개 메시지")
            all_messages.extend(messages)
        
        print(f"DM 메시지 수집 중... (총 {len(top.dms)}개 DM)")
        for dm_name, messages in top.dms.items():
            print(f"  DM '{dm_name}': {len(messages)}개 메시지")
            all_messages.extend(messages)
        
        print(f"MPIM 메시지 수집 중... (총 {len(top.mpims)}개 MPIM)")
        for mpim_name, messages in top.mpims.items():
            print(f"  MPIM '{mpim_name}': {len(messages)}개 메시지")
            all_messages.extend(messages)
        
        print(f"총 {len(all_messages)}개 메시지에서 외부 리소스 검색 시작...")
        
        downloaded, total = downloader.download_all_resources(all_messages)
        print(f"다운로드 완료: {downloaded}/{total} 개의 외부 리소스")


@click.command()
@click.option('-p', '--port', default=5000, envvar='SEV_PORT', type=click.INT, help="""\b
    Host port to serve your content on
    Environment var: SEV_PORT (default: 5000)
    """)
@click.option("-z", "--archive", type=click.Path(exists=True), required=True, envvar='SEV_ARCHIVE', help="""\b
    Path to your Slack export archive (.zip file or directory)
    Environment var: SEV_ARCHIVE
    """)
@click.option('-I', '--ip', default='localhost', envvar='SEV_IP', type=click.STRING, help="""\b
    Host IP to serve your content on
    Environment var: SEV_IP (default: localhost)
    """)
@click.option('--no-browser', is_flag=True, default=False, envvar='SEV_NO_BROWSER', help="""\b
    If you do not want a browser to open automatically, set this.
    Environment var: SEV_NO_BROWSER (default: false)
    """)
@click.option('--channels', type=click.STRING, default=None, envvar='SEV_CHANNELS', help="""\b
    A comma separated list of channels to parse.
    Environment var: SEV_CHANNELS (default: None)
    """)
@click.option('--no-sidebar', is_flag=True, default=False, envvar='SEV_NO_SIDEBAR', help="""\b
    Removes the sidebar.
    Environment var: SEV_NO_SIDEBAR (default: false)
    """)
@click.option('--no-external-references', is_flag=True, default=False, envvar='SEV_NO_EXTERNAL_REFERENCES', help="""
    Removes all references to external css/js/images.
    Environment var: SEV_NO_EXTERNAL_REFERENCES (default: false)
    """)
@click.option('--test', is_flag=True, default=False, envvar='SEV_TEST', help="""\b
    Runs in 'test' mode, i.e., this will do an archive extract, but will not start the server, and immediately quit.
              Environment var: SEV_TEST (default: false
    """)
@click.option('--debug', is_flag=True, default=False, envvar='FLASK_DEBUG', help="""\b
    Enable debug mode
    Environment var: FLASK_DEBUG (default: false)
    """)
@click.option("-o", "--output-dir", default="html_output", type=click.Path(),
              envvar='SEV_OUTPUT_DIR', help="""\b
    Output directory for static HTML files.
    Environment var: SEV_OUTPUT_DIR (default: html_output)
    """)
@click.option("--html-only", is_flag=True, default=False, envvar='SEV_HTML_ONLY', help="""\b
    If you want static HTML only, set this.
    Environment var: SEV_HTML_ONLY (default: false)
    """)
@click.option("--since", default=None, type=click.DateTime(formats=["%Y-%m-%d"]), envvar='SEV_SINCE', help="""\b
    Only show messages since this date.
    Environment var: SEV_SINCE (default: None)
    """)
@click.option('--show-dms/--no-show-dms', default=True, envvar='SEV_SHOW_DMS', help="""\b
    Show/Hide direct messages
    Environment var: SEV_SHOW_DMS (default: false)
    """)
@click.option('--thread-note/--no-thread-note', default=True, envvar='SEV_THREAD_NOTE', help="""\b
    Add/don't add 'Thread Reply' to thread messages.
    Environment var: SEV_THREAD_NOTE (default: true)
    """)
@click.option('--skip-channel-member-change', is_flag=True, default=False, envvar='SEV_SKIP_CHANNEL_MEMBER_CHANGE', help="""\b
    Hide channel join/leave messages
    Environment var: SEV_SKIP_CHANNEL_MEMBER_CHANGE (default: false)
    """)
@click.option("--hide-channels", default=None, type=str, envvar="SEV_HIDE_CHANNELS", help="""\b
    Comma separated list of channels to hide.
    Environment var: SEV_HIDE_CHANNELS (default: None)
    """)
@click.option("--download-external", is_flag=True, default=False, envvar='SEV_DOWNLOAD_EXTERNAL', help="""\b
    Download external resources (images, attachments) to local directory for offline viewing.
    Environment var: SEV_DOWNLOAD_EXTERNAL (default: false)
    """)
@click.option("--slack-token", type=click.STRING, default=None, envvar='SEV_SLACK_TOKEN', help="""\b
    Slack Bearer token for downloading authenticated resources (xoxb-...).
    Environment var: SEV_SLACK_TOKEN (default: None)
    """)
def main(**kwargs):
    config = Config(kwargs)
    if not config.archive:
        raise ValueError("Empty path provided for archive")

    # 다운로더 초기화 (download_external 옵션이 활성화된 경우)
    downloader = None
    if config.download_external:
        if not config.html_only:
            print("WARNING: --download-external is only supported with --html-only mode")
        else:
            downloader = ExternalResourceDownloader(config.output_dir, slack_token=config.slack_token)
            print(f"외부 리소스 다운로더가 초기화되었습니다. 저장 위치: {downloader.download_dir}")
            if config.slack_token:
                print("Slack 토큰이 설정되어 인증된 리소스 다운로드를 시도합니다.")
            else:
                print("WARNING: Slack 토큰이 설정되지 않아 인증이 필요한 리소스는 다운로드되지 않을 수 있습니다.")

    configure_app(app, config, downloader)

    if config.html_only:
        # We need relative URLs, otherwise channel refs do not work
        app.config["FREEZER_RELATIVE_URLS"] = True

        # Custom subclass of Freezer allows overwriting the output directory
        freezer = CustomFreezer(app)
        freezer.cf_output_dir = config.output_dir

        # This tells freezer about the channel URLs
        @freezer.register_generator
        def channel_name():
            for channel in flask._app_ctx_stack.channels:
                yield {"name": channel}

        freezer.freeze()

        if not config.no_browser:
            webbrowser.open("file:///{}/index.html"
                            .format(os.path.abspath(config.output_dir)))

    elif not config.test:
        if not config.no_browser:
            webbrowser.open("http://{}:{}".format(config.ip, config.port))
        app.run(
            host=config.ip,
            port=config.port
        )
