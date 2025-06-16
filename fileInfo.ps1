# $ExportPath = ".\slackHistory"
$ExportPath = ".\slack_data\공통"
$SlackToken = "xoxe-5384631436435-8961844078146-8957490213909-a75e91c78520f769caf920d7332296b2"

function Get-TimeStamp {
    return "[{0:MM-dd-yy} {0:HH:mm:ss}]" -f (Get-Date)
}

function Get-SafeFileName {
    param (
        [string]$fileName
    )
    # 윈도우에서 사용할 수 없는 문자 제거
    $invalidChars = [IO.Path]::GetInvalidFileNameChars()
    $safeName = $fileName
    foreach ($char in $invalidChars) {
        $safeName = $safeName.Replace($char, '_')
    }
    # 공백을 언더스코어로 변경
    $safeName = $safeName.Replace(' ', '_')
    # 연속된 언더스코어를 하나로 변경
    $safeName = $safeName -replace '_+', '_'
    return $safeName
}

Write-Host -ForegroundColor Yellow "$(Get-TimeStamp) ExportPath: $ExportPath"
Write-Host -ForegroundColor Yellow "$(Get-TimeStamp) Checking if path exists: $(Test-Path $ExportPath)"

$ExportContents = Get-ChildItem -path $ExportPath -Directory
Write-Host -ForegroundColor Yellow "$(Get-TimeStamp) Found $($ExportContents.Count) directories in export directory"


class File {
    [string] $Name
    [string] $Title
    [string] $Channel
    [string] $DownloadURL
    [string] $MimeType
    [double] $Size
    [string] $ParentPath
    [string] $Time
    [string] $SafeFileName
    [string] $OriginalFileName
}

$channelList = Get-Content -Raw -Path "$ExportPath\channels.json" | ConvertFrom-Json
$Files = New-Object -TypeName System.Collections.ObjectModel.Collection["File"]

Write-Host -ForegroundColor Green "$(Get-TimeStamp) Starting Step 1 (processing channel export for files) of 2. Total Channel Count: $($channelList.Count)"
#Iterate through each Channel listed in the Archive
foreach ($channel in $channelList) {
    Write-Host -ForegroundColor White "$(Get-TimeStamp) Processing channel: $($channel.name)"
    $channelPath = Join-Path $ExportPath $channel.name
    if (Test-Path $channelPath) {
        $channelJsons = Get-ChildItem -Path $channelPath -File
        Write-Host -ForegroundColor White "$(Get-TimeStamp) Info: Starting to process $($channelJsons.Count) days of content for #$($channel.name)."
        #Start processing the daily JSON for files
        foreach ($json in $channelJsons) {
            $currentJson = Get-Content -Raw -Path $json.FullName | ConvertFrom-Json
            $jsonModified = $false
            #Write-Host -ForegroundColor Yellow "$(Get-TimeStamp) Info: Processing $($json.Name) in #$($channel.name).."
            #Iterate through every action
            foreach ($entry in $currentJson) {
                #If the action contained file(s)..
                if ($null -ne $entry.files) {
                    #Iterate through each file and add it to the List of Files to download
                    foreach ($item in $entry.Files) {
                        $file = New-Object -TypeName File
                        if ($null -ne $item.url_private_download) {
                            $file.Name = $item.name
                            $file.Title = $item.Title
                            $file.Channel = $channel.name
                            $file.DownloadURL = $item.url_private_download
                            $file.MimeType = $item.mimetype
                            $file.Size = $item.size
                            $file.ParentPath = $channelPath
                            $file.Time = $item.created
                            $file.OriginalFileName = $item.name
                            $file.SafeFileName = Get-SafeFileName $item.name
                            $files.Add($file)
                            
                            # 원본 JSON에 다운로드된 파일명 추가
                            $item | Add-Member -NotePropertyName "DownloadedFileName" -NotePropertyValue $file.SafeFileName -Force
                            $jsonModified = $true
                        }
                    }
                }
            }
            # JSON이 수정되었다면 저장
            if ($jsonModified) {
                if ($json -ne $null) {
                    $currentJson | ConvertTo-Json -Depth 50 | Set-Content -Path $json.FullName -Encoding UTF8
                }
                else {
                    Write-Host -ForegroundColor Red "$(Get-TimeStamp) Error: JSON file path is null."
                }
            }
        }
    }
    else {
        Write-Host -ForegroundColor Red "$(Get-TimeStamp) Warning: Channel directory not found: $channelPath"
    }
}
Write-Host -ForegroundColor Green "$(Get-TimeStamp) Step 1 of 2 complete. `n"

Write-Host -ForegroundColor Green "$(Get-TimeStamp) Starting step 2 (creating folders and downloading files) of 2."
#Determine which Files folders need to be created
$FoldersToMake = New-Object System.Collections.ObjectModel.Collection["string"]
foreach ($file in $files) {
    if ($FoldersToMake -notcontains $file.Channel) {
        $FoldersToMake.Add($file.Channel)
    }
}

#Create Folders
foreach ($folder in $FoldersToMake) {
    #$fullFolderPath = $file.ParentPath + "\Files"
    $fullFolderPath = $ExportPath + "\$($folder)"
    $fullFilesPath = $ExportPath + "\$($folder)\Files"
    if (-not (Test-Path $fullFilesPath)) {
        New-Item -Path $fullFolderPath  -Name "Files" -ItemType "directory"
    }
}

#Downloading Files
foreach ($file in $files) {
    Write-Host -ForegroundColor Yellow "$(Get-TimeStamp) Downloading $($file.OriginalFileName)."
    Write-Host -ForegroundColor Yellow "$(Get-TimeStamp) Safe filename: $($file.SafeFileName)"
    $fullFilePath = $file.ParentPath + "\Files\" + $file.SafeFileName
    Write-Host -ForegroundColor Yellow "$(Get-TimeStamp) Target path: $fullFilePath"
    
    if (-not (Test-Path $fullFilePath)) {
        try {
            $wc = New-Object System.Net.WebClient
            $wc.Headers.Add("Authorization", "Bearer $SlackToken")
            Write-Host -ForegroundColor Yellow "$(Get-TimeStamp) Starting download..."
            $wc.DownloadFile($file.DownloadURL, $fullFilePath)
            if (Test-Path $fullFilePath) {
                $fileSize = (Get-Item $fullFilePath).Length
                Write-Host -ForegroundColor Green "$(Get-TimeStamp) Successfully downloaded $($file.SafeFileName) (Size: $fileSize bytes)"
            }
            else {
                Write-Host -ForegroundColor Red "$(Get-TimeStamp) File was not created at $fullFilePath"
            }
        }
        catch [System.Net.WebException] {
            Write-Host -ForegroundColor Red "$(Get-TimeStamp) Error: Unable to download $($file.OriginalFileName) to $($fullFilePath)"
            Write-Host -ForegroundColor Red "$(Get-TimeStamp) Error details: $($_.Exception.Message)"
            Write-Host -ForegroundColor Red "$(Get-TimeStamp) Status code: $($_.Exception.Response.StatusCode.value__)"
            Write-Host -ForegroundColor Red "$(Get-TimeStamp) Status description: $($_.Exception.Response.StatusDescription)"
        }   
    }
    else {
        try {
            $extensionPosition = $file.SafeFileName.LastIndexOf('.')
            $splitFileName = $file.SafeFileName.Substring(0, $extensionPosition)
            $splitFileExtention = $file.SafeFileName.Substring($extensionPosition)
            $newFileName = $splitFileName + $file.Time + $splitFileExtention
            $fullFilePath = $file.ParentPath + "\Files\" + $newFileName
            Write-Host -ForegroundColor Yellow "$(Get-TimeStamp) File exists, using new name: $newFileName"
            Write-Host -ForegroundColor Yellow "$(Get-TimeStamp) New target path: $fullFilePath"
            
            $wc = New-Object System.Net.WebClient
            $wc.Headers.Add("Authorization", "Bearer $SlackToken")
            Write-Host -ForegroundColor Yellow "$(Get-TimeStamp) Starting download..."
            $wc.DownloadFile($file.DownloadURL, $fullFilePath)
            if (Test-Path $fullFilePath) {
                $fileSize = (Get-Item $fullFilePath).Length
                Write-Host -ForegroundColor Green "$(Get-TimeStamp) Successfully downloaded $($newFileName) (Size: $fileSize bytes)"
            }
            else {
                Write-Host -ForegroundColor Red "$(Get-TimeStamp) File was not created at $fullFilePath"
            }
        }
        catch [System.Net.WebException] {
            Write-Host -ForegroundColor Red "$(Get-TimeStamp) Error: Unable to download $($file.OriginalFileName) to $($fullFilePath)"
            Write-Host -ForegroundColor Red "$(Get-TimeStamp) Error details: $($_.Exception.Message)"
            Write-Host -ForegroundColor Red "$(Get-TimeStamp) Status code: $($_.Exception.Response.StatusCode.value__)"
            Write-Host -ForegroundColor Red "$(Get-TimeStamp) Status description: $($_.Exception.Response.StatusDescription)"
        }   
    }
}
Write-Host -ForegroundColor Green "$(Get-TimeStamp) Step 2 of 2 complete. `n"
Write-Host -ForegroundColor Green "$(Get-TimeStamp) Exiting.."