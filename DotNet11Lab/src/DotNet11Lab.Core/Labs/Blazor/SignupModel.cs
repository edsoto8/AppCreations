using System.Collections.Concurrent;
using System.ComponentModel.DataAnnotations;
using System.Runtime.CompilerServices;
using Microsoft.Extensions.DependencyInjection;

namespace DotNet11Lab.Core.Labs.Blazor;

public sealed class AccountDirectoryOptions
{
    /// <summary>Simulated round trip of the availability service. Long enough to see the pending state.</summary>
    public TimeSpan Latency { get; set; } = TimeSpan.FromMilliseconds(700);
}

/// <summary>
/// In-memory user store standing in for an identity service. Lookups are async, slow and cancellable.
/// Registrations made through the demo are kept (capped) so a name becomes "taken" after you sign up with it.
/// </summary>
public sealed class AccountDirectory(AccountDirectoryOptions options, TimeProvider time)
{
    public const int MaxRegistrations = 1_000;

    private static readonly string[] SeedUsernames = ["admin", "root", "ada", "grace", "linus", "satya", "dotnet", "blazor"];
    private static readonly string[] SeedEmails = ["ada@example.com", "grace@example.com", "team@contoso.com"];
    private static readonly Dictionary<string, string> Invites = new(StringComparer.OrdinalIgnoreCase)
    {
        ["CONTOSO-2026"] = "contoso.com",
        ["FABRIKAM-BETA"] = "fabrikam.com",
    };

    private readonly ConcurrentDictionary<string, byte> _usernames = new(SeedUsernames.Select(u => KeyValuePair.Create(u, (byte)0)), StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, byte> _emails = new(SeedEmails.Select(e => KeyValuePair.Create(e, (byte)0)), StringComparer.OrdinalIgnoreCase);
    private int _calls;

    /// <summary>Number of lookups served (shows how often validation actually hit the "service").</summary>
    public int Calls => Volatile.Read(ref _calls);

    public async Task<bool> IsUsernameAvailableAsync(string username, CancellationToken cancellationToken)
    {
        await DelayAsync(cancellationToken);
        return !_usernames.ContainsKey(username);
    }

    public async Task<bool> IsEmailRegisteredAsync(string email, CancellationToken cancellationToken)
    {
        await DelayAsync(cancellationToken);
        return _emails.ContainsKey(email);
    }

    /// <summary>Domain an invite code is restricted to, or null when the code does not exist.</summary>
    public async Task<string?> FindInviteDomainAsync(string code, CancellationToken cancellationToken)
    {
        await DelayAsync(cancellationToken);
        return Invites.GetValueOrDefault(code);
    }

    public bool TryRegister(string username, string email)
    {
        if (_usernames.Count >= SeedUsernames.Length + MaxRegistrations) return false;
        if (!_usernames.TryAdd(username, 0)) return false;
        _emails.TryAdd(email, 0);
        return true;
    }

    private Task DelayAsync(CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref _calls);
        return options.Latency <= TimeSpan.Zero ? Task.CompletedTask : Task.Delay(options.Latency, time, cancellationToken);
    }
}

// <snippet:Blazor.UsernameAvailable>
/// <summary>Async attribute: the same type works in Blazor forms, Minimal APIs and Validator.*Async.</summary>
[AttributeUsage(AttributeTargets.Property)]
public sealed class UsernameAvailableAttribute() : AsyncValidationAttribute("The username '{0}' is already taken.")
{
    protected override async Task<ValidationResult?> IsValidAsync(object? value, ValidationContext context, CancellationToken cancellationToken)
    {
        if (value is not string name || name.Length == 0) return ValidationResult.Success;
        var accounts = context.GetRequiredService<AccountDirectory>();
        return await accounts.IsUsernameAvailableAsync(name, cancellationToken)
            ? ValidationResult.Success
            : new ValidationResult(FormatErrorMessage(name), [context.MemberName!]);
    }

    protected override ValidationResult IsValid(object? value, ValidationContext validationContext) =>
        throw new NotSupportedException("Username availability can only be checked asynchronously.");
}
// </snippet:Blazor.UsernameAvailable>

[AttributeUsage(AttributeTargets.Property)]
public sealed class EmailNotRegisteredAttribute() : AsyncValidationAttribute("An account already uses {0}.")
{
    protected override async Task<ValidationResult?> IsValidAsync(object? value, ValidationContext context, CancellationToken cancellationToken)
    {
        if (value is not string email || email.Length == 0) return ValidationResult.Success;
        var accounts = context.GetRequiredService<AccountDirectory>();
        return await accounts.IsEmailRegisteredAsync(email, cancellationToken)
            ? new ValidationResult(FormatErrorMessage(email), [context.MemberName!])
            : ValidationResult.Success;
    }

    protected override ValidationResult IsValid(object? value, ValidationContext validationContext) =>
        throw new NotSupportedException("Email registration can only be checked asynchronously.");
}

// <snippet:Blazor.SignupModel>
public sealed class SignupModel : IAsyncValidatableObject
{
    [Required, StringLength(20, MinimumLength = 3), RegularExpression("^[a-zA-Z0-9_]+$", ErrorMessage = "Letters, digits and underscores only.")]
    [UsernameAvailable]
    public string? Username { get; set; }

    [Required, EmailAddress, EmailNotRegistered]
    public string? Email { get; set; }

    [Required, StringLength(64, MinimumLength = 8)]
    public string? Password { get; set; }

    [StringLength(20)]
    public string? InviteCode { get; set; }

    /// <summary>Cross-field and async: an invite code only works for its company's email domain.</summary>
    public async IAsyncEnumerable<ValidationResult> ValidateAsync(ValidationContext context, [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        if (InviteCode is not { Length: > 0 } || Email is null) yield break;
        var domain = await context.GetRequiredService<AccountDirectory>().FindInviteDomainAsync(InviteCode, cancellationToken);
        if (domain is null)
            yield return new ValidationResult($"Invite code {InviteCode} does not exist.", [nameof(InviteCode)]);
        else if (!Email.EndsWith("@" + domain, StringComparison.OrdinalIgnoreCase))
            yield return new ValidationResult($"Invite code {InviteCode} is for @{domain} addresses.", [nameof(InviteCode)]);
    }

    public IEnumerable<ValidationResult> Validate(ValidationContext context) => [];
}
// </snippet:Blazor.SignupModel>

/// <summary>.NET 10-style model: only synchronous attributes; availability is checked by hand on submit.</summary>
public sealed class LegacySignupModel
{
    [Required, StringLength(20, MinimumLength = 3), RegularExpression("^[a-zA-Z0-9_]+$", ErrorMessage = "Letters, digits and underscores only.")]
    public string? Username { get; set; }

    [Required, EmailAddress]
    public string? Email { get; set; }

    [Required, StringLength(64, MinimumLength = 8)]
    public string? Password { get; set; }

    [StringLength(20)]
    public string? InviteCode { get; set; }
}
