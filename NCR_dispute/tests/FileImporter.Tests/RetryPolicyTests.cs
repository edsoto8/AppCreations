using FileImporter.Core.Configuration;
using FileImporter.Core.Infrastructure;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace FileImporter.Tests;

public sealed class RetryPolicyTests
{
    private static RetryPolicy Policy(int maxAttempts) =>
        new(Options.Create(new RetryOptions { MaxAttempts = maxAttempts, InitialDelaySeconds = 0 }), TimeProvider.System, NullLogger<RetryPolicy>.Instance);

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task ExecuteAsync_TransientErrorThenSuccess_ReturnsResult()
    {
        var calls = 0;

        var result = await Policy(3).ExecuteAsync("test", _ =>
        {
            calls++;
            return calls < 3 ? throw new TimeoutException() : Task.FromResult(42);
        }, Ct);

        Assert.Equal(42, result);
        Assert.Equal(3, calls);
    }

    [Fact]
    public async Task ExecuteAsync_TransientErrorEveryTime_GivesUpAfterMaxAttempts()
    {
        var calls = 0;

        await Assert.ThrowsAsync<IOException>(() => Policy(3).ExecuteAsync("test", _ =>
        {
            calls++;
            throw new IOException("locked");
        }, Ct));

        Assert.Equal(3, calls);
    }

    [Fact]
    public async Task ExecuteAsync_NonTransientError_IsNotRetried()
    {
        var calls = 0;

        await Assert.ThrowsAsync<InvalidOperationException>(() => Policy(5).ExecuteAsync("test", _ =>
        {
            calls++;
            throw new InvalidOperationException();
        }, Ct));

        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task ExecuteAsync_SingleAttempt_DoesNotRetry()
    {
        var calls = 0;

        await Assert.ThrowsAsync<TimeoutException>(() => Policy(1).ExecuteAsync("test", _ =>
        {
            calls++;
            throw new TimeoutException();
        }, Ct));

        Assert.Equal(1, calls);
    }

    [Theory]
    [InlineData(typeof(TimeoutException), true)]
    [InlineData(typeof(IOException), true)]
    [InlineData(typeof(FileNotFoundException), false)]
    [InlineData(typeof(DirectoryNotFoundException), false)]
    [InlineData(typeof(UnauthorizedAccessException), false)]
    [InlineData(typeof(InvalidOperationException), false)]
    public void IsTransient_ClassifiesExceptions(Type exceptionType, bool expected)
    {
        Assert.Equal(expected, RetryPolicy.IsTransient((Exception)Activator.CreateInstance(exceptionType)!));
    }
}
