namespace ProcessadorDadosDistribuidosjoaojoseneto.Configuration;

public sealed class PostgresOptions
{
    public string Host { get; set; } = "localhost";
    public int Port { get; set; } = 5432;
    public string Database { get; set; } = "wagering";
    public string User { get; set; } = "wager";
    public string Password { get; set; } = "wager";

    public string GetConnectionString()
    {
        return $"Host={Host};Port={Port};Database={Database};Username={User};Password={Password};Include Error Detail=true;";
    }
}
