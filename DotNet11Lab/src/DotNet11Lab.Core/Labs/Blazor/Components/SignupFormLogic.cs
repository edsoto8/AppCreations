using System.Linq.Expressions;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Forms;

namespace DotNet11Lab.Core.Labs.Blazor.Components;

public enum FieldState { Untouched, Pending, Valid, Invalid, Faulted }

/// <summary>
/// Logic of the .NET 11 sign-up form (markup in DotNet11Lab.Web). Lives in Core so the dashboard can show it as the
/// code that runs. The form uses &lt;DataAnnotationsValidator /&gt;, which in .NET 11 runs the async attributes.
/// </summary>
public abstract class AsyncSignupFormBase : ComponentBase, IDisposable
{
    [Inject] protected AccountDirectory Accounts { get; set; } = default!;
    [Inject] protected BlazorLabState LabState { get; set; } = default!;

    protected SignupModel Model { get; private set; } = new();
    protected EditContext EditContext { get; private set; } = default!;
    protected string? Outcome { get; private set; }
    protected TimeSpan? SubmitDuration { get; private set; }

    protected override void OnInitialized() => Reset();

    // <snippet:Blazor.PendingState>
    /// <summary>Per-field status for the UI. IsValidationPending/IsValidationFaulted are new on EditContext in .NET 11.</summary>
    protected FieldState StateOf(Expression<Func<string?>> field)
    {
        var id = FieldIdentifier.Create(field);
        if (EditContext.IsValidationPending(id)) return FieldState.Pending;   // async validator still running
        if (EditContext.IsValidationFaulted(id)) return FieldState.Faulted;   // async validator threw
        if (!EditContext.IsModified(id)) return FieldState.Untouched;
        return EditContext.IsValid(id) ? FieldState.Valid : FieldState.Invalid;
    }

    /// <summary>
    /// True while any async check runs. The parameterless IsValidationPending() was observed to stay false while only a
    /// field-level check is pending, so the fields are asked individually as well.
    /// </summary>
    protected bool AnyValidationPending =>
        EditContext.IsValidationPending()
        || EditContext.IsValidationPending(() => Model.Username)
        || EditContext.IsValidationPending(() => Model.Email)
        || EditContext.IsValidationPending(() => Model.InviteCode);

    /// <summary>EditForm awaits every async validator before calling OnValidSubmit, in any render mode.</summary>
    protected Task OnValidSubmitAsync(EditContext context)
    {
        Outcome = Accounts.TryRegister(Model.Username!, Model.Email!)
            ? $"Account '{Model.Username}' created. Try the same username again: it is now taken."
            : "Someone registered that name a moment ago; validation is advisory, the write is the source of truth.";
        LabState.Record("Async form", Outcome);
        return Task.CompletedTask;
    }
    // </snippet:Blazor.PendingState>

    protected void Reset()
    {
        if (EditContext is not null) EditContext.OnValidationStateChanged -= OnValidationStateChanged;
        Model = new SignupModel();
        EditContext = new EditContext(Model);
        // Async results arrive after the input event has rendered; re-render when the validation state changes.
        EditContext.OnValidationStateChanged += OnValidationStateChanged;
        Outcome = null;
    }

    private void OnValidationStateChanged(object? sender, ValidationStateChangedEventArgs e) => _ = InvokeAsync(StateHasChanged);

    public void Dispose()
    {
        EditContext.OnValidationStateChanged -= OnValidationStateChanged;
        GC.SuppressFinalize(this);
    }
}

/// <summary>The .NET 10 approach: sync attributes in the validator, async checks written by hand in the submit handler.</summary>
public abstract class LegacySignupFormBase : ComponentBase, IDisposable
{
    [Inject] protected AccountDirectory Accounts { get; set; } = default!;
    [Inject] protected BlazorLabState LabState { get; set; } = default!;

    protected LegacySignupModel Model { get; } = new();
    protected EditContext EditContext { get; private set; } = default!;
    protected bool Checking { get; private set; }
    protected string? Outcome { get; private set; }
    private ValidationMessageStore _serverErrors = default!;

    protected override void OnInitialized()
    {
        EditContext = new EditContext(Model);
        _serverErrors = new ValidationMessageStore(EditContext);
        EditContext.OnFieldChanged += ClearServerErrorForField;
    }

    // <snippet:Blazor.LegacyManualAsync>
    /// <summary>
    /// Before .NET 11: DataAnnotationsValidator ran only the sync attributes, so availability checks were written in
    /// OnValidSubmit, errors pushed into a ValidationMessageStore by hand, and the "checking" state tracked manually.
    /// </summary>
    protected async Task OnValidSubmitAsync(EditContext context)
    {
        _serverErrors.Clear();
        Checking = true;
        StateHasChanged();
        try
        {
            // Sequential unless you also hand-write Task.WhenAll; no framework-owned cancellation of stale checks.
            if (!await Accounts.IsUsernameAvailableAsync(Model.Username!, CancellationToken.None))
                _serverErrors.Add(context.Field(nameof(Model.Username)), $"The username '{Model.Username}' is already taken.");
            if (await Accounts.IsEmailRegisteredAsync(Model.Email!, CancellationToken.None))
                _serverErrors.Add(context.Field(nameof(Model.Email)), $"An account already uses {Model.Email}.");
            if (Model.InviteCode is { Length: > 0 } code)
            {
                var domain = await Accounts.FindInviteDomainAsync(code, CancellationToken.None);
                if (domain is null) _serverErrors.Add(context.Field(nameof(Model.InviteCode)), $"Invite code {code} does not exist.");
                else if (!Model.Email!.EndsWith("@" + domain, StringComparison.OrdinalIgnoreCase))
                    _serverErrors.Add(context.Field(nameof(Model.InviteCode)), $"Invite code {code} is for @{domain} addresses.");
            }
        }
        finally
        {
            Checking = false;
        }
        context.NotifyValidationStateChanged();
        if (context.GetValidationMessages().Any()) return;

        Outcome = Accounts.TryRegister(Model.Username!, Model.Email!) ? $"Account '{Model.Username}' created (manual checks)." : "Registration lost a race.";
        LabState.Record("Legacy form", Outcome);
    }

    /// <summary>Hand-written errors are not cleared by the validator; drop them when the user edits the field.</summary>
    private void ClearServerErrorForField(object? sender, FieldChangedEventArgs e)
    {
        _serverErrors.Clear(e.FieldIdentifier);
        EditContext.NotifyValidationStateChanged();
    }
    // </snippet:Blazor.LegacyManualAsync>

    public void Dispose()
    {
        EditContext.OnFieldChanged -= ClearServerErrorForField;
        GC.SuppressFinalize(this);
    }
}
