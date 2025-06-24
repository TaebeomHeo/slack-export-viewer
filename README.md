# Slack Export Viewer

![CI](https://github.com/hfaran/slack-export-viewer/actions/workflows/ci.yml/badge.svg)
[![PyPI version](https://badge.fury.io/py/slack-export-viewer.svg)](http://badge.fury.io/py/slack-export-viewer)

A Slack Export archive viewer that allows you to easily view and share your
Slack team's export (instead of having to dive into hundreds of JSON files).

![Preview](screenshot.png)

## Contents

- [Overview](#overview)
- [Installation](#installation)
- [Usage](#usage)
- [Acknowledgements](#acknowledgements)

## Overview

`slack-export-viewer` is useful for small teams on a free Slack plan (limited to 10,000 messages) who overrun their budget and ocassionally need a nice interface to refer back to previous messages. You get a web interface to easily scroll through all channels in the export without having to look at individual JSON files per channel per day.

`slack-export-viewer` can be used locally on one machine for yourself to explore an export, it can be run on a headless server (as it is a Flask web app) if you also want to serve the content to the rest of your team, or it can output HTML for deploying a static website.

## Installation

I recommend [`pipx`](https://github.com/pipxproject/pipx) for a nice
isolated install.

```bash
pipx install slack-export-viewer
```

Or just feel free to use `pip` as you like.

```bash
pip install slack-export-viewer
```

`slack-export-viewer` will be installed as an entry-point; run from anywhere.

```bash
$ slack-export-viewer --help
Usage: slack-export-viewer [OPTIONS]

Options:
  -p, --port INTEGER              Host port to serve your content on
                                  Environment var: SEV_PORT (default: 5000)
  -z, --archive PATH              Path to your Slack export archive (.zip file or directory)
                                  Environment var: SEV_ARCHIVE  [required]
  -I, --ip TEXT                   Host IP to serve your content on
                                  Environment var: SEV_IP (default: localhost)
  --no-browser                    If you do not want a browser to open automatically, set this.
                                  Environment var: SEV_NO_BROWSER (default: false)
  --channels TEXT                 A comma separated list of channels to parse.
                                  Environment var: SEV_CHANNELS (default: None)
  --no-sidebar                    Removes the sidebar.
                                  Environment var: SEV_NO_SIDEBAR (default: false)
  --no-external-references        Removes all references to external
                                  css/js/images. Environment var:
                                  SEV_NO_EXTERNAL_REFERENCES (default: false)
  --test                          Runs in 'test' mode, i.e., this will do an archive extract, but will not start the server, and immediately quit.
                                            Environment var: SEV_TEST (default: false
  --debug                         Enable debug mode
                                  Environment var: FLASK_DEBUG (default: false)
  -o, --output-dir PATH           Output directory for static HTML files.
                                  Environment var: SEV_OUTPUT_DIR (default: html_output)
  --html-only                     If you want static HTML only, set this.
                                  Environment var: SEV_HTML_ONLY (default: false)
  --since [%Y-%m-%d]              Only show messages since this date.
                                  Environment var: SEV_SINCE (default: None)
  --show-dms / --no-show-dms      Show/Hide direct messages
                                  Environment var: SEV_SHOW_DMS (default: false)
  --thread-note / --no-thread-note
                                  Add/don't add 'Thread Reply' to thread messages.
                                  Environment var: SEV_THREAD_NOTE (default: true)
  --skip-channel-member-change    Hide channel join/leave messages
                                  Environment var: SEV_SKIP_CHANNEL_MEMBER_CHANGE (default: false)
  --hide-channels TEXT            Comma separated list of channels to hide.
                                  Environment var: SEV_HIDE_CHANNELS (default: None)
  --download-external             Download external resources (images, attachments) to local directory for offline viewing.
                                  Environment var: SEV_DOWNLOAD_EXTERNAL (default: false)
  --slack-token TEXT              Slack Bearer token for downloading authenticated resources (xoxb-...).
                                  Environment var: SEV_SLACK_TOKEN (default: None)
  --help                          Show this message and exit.
```

## Usage

### 1) Grab your Slack team's export

#### Option 1: official Slack export

- Visit [https://my.slack.com/services/export](https://my.slack.com/services/export)
- Create an export
- Wait for it to complete
- Refresh the page and download the export (.zip file) into whatever directory

#### Option 2: slackdump

- Download slackdump from https://github.com/rusq/slackdump/
- Setup authentication as outlined in the slackdump documentation
- Run slackdump and export messages in the "Standard" format as either a directory or zip file.
  - `slack-export-viewer` can also use the director without zip file.

### 2) Point `slack-export-viewer` to it

Point slack-export-viewer to the .zip file and let it do its magic

```bash
slack-export-viewer -z /path/to/export/zip
```

If everything went well, your archive will have been extracted and processed, and a browser window will have opened showing your _#general_ channel from the export. Or, if the `html-only` flag was set, HTML files will be available in the `html-output` directory (or a different directory if specified).

### 3) Offline viewing with external resources

To create a completely offline version with all external resources (images, attachments) downloaded locally:

```bash
slack-export-viewer -z /path/to/export/zip --html-only --download-external
```

This will:

- Download all external images and attachments to `html_output/external_resources/`
- Generate HTML files that reference the local copies
- Create a completely self-contained archive that works offline
- Prevent duplicate downloads by using URL hashing
- Handle file naming conflicts automatically

The downloaded files are organized with safe filenames and include the original file extensions.

#### Using Slack token for authenticated resources

Some Slack resources (like user profile images and file attachments) require authentication. To download these resources, you'll need a Slack Bearer token:

```bash
slack-export-viewer -z /path/to/export/zip --html-only --download-external --slack-token xoxb-your-token-here
```

**Automatic Token Extraction**: The tool can automatically extract tokens from Slack URLs (like `t=xoxe-...` or `t=xoxb-...` parameters) and use them for authentication. This means you might not need to provide a separate token if the URLs in your export already contain valid tokens.

To get a Slack token (if automatic extraction doesn't work):

1. Go to https://api.slack.com/apps
2. Create a new app or select an existing one
3. Go to "OAuth & Permissions"
4. Add the following scopes:
   - `files:read` - to download file attachments
   - `users:read` - to access user profile information
5. Install the app to your workspace
6. Copy the "Bot User OAuth Token" (starts with `xoxb-`)

You can also set the token as an environment variable:

```bash
export SEV_SLACK_TOKEN=xoxb-your-token-here
slack-export-viewer -z /path/to/export/zip --html-only --download-external
```

## CLI

There is now a CLI included as well. Currently the one command you can use is clearing the cache from slack-export-viewer from your %TEMP% directory; see usage:

```bash
$ slack-export-viewer-cli --help
Usage: cli.py [OPTIONS] COMMAND [ARGS]...

Options:
  --help  Show this message and exit.

Commands:
  clean   Cleans up any temporary files (including cached output by...
  export  Generates a single-file printable export for an archive file or...
```

Export:

```bash
$ slack-export-viewer-cli export --help
Usage: cli.py export [OPTIONS] ARCHIVE_DIR

  Generates a single-file printable export for an archive file or directory

Options:
  --debug                         Enable debug mode
                                  Environment var: SEV_DEBUG (default: false)
  --show-dms / --no-show-dms      Show/Hide direct messages"
                                  Environment var: SEV_SHOW_DMS (default: false)
  --thread-note / --no-thread-note
                                  Add/don't add 'Thread Reply' to thread messages.
                                  Environment var: SEV_THREAD_NOTE (default: true)
  --since [%Y-%m-%d]              Only show messages since the given date
                                  Environment var: SEV_SINCE (default: None)
  --skip-channel-member-change    Hide channel join/leave messages
                                  Environment var: SEV_SKIP_CHANNEL_MEMBER_CHANGE (default: false)
  --template FILENAME             Custom single file export template
                                  Environment var: SEV_TEMPLATE (default: "export_single.html")
  --hide-channels TEXT            Comma separated list of channels to hide.
                                  Environment var: SEV_HIDE_CHANNELS (default: None)
  --help                          Show this message and exit.
```

An example template can be found in the repositories [`slackviewer/templates/example_template_single_export.html`](https://github.com/hfaran/slack-export-viewer/tree/master/slackviewer/templates/example_template_single_export.html) file

Clean

```bash
$ slack-export-viewer-cli clean --help
Usage: cli.py clean [OPTIONS]

  Cleans up any temporary files (including cached output by slack-export-
  viewer)

Options:
  -w, --wet  Actually performs file deletion
             Environment var: SEV_CLEAN_WET (default: false)
  --help     Show this message and exit.
```

### Examples

Clean:

```bash
$ slack-export-viewer-cli clean
Run with -w to remove C:\Users\hamza\AppData\Local\Temp\_slackviewer
$ slack-export-viewer-cli clean -w
Removing C:\Users\hamza\AppData\Local\Temp\_slackviewer...
```

Export:

```bash
$ slack-export-viewer-cli export \
    --since $(date -d "2 days ago" '+%Y-%m-%d') \
    --template /tmp/example_template_single_export.html \
    --show-dms \
    --skip-channel-member-change \
    --no-thread-note \
    --hide-channels "random,alerts" \
    /tmp/slack-export
Archive already extracted. Viewing from /tmp/slack-export...
Exported to slack-export.html
```

## Local Development

After installing the requirements in requirements.txt and dev-requirements.txt,
define `FLASK_APP` as `main` and select any channels desired from an export:

```bash
export FLASK_APP=main && export SEV_CHANNELS=general

# powershell에서는
$env:FLASK_APP = "main"
$env:SEV_CHANNELS = "general"

```

fileInfo.ps1은 파일을 다운로드 받는 Powershell script임.
다운로드 받으려면, xox-... 토큰이 필요함. 이는 다운로드 링크 클릭시 dev-tools/network에서 확인 가능

또한 아래 shell command를 해야 함

```powershell
  $currentJson | ConvertTo-Json -Depth 50 | Set-Content -Path $json.FullName -Encoding UTF8
```

Encoding UTF8

Start a development server by running `app.py` in the root directory:

```bash
python3 app.py -z /Absolute/path/to/archive.zip --debug
```

## Acknowledgements

Credit to Pieter Levels whose [blog post](https://levels.io/slack-export-to-html/) and PHP script I used as a jumping off point for this.

### Improvements over Pieter's script

`slack-export-viewer` is similar in core functionality but adds several things on top to make it nicer to use:

- An installable application
- Automated archive extraction and retention
- A Slack-like sidebar that lets you switch channels easily
- Much more "sophisticated" rendering of messages
- A Flask server which lets you serve the archive contents as opposed to a PHP script which does static file generation
