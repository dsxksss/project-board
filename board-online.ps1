$cliArguments = @($args)
$previousProfile = $env:BOARD_PROFILE

try {
    if (-not $previousProfile) {
        $codexDir = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
        $env:BOARD_PROFILE = Join-Path $codexDir 'project-board-access/owner.json'
    }
    & node (Join-Path $PSScriptRoot 'board.mjs') @cliArguments
    $cliExitCode = $LASTEXITCODE
} finally {
    $env:BOARD_PROFILE = $previousProfile
}

exit $cliExitCode
