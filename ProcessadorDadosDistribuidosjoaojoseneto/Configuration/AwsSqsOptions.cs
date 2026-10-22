namespace ProcessadorDadosDistribuidosjoaojoseneto.Configuration;

public sealed class AwsSqsOptions
{
    public string ServiceUrl { get; set; } = "http://localhost:4566";
    public string Region { get; set; } = "us-east-1";
    public string QueueName { get; set; } = "wager-transactions.fifo";
    public string AccessKey { get; set; } = "test";
    public string SecretKey { get; set; } = "test";
    public bool UseLocalStack { get; set; } = true;
}
