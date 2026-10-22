using Amazon;
using Amazon.Runtime;
using Amazon.SQS;
using Amazon.SQS.Model;
using ProcessadorDadosDistribuidosjoaojoseneto.Configuration;

namespace ProcessadorDadosDistribuidosjoaojoseneto.Infrastructure.Messaging;

public sealed class SqsQueueService
{
    private readonly AwsSqsOptions _options;
    private readonly AmazonSQSClient _client;
    private readonly SemaphoreSlim _queueLock = new(1, 1);
    private string? _queueUrl;

    public SqsQueueService(AwsSqsOptions options)
    {
        _options = options;

        var config = new AmazonSQSConfig
        {
            RegionEndpoint = RegionEndpoint.GetBySystemName(_options.Region),
            UseHttp = _options.ServiceUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase),
            ServiceURL = _options.ServiceUrl,
        };

        var credentials = new BasicAWSCredentials(_options.AccessKey, _options.SecretKey);
        _client = new AmazonSQSClient(credentials, config);
    }

    public async Task<string> EnsureQueueAsync()
    {
        if (!string.IsNullOrWhiteSpace(_queueUrl))
        {
            return _queueUrl;
        }

        await _queueLock.WaitAsync();
        try
        {
            if (!string.IsNullOrWhiteSpace(_queueUrl))
            {
                return _queueUrl;
            }

            var queueUrl = await GetQueueUrlAsync(_options.QueueName);
            if (string.IsNullOrWhiteSpace(queueUrl))
            {
                queueUrl = await CreateQueueAsync(_options.QueueName);
            }

            _queueUrl = queueUrl;
            return _queueUrl;
        }
        finally
        {
            _queueLock.Release();
        }
    }

    public async Task<string> SendMessageAsync(string payload, string groupId = "default", string? deduplicationId = null)
    {
        var queueUrl = await EnsureQueueAsync();
        var request = new SendMessageRequest
        {
            QueueUrl = queueUrl,
            MessageBody = payload,
            MessageGroupId = groupId,
            MessageDeduplicationId = deduplicationId ?? Guid.NewGuid().ToString("N"),
        };

        var response = await _client.SendMessageAsync(request);
        return response.MessageId;
    }

    public async Task<List<Message>> ReceiveMessagesAsync(int maxMessages = 10, int visibilityTimeoutSeconds = 30)
    {
        var queueUrl = await EnsureQueueAsync();
        var response = await _client.ReceiveMessageAsync(new ReceiveMessageRequest
        {
            QueueUrl = queueUrl,
            MaxNumberOfMessages = maxMessages,
            VisibilityTimeout = visibilityTimeoutSeconds,
            WaitTimeSeconds = 5,
        });

        return response.Messages;
    }

    public async Task DeleteMessageAsync(string receiptHandle)
    {
        var queueUrl = await EnsureQueueAsync();
        await _client.DeleteMessageAsync(new DeleteMessageRequest
        {
            QueueUrl = queueUrl,
            ReceiptHandle = receiptHandle,
        });
    }

    private async Task<string> GetQueueUrlAsync(string queueName)
    {
        try
        {
            var response = await _client.GetQueueUrlAsync(queueName);
            return response.QueueUrl;
        }
        catch (QueueDoesNotExistException)
        {
            return string.Empty;
        }
    }

    private async Task<string> CreateQueueAsync(string queueName)
    {
        if (!queueName.EndsWith(".fifo", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("A fila SQS precisa terminar com '.fifo' para uso em LocalStack/FIFO.");
        }

        var response = await _client.CreateQueueAsync(new CreateQueueRequest
        {
            QueueName = queueName,
            Attributes = new Dictionary<string, string>
            {
                { "FifoQueue", "true" },
                { "ContentBasedDeduplication", "true" },
            },
        });

        return response.QueueUrl;
    }
}
