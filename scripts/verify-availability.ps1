$ErrorActionPreference = "Stop"

$baseUrl = $env:ANILIST_MANAGER_URL
if ([string]::IsNullOrWhiteSpace($baseUrl)) {
    $baseUrl = "http://127.0.0.1:6767"
}

try {
    Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 10 | Out-Null
} catch {
    Write-Error "AniList Manager is not reachable at $baseUrl. Start the app before running verification."
}

$cases = @(
    @{
        name = "High School DxD HERO"
        expectedTotal = 12
        expectedSub = 12
        expectedDub = 12
        entry = @{
            mediaId = 97767; malId = 34281; status = "COMPLETED"; title = "High School DxD HERO"
            romajiTitle = "High School DxD HERO"; englishTitle = "High School DxD HERO"; nativeTitle = $null
            synonyms = @("High School DxD 4th Season", "High School DxD Fourth Season")
            format = "TV"; mediaStatus = "FINISHED"; totalEpisodes = 13
        }
    },
    @{
        name = "Air"
        expectedTotal = 12
        entry = @{
            mediaId = 101; malId = 101; status = "COMPLETED"; title = "Air"; romajiTitle = "AIR"; englishTitle = "Air"
            nativeTitle = "AIR"; synonyms = @("Air TV"); format = "TV"; mediaStatus = "FINISHED"; totalEpisodes = 13
        }
    },
    @{
        name = "BEATLESS"
        expectedTotal = 20
        entry = @{
            mediaId = 100245; malId = 36516; status = "COMPLETED"; title = "BEATLESS"; romajiTitle = "BEATLESS"; englishTitle = "BEATLESS"
            nativeTitle = "BEATLESS"; synonyms = @(); format = "TV"; mediaStatus = "FINISHED"; totalEpisodes = 24
        }
    },
    @{
        name = "K-On!!"
        expectedTotal = 26
        forbiddenExact = @("K-On!")
        entry = @{
            mediaId = 7791; malId = 7791; status = "COMPLETED"; title = "K-ON! Season 2"; romajiTitle = "K-ON!!"; englishTitle = "K-ON! Season 2"
            nativeTitle = $null; synonyms = @("Keion 2", "K-On!!"); format = "TV"; mediaStatus = "FINISHED"; totalEpisodes = 26
        }
    },
    @{
        name = "Dragon Maid S"
        expectedTotal = 12
        forbiddenContains = @("Mini Dra EX")
        entry = @{
            mediaId = 107717; malId = 39247; status = "COMPLETED"; title = "Miss Kobayashi's Dragon Maid S"; romajiTitle = "Kobayashi-san Chi no Maidragon S"
            englishTitle = "Miss Kobayashi's Dragon Maid S"; nativeTitle = $null; synonyms = @("Kobayashi-san Chi no Maid Dragon S")
            format = "TV"; mediaStatus = "FINISHED"; totalEpisodes = 12
        }
    },
    @{
        name = "Mobile Suit Gundam 00"
        expectedTotal = 25
        forbiddenContains = @("CB Chara")
        entry = @{
            mediaId = 2581; malId = 2581; status = "COMPLETED"; title = "Mobile Suit Gundam 00"; romajiTitle = "Kidou Senshi Gundam 00"
            englishTitle = "Mobile Suit Gundam 00"; nativeTitle = $null; synonyms = @("Gundam 00")
            format = "TV"; mediaStatus = "FINISHED"; totalEpisodes = 25
        }
    },
    @{
        name = "My Hero Academia Season 2"
        expectedTotal = 25
        forbiddenExact = @("Boku no Hero Academia")
        entry = @{
            mediaId = 21856; malId = 33486; status = "COMPLETED"; title = "My Hero Academia Season 2"; romajiTitle = "Boku no Hero Academia 2"
            englishTitle = "My Hero Academia Season 2"; nativeTitle = $null; synonyms = @("Boku no Hero Academia 2nd Season")
            format = "TV"; mediaStatus = "FINISHED"; totalEpisodes = 25
        }
    },
    @{
        name = "My Hero Academia Season 5"
        expectedTotal = 25
        forbiddenExact = @("Boku no Hero Academia")
        entry = @{
            mediaId = 117193; malId = 41587; status = "COMPLETED"; title = "My Hero Academia Season 5"; romajiTitle = "Boku no Hero Academia 5"
            englishTitle = "My Hero Academia Season 5"; nativeTitle = $null; synonyms = @("Boku no Hero Academia 5th Season")
            format = "TV"; mediaStatus = "FINISHED"; totalEpisodes = 25
        }
    },
    @{
        name = "Higurashi"
        expectedTotal = 26
        forbiddenContains = @("Gou")
        entry = @{
            mediaId = 934; malId = 934; status = "COMPLETED"; title = "When They Cry"; romajiTitle = "Higurashi no Naku Koro ni"
            englishTitle = "When They Cry"; nativeTitle = $null; synonyms = @("Higurashi: When They Cry")
            format = "TV"; mediaStatus = "FINISHED"; totalEpisodes = 26
        }
    },
    @{
        name = "Fire Force Season 3 Part 2"
        expectedTotal = 13
        expectedSub = 13
        expectedDub = 13
        entry = @{
            mediaId = 179062; malId = 59229; status = "COMPLETED"; title = "Fire Force Season 3 Part 2"; romajiTitle = "Enen no Shouboutai: San no Shou Part 2"
            englishTitle = "Fire Force Season 3 Part 2"; nativeTitle = $null; synonyms = @("Enen no Shouboutai: San no Shou Part 2")
            format = "TV"; mediaStatus = "FINISHED"; totalEpisodes = 13
        }
    },
    @{
        name = "Dungeon II"
        expectedTotal = 13
        expectedSub = 13
        expectedDub = 13
        entry = @{
            mediaId = 20920; malId = 28121; status = "COMPLETED"; title = "Is It Wrong to Try to Pick Up Girls in a Dungeon?"; romajiTitle = "Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka"
            englishTitle = "Is It Wrong to Try to Pick Up Girls in a Dungeon?"; nativeTitle = $null; synonyms = @("DanMachi")
            format = "TV"; mediaStatus = "FINISHED"; totalEpisodes = 13
        }
    },
    @{
        name = "Parasite Dolls"
        expectedTotal = 3
        expectedSub = 3
        expectedDub = 3
        entry = @{
            mediaId = 1350; malId = 1350; status = "COMPLETED"; title = "Parasite Dolls"; romajiTitle = "Parasite Dolls"; englishTitle = "Parasite Dolls"
            nativeTitle = $null; synonyms = @(); format = "OVA"; mediaStatus = "FINISHED"; totalEpisodes = 3
        }
    },
    @{
        name = "Sonic the Hedgehog"
        expectedTotal = 3
        expectedSub = 3
        expectedDub = 3
        entry = @{
            mediaId = 2263; malId = 2263; status = "COMPLETED"; title = "Sonic the Hedgehog: The Movie"; romajiTitle = "Sonic the Hedgehog"; englishTitle = "Sonic the Hedgehog: The Movie"
            nativeTitle = $null; synonyms = @("Sonic the Hedgehog"); format = "OVA"; mediaStatus = "FINISHED"; totalEpisodes = 2
        }
    },
    @{
        name = "Strait Jacket"
        expectedTotal = 3
        expectedSub = 3
        expectedDub = 1
        expectedForceComplete = $true
        entry = @{
            mediaId = 3086; malId = 3086; status = "COMPLETED"; title = "Strait Jacket"; romajiTitle = "Strait Jacket"; englishTitle = "Strait Jacket"
            nativeTitle = $null; synonyms = @(); format = "OVA"; mediaStatus = "FINISHED"; totalEpisodes = 3
        }
    },
    @{
        name = "Gintama"
        expectedTotal = 201
        expectedSub = 201
        expectedDub = 201
        entry = @{
            mediaId = 918; malId = 918; status = "PLANNING"; title = "Gintama"; romajiTitle = "Gintama"; englishTitle = "Gintama"
            nativeTitle = $null; synonyms = @(); format = "TV"; mediaStatus = "FINISHED"; totalEpisodes = 201
        }
    },
    @{
        name = "Kite"
        expectedTotal = 2
        expectedSub = 2
        expectedDub = 2
        entry = @{
            mediaId = 320; malId = 320; status = "PLANNING"; title = "Kite"; romajiTitle = "A KITE"; englishTitle = "Kite"
            nativeTitle = $null; synonyms = @("A Kite"); format = "OVA"; mediaStatus = "FINISHED"; totalEpisodes = 2
        }
    },
    @{
        name = "Pretear"
        expectedTotal = 13
        expectedSub = 13
        expectedDub = 13
        entry = @{
            mediaId = 100; malId = 100; status = "PLANNING"; title = "Pretear: The New Legend of Snow White"; romajiTitle = "Shin Shirayuki-hime Densetsu Pretear"
            englishTitle = "Pretear: The New Legend of Snow White"; nativeTitle = $null; synonyms = @("Pretear")
            format = "TV"; mediaStatus = "FINISHED"; totalEpisodes = 13
        }
    },
    @{
        name = "Luo Xiaohei Zhanji"
        expectedTotal = 28
        expectedSub = 28
        expectedDub = 28
        entry = @{
            mediaId = 102663; malId = 33443; status = "PLANNING"; title = "The Legend of Luoxiaohei"; romajiTitle = "Luo Xiaohei Zhan Ji"
            englishTitle = "The Legend of Luoxiaohei"; nativeTitle = $null; synonyms = @("Luo Xiaohei Zhanji")
            format = "ONA"; mediaStatus = "FINISHED"; totalEpisodes = 28
        }
    },
    @{
        name = "Otaku NEET Kunoichi"
        expectedTotal = 24
        expectedSub = 13
        expectedDub = 13
        expectedDubCappedToSub = $true
        entry = @{
            mediaId = 174654; malId = 58082; status = "CURRENT"; title = "I'm Living With a Otaku NEET Kunoichi?!"; romajiTitle = "NEET Kunoichi to Nazeka Dousei Hajimemashita"
            englishTitle = "I'm Living With a Otaku NEET Kunoichi?!"; nativeTitle = $null; synonyms = @("NEET Kunoichi to Nazeka Dousei Hajimemashita")
            format = "TV"; mediaStatus = "FINISHED"; totalEpisodes = 24
        }
    },
    @{
        name = "Re:ZERO Season 4"
        expectedTotal = 19
        expectedSub = 7
        expectedDub = 7
        forbiddenExact = @("Re:Zero kara Hajimeru Isekai Seikatsu")
        entry = @{
            mediaId = 189046; malId = 61316; status = "CURRENT"; title = "Re:ZERO -Starting Life in Another World- Season 4"
            romajiTitle = "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season"; englishTitle = "Re:ZERO -Starting Life in Another World- Season 4"
            nativeTitle = $null
            synonyms = @("Re:ZERO -Starting Life in Another World- Season 4")
            format = "TV"; mediaStatus = "RELEASING"; totalEpisodes = 19
        }
    }
)

$body = @{
    refresh = $true
    force = $true
    entries = @($cases | ForEach-Object { $_.entry })
} | ConvertTo-Json -Depth 12

$response = Invoke-RestMethod -Uri "$baseUrl/api/availability/batch" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 180
$byId = @{}
foreach ($entry in $response.entries) {
    $byId[[int]$entry.mediaId] = $entry
}

$failures = [System.Collections.Generic.List[string]]::new()
foreach ($case in $cases) {
    $mediaId = [int]$case.entry.mediaId
    $result = $byId[$mediaId]
    if ($null -eq $result) {
        $failures.Add("$($case.name): missing result")
        continue
    }

    if ($case.expectedTotal -and [int]$result.totalEpisodes -ne [int]$case.expectedTotal) {
        $failures.Add("$($case.name): expected total $($case.expectedTotal), got $($result.totalEpisodes)")
    }
    if ($case.expectedSub -and [int]$result.subEpisodes -ne [int]$case.expectedSub) {
        $failures.Add("$($case.name): expected sub $($case.expectedSub), got $($result.subEpisodes)")
    }
    if ($case.expectedDub -and [int]$result.dubEpisodes -ne [int]$case.expectedDub) {
        $failures.Add("$($case.name): expected dub $($case.expectedDub), got $($result.dubEpisodes)")
    }
    if ($case.ContainsKey("expectedForceComplete") -and [bool]$result.forceComplete -ne [bool]$case.expectedForceComplete) {
        $failures.Add("$($case.name): expected forceComplete $($case.expectedForceComplete), got $($result.forceComplete)")
    }
    if ($case.ContainsKey("expectedDubCappedToSub") -and [string]$result.totalSource -ne "override" -and [bool]$result.dubCappedToSub -ne [bool]$case.expectedDubCappedToSub) {
        $failures.Add("$($case.name): expected dubCappedToSub $($case.expectedDubCappedToSub), got $($result.dubCappedToSub)")
    }

    $matchedTitle = [string]$result.matchedTitle
    if ($case.ContainsKey("forbiddenExact")) {
        foreach ($forbidden in @($case.forbiddenExact)) {
            if (-not [string]::IsNullOrWhiteSpace($forbidden) -and $matchedTitle -eq $forbidden) {
                $failures.Add("$($case.name): matched forbidden exact title '$matchedTitle'")
            }
        }
    }
    if ($case.ContainsKey("forbiddenContains")) {
        foreach ($forbidden in @($case.forbiddenContains)) {
            if (-not [string]::IsNullOrWhiteSpace($forbidden) -and $matchedTitle -like "*$forbidden*") {
                $failures.Add("$($case.name): matched forbidden title '$matchedTitle'")
            }
        }
    }

    [pscustomobject]@{
        Name = $case.name
        Total = $result.totalEpisodes
        Sub = $result.subEpisodes
        Dub = $result.dubEpisodes
        Matched = $result.matchedTitle
        Confidence = $result.matchConfidence
        TotalSource = $result.totalSource
        ForceComplete = $result.forceComplete
        DubCappedToSub = $result.dubCappedToSub
    }
}

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "Availability verification failed:" -ForegroundColor Red
    foreach ($failure in $failures) {
        Write-Host " - $failure" -ForegroundColor Red
    }
    exit 1
}

Write-Host ""
Write-Host "Availability verification passed." -ForegroundColor Green
