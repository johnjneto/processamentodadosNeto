using Npgsql;

namespace ProcessadorDadosDistribuidosjoaojoseneto.Infrastructure.Postgres;

using ProcessadorDadosDistribuidosjoaojoseneto.Configuration;

public sealed class PostgresDatabaseService
{
    private readonly PostgresOptions _options;

    public PostgresDatabaseService(PostgresOptions options)
    {
        _options = options;
    }

    public string ConnectionString => _options.GetConnectionString();

    public async Task InitializeAsync()
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();

        await using var command = new NpgsqlCommand(
            @"
            CREATE TABLE IF NOT EXISTS app_events (
                id SERIAL PRIMARY KEY,
                source TEXT NOT NULL,
                payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            ",
            connection);

        await command.ExecuteNonQueryAsync();
    }

    public async Task<bool> PingAsync()
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        return connection.State == System.Data.ConnectionState.Open;
    }

    public async Task<int> ExecuteAsync(string sql, IDictionary<string, object?>? parameters = null)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();

        await using var command = new NpgsqlCommand(sql, connection);
        if (parameters is not null)
        {
            foreach (var parameter in parameters)
            {
                command.Parameters.AddWithValue(parameter.Key, parameter.Value ?? DBNull.Value);
            }
        }

        return await command.ExecuteNonQueryAsync();
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> QueryAsync(string sql, IDictionary<string, object?>? parameters = null)
    {
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();

        await using var command = new NpgsqlCommand(sql, connection);
        if (parameters is not null)
        {
            foreach (var parameter in parameters)
            {
                command.Parameters.AddWithValue(parameter.Key, parameter.Value ?? DBNull.Value);
            }
        }

        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<Dictionary<string, object?>>();

        while (await reader.ReadAsync())
        {
            var row = new Dictionary<string, object?>();
            for (var i = 0; i < reader.FieldCount; i++)
            {
                row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            }

            rows.Add(row);
        }

        return rows;
    }
}
