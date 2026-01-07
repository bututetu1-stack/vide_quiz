# Simple HTTP Server for Vibe Quiz
# Run this script to start the local server
# Usage: Right-click > Run with PowerShell

$port = 8000
$root = Get-Location
$url = "http://localhost:$port/"

Write-Host "Started HTTP Server at $url" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
$listener.Start()

Start-Process $url

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $path = $request.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrEmpty($path)) { $path = "index.html" }
        
        $localPath = Join-Path $root $path
        
        if (Test-Path $localPath) {
            $content = [System.IO.File]::ReadAllBytes($localPath)
            $response.ContentLength64 = $content.Length
            
            # Simple MIME types
            switch ([System.IO.Path]::GetExtension($localPath)) {
                ".html" { $response.ContentType = "text/html; charset=utf-8" }
                ".js" { $response.ContentType = "application/javascript" }
                ".css" { $response.ContentType = "text/css" }
            }
            
            $response.OutputStream.Write($content, 0, $content.Length)
        }
        else {
            $response.StatusCode = 404
        }
        
        $response.Close()
    }
}
finally {
    $listener.Stop()
}
