using Microsoft.Extensions.Options;
using ProcessadorDadosDistribuidosjoaojoseneto.Client.Pages;
using ProcessadorDadosDistribuidosjoaojoseneto.Components;
using ProcessadorDadosDistribuidosjoaojoseneto.Configuration;
using ProcessadorDadosDistribuidosjoaojoseneto.Infrastructure.Messaging;
using ProcessadorDadosDistribuidosjoaojoseneto.Infrastructure.Postgres;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<PostgresOptions>(builder.Configuration.GetSection("Postgres"));
builder.Services.Configure<AwsSqsOptions>(builder.Configuration.GetSection("Sqs"));

builder.Services.AddSingleton(sp =>
{
    var options = sp.GetRequiredService<IOptions<PostgresOptions>>().Value;
    return new PostgresDatabaseService(options);
});

builder.Services.AddSingleton(sp =>
{
    var options = sp.GetRequiredService<IOptions<AwsSqsOptions>>().Value;
    return new SqsQueueService(options);
});

builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents()
    .AddInteractiveWebAssemblyComponents();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var database = scope.ServiceProvider.GetRequiredService<PostgresDatabaseService>();
    await database.InitializeAsync();

    var sqs = scope.ServiceProvider.GetRequiredService<SqsQueueService>();
    await sqs.EnsureQueueAsync();
}

if (app.Environment.IsDevelopment())
{
    app.UseWebAssemblyDebugging();
}
else
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseAntiforgery();

app.MapGet("/health", async (PostgresDatabaseService database, SqsQueueService sqs) =>
{
    var dbOk = await database.PingAsync();
    var queueUrl = await sqs.EnsureQueueAsync();

    return Results.Ok(new
    {
        database = dbOk,
        queue = queueUrl,
        status = "ok"
    });
});

app.MapPost("/messages/send", async (SqsQueueService sqs, HttpRequest request) =>
{
    var payload = await new StreamReader(request.Body).ReadToEndAsync();
    var messageId = await sqs.SendMessageAsync(payload, "app", Guid.NewGuid().ToString("N"));
    return Results.Ok(new { messageId });
});

app.MapGet("/messages/receive", async (SqsQueueService sqs) =>
{
    var messages = await sqs.ReceiveMessagesAsync(5);
    return Results.Ok(messages.Select(m => new
    {
        id = m.MessageId,
        body = m.Body,
        receiptHandle = m.ReceiptHandle,
        attributes = m.Attributes,
    }));
});

app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode()
    .AddInteractiveWebAssemblyRenderMode()
    .AddAdditionalAssemblies(typeof(ProcessadorDadosDistribuidosjoaojoseneto.Client._Imports).Assembly);

app.Run();
