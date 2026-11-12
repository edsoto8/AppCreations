using System.Buffers;
using System.Diagnostics;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using System.Text;
using System.Text.Json;

namespace DotNet11Lab.Web.Labs.AspNetCore;

/// <summary>One request/response round trip as shown by the playground.</summary>
public sealed record PlaygroundExchange(
    string Method,
    Uri Url,
    IReadOnlyList<KeyValuePair<string, string>> RequestHeaders,
    string? RequestBody,
    int? StatusCode,
    string? ReasonPhrase,
    IReadOnlyList<KeyValuePair<string, string>> ResponseHeaders,
    string ResponseBody,
    bool ResponseTruncated,
    string? ContentType,
    TimeSpan Elapsed,
    string? Error)
{
    public bool IsSuccess => StatusCode is >= 200 and < 300;
}

/// <summary>
/// Sends real HTTP requests from the Blazor circuit to this application's own /api endpoints.
/// <para>
/// SSRF guard: the target host is never taken from the client. <c>NavigationManager.BaseUri</c> is supplied by
/// the browser when a circuit starts, so trusting it would let a crafted client make the server call arbitrary
/// hosts. The base address is instead the configured <c>ApiPlayground:BaseAddress</c> or the address Kestrel is
/// actually bound to; only relative paths under /api/ and /openapi/ are accepted, and redirects are not followed.
/// </para>
/// </summary>
public sealed class ApiPlaygroundClient(IHttpClientFactory httpClientFactory, IServer server, IConfiguration configuration)
{
    public const string HttpClientName = "lab3-playground";
    public const int MaxRequestBodyChars = 32 * 1024;
    public const int MaxResponseChars = 256 * 1024;
    private static readonly string[] AllowedMethods = ["GET", "POST", "PUT", "DELETE"];
    private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

    public static string? ValidateRequest(string method, string path, string? body)
    {
        if (!AllowedMethods.Contains(method, StringComparer.Ordinal)) return $"Method must be one of {string.Join(", ", AllowedMethods)}.";
        if (!(path.StartsWith("/api/", StringComparison.Ordinal) || path.StartsWith("/openapi/", StringComparison.Ordinal)) || path.Contains("://", StringComparison.Ordinal) || path.Contains("..", StringComparison.Ordinal))
            return "Path must be a relative path under /api/ or /openapi/.";
        if (body is { Length: > MaxRequestBodyChars }) return $"Body is limited to {MaxRequestBodyChars / 1024} KB.";
        return null;
    }

    /// <summary>The server's own address that playground requests are sent to, or null if it cannot be determined.</summary>
    public Uri? BaseAddress => ResolveBaseAddress(configuration["ApiPlayground:BaseAddress"], server.Features.Get<IServerAddressesFeature>()?.Addresses);

    /// <summary>Picks the configured address, else the first bound http(s) address with wildcard hosts mapped to localhost.</summary>
    public static Uri? ResolveBaseAddress(string? configured, IEnumerable<string>? boundAddresses)
    {
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return Uri.TryCreate(configured, UriKind.Absolute, out var c) && c.Scheme is "http" or "https" ? WithTrailingSlash(c) : null;
        }
        var bound = (boundAddresses ?? []).ToList();
        var chosen = bound.FirstOrDefault(a => a.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) ?? bound.FirstOrDefault();
        if (chosen is null) return null;
        // Kestrel reports wildcard bindings verbatim (http://+:80, http://*:80, http://0.0.0.0:80, http://[::]:80).
        chosen = chosen.Replace("://+", "://localhost").Replace("://*", "://localhost")
                       .Replace("://0.0.0.0", "://localhost").Replace("://[::]", "://localhost");
        return Uri.TryCreate(chosen, UriKind.Absolute, out var u) && u.Scheme is "http" or "https" ? WithTrailingSlash(u) : null;
    }

    private static Uri WithTrailingSlash(Uri u) => u.AbsoluteUri.EndsWith('/') ? u : new Uri(u.AbsoluteUri + "/");

    public async Task<PlaygroundExchange> SendAsync(string method, string path, string? body, CancellationToken cancellationToken)
    {
        var baseUri = BaseAddress;
        if (baseUri is null)
        {
            return Failed(method, new Uri("http://localhost/"), [], null, TimeSpan.Zero,
                "Could not determine this server's own address. Set ApiPlayground:BaseAddress (e.g. http://localhost:5180/).");
        }
        var url = new Uri(baseUri, path.TrimStart('/'));
        var sendBody = method is "GET" or "DELETE" || string.IsNullOrWhiteSpace(body) ? null : body;
        var problem = ValidateRequest(method, path, body);
        if (problem is not null) return Failed(method, url, [], sendBody, TimeSpan.Zero, problem);

        using var request = new HttpRequestMessage(new HttpMethod(method), url);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/problem+json"));
        if (sendBody is not null) request.Content = new StringContent(sendBody, Encoding.UTF8, "application/json");
        var requestHeaders = Flatten(request.Headers, request.Content?.Headers);

        var client = httpClientFactory.CreateClient(HttpClientName);
        var stopwatch = Stopwatch.StartNew();
        try
        {
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            var (text, truncated) = await ReadCappedAsync(response.Content, cancellationToken);
            stopwatch.Stop();
            var contentType = response.Content.Headers.ContentType?.MediaType;
            return new PlaygroundExchange(method, url, requestHeaders, sendBody, (int)response.StatusCode, response.ReasonPhrase,
                Flatten(response.Headers, response.Content.Headers), truncated ? text : Pretty(text, contentType), truncated, contentType, stopwatch.Elapsed, null);
        }
        catch (HttpRequestException ex)
        {
            return Failed(method, url, requestHeaders, sendBody, stopwatch.Elapsed,
                $"Could not reach {url.GetLeftPart(UriPartial.Authority)}: {ex.Message}. The playground calls the address this server is bound to; set ApiPlayground:BaseAddress if that is not reachable from the server itself.");
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Failed(method, url, requestHeaders, sendBody, stopwatch.Elapsed, "The request timed out.");
        }
    }

    /// <summary>Pretty-prints JSON bodies; other content is returned unchanged.</summary>
    public static string Pretty(string text, string? contentType)
    {
        if (contentType is null || !contentType.Contains("json", StringComparison.OrdinalIgnoreCase) || text.Length == 0) return text;
        try
        {
            using var doc = JsonDocument.Parse(text);
            return JsonSerializer.Serialize(doc.RootElement, Indented);
        }
        catch (JsonException)
        {
            return text;
        }
    }

    private static async Task<(string Text, bool Truncated)> ReadCappedAsync(HttpContent content, CancellationToken cancellationToken)
    {
        await using var stream = await content.ReadAsStreamAsync(cancellationToken);
        using var reader = new StreamReader(stream, Encoding.UTF8);
        // Pooled buffer: a fresh 512 KB char[] per request would land on the large object heap every time.
        var buffer = ArrayPool<char>.Shared.Rent(MaxResponseChars + 1);
        try
        {
            var read = 0;
            int n;
            while (read <= MaxResponseChars && (n = await reader.ReadAsync(buffer.AsMemory(read, MaxResponseChars + 1 - read), cancellationToken)) > 0) read += n;
            return read > MaxResponseChars ? (new string(buffer, 0, MaxResponseChars), true) : (new string(buffer, 0, read), false);
        }
        finally
        {
            ArrayPool<char>.Shared.Return(buffer);
        }
    }

    private static List<KeyValuePair<string, string>> Flatten(HttpHeaders headers, HttpHeaders? contentHeaders) =>
        headers.Concat(contentHeaders ?? Enumerable.Empty<KeyValuePair<string, IEnumerable<string>>>())
            .Select(h => new KeyValuePair<string, string>(h.Key, string.Join(", ", h.Value)))
            .ToList();

    private static PlaygroundExchange Failed(string method, Uri url, IReadOnlyList<KeyValuePair<string, string>> headers, string? body, TimeSpan elapsed, string error) =>
        new(method, url, headers, body, null, null, [], "", false, null, elapsed, error);
}
