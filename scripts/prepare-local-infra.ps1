param(
    [string]$ComposeFile = "../docker-compose.yml"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composePath = (Resolve-Path (Join-Path $repoRoot $ComposeFile)).Path

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker CLI nao foi encontrado no PATH. Instale o Docker Desktop ou o Docker Engine antes de continuar."
}

docker compose -f $composePath up -d postgres localstack
Start-Sleep -Seconds 8

$env:AWS_ACCESS_KEY_ID = "test"
$env:AWS_SECRET_ACCESS_KEY = "test"
$env:AWS_DEFAULT_REGION = "us-east-1"

$queueName = "wager-transactions.fifo"
$endpoint = "http://localhost:4566"

aws --endpoint-url $endpoint sqs create-queue --queue-name $queueName --attributes FifoQueue=true,ContentBasedDeduplication=true --region us-east-1 --output json | Out-Null

Write-Host "Infraestrutura local pronta."
Write-Host "PostgreSQL: postgresql://wager:wager@localhost:5432/wagering"
Write-Host "LocalStack SQS: $endpoint"
Write-Host "Fila: $queueName"
