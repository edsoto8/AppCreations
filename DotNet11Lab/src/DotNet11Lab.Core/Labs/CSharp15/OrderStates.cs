using System.Reflection;
using System.Runtime.CompilerServices;

namespace DotNet11Lab.Core.Labs.CSharp15;

// <snippet:CSharp15.OrderStates>
// 'closed' = implicitly abstract + every subclass must live in this assembly,
// so the compiler knows the complete list and switches need no '_' arm.
public closed record OrderState;
public sealed record Draft(int Lines) : OrderState;
public sealed record Submitted(int Lines, DateTimeOffset SubmittedAt) : OrderState;
public sealed record Paid(decimal Amount, string PaymentReference) : OrderState;
public sealed record Shipped(string TrackingNumber) : OrderState;
public sealed record Cancelled(string Reason, string CancelledFrom) : OrderState;

public closed record OrderCommand;
public sealed record AddLine : OrderCommand;
public sealed record Submit : OrderCommand;
public sealed record Pay(decimal Amount) : OrderCommand;
public sealed record Ship(string Carrier) : OrderCommand;
public sealed record Cancel(string Reason) : OrderCommand;
// </snippet:CSharp15.OrderStates>

public sealed record TransitionRejected(string Reason);

// A union whose cases are a closed hierarchy and a plain record: either the next state or why not.
public union TransitionResult(OrderState, TransitionRejected);

public static class OrderStateMachine
{
    // <snippet:CSharp15.Transition>
    public static TransitionResult Apply(OrderState state, OrderCommand command, TimeProvider clock) => state switch
    {
        Draft d => command switch
        {
            AddLine => new Draft(d.Lines + 1),
            Submit when d.Lines == 0 => new TransitionRejected("Cannot submit an empty order"),
            Submit => new Submitted(d.Lines, clock.GetUtcNow()),
            Cancel c => new Cancelled(c.Reason, nameof(Draft)),
            Pay or Ship => Reject(state, command),
        },
        Submitted s => command switch
        {
            Pay { Amount: <= 0 } => new TransitionRejected("Payment amount must be positive"),
            Pay p => new Paid(p.Amount, $"PAY-{s.SubmittedAt:HHmmss}-{s.Lines}"),
            Cancel c => new Cancelled(c.Reason, nameof(Submitted)),
            AddLine or Submit or Ship => Reject(state, command),
        },
        Paid p => command switch
        {
            Ship s => new Shipped($"{s.Carrier.ToUpperInvariant()}-{p.PaymentReference[4..]}"),
            Cancel c => new Cancelled($"{c.Reason} (refund of {p.Amount:N2} issued)", nameof(Paid)),
            AddLine or Submit or Pay => Reject(state, command),
        },
        Shipped or Cancelled => Reject(state, command),   // terminal states
        // No '_' arm: adding 'Returned : OrderState' turns every incomplete switch into warning CS8509.
    };

    public static IReadOnlyList<string> AllowedCommands(OrderState state) => state switch
    {
        Draft => [nameof(AddLine), nameof(Submit), nameof(Cancel)],
        Submitted => [nameof(Pay), nameof(Cancel)],
        Paid => [nameof(Ship), nameof(Cancel)],
        Shipped or Cancelled => [],
    };
    // </snippet:CSharp15.Transition>

    private static TransitionRejected Reject(OrderState state, OrderCommand command) =>
        new($"'{command.GetType().Name}' is not allowed while the order is {state.GetType().Name}");

    /// <summary>Reads what the compiler recorded about the closed type, at runtime.</summary>
    public static (bool IsAbstract, IReadOnlyList<string> DerivedTypes) Describe(Type closedType)
    {
        var attribute = closedType.GetCustomAttributesData()
            .FirstOrDefault(a => a.AttributeType.FullName == "System.Runtime.CompilerServices.IsClosedTypeAttribute");
        var derived = attribute?.NamedArguments
            .Where(a => a.MemberName == "DerivedTypes")
            .SelectMany(a => (IEnumerable<CustomAttributeTypedArgument>)a.TypedValue.Value!)
            .Select(v => ((Type)v.Value!).Name)
            .ToList() ?? [];
        return (closedType.IsAbstract, derived);
    }
}

// <snippet:CSharp15.LegacyOrderStates>
// C# 14: an abstract record. Any assembly may derive from it, so every switch needs a default arm
// and a forgotten state is only discovered when the default arm throws.
public abstract record LegacyOrderState;
public sealed record LegacyDraft(int Lines) : LegacyOrderState;
public sealed record LegacySubmitted(int Lines) : LegacyOrderState;
public sealed record LegacyPaid(decimal Amount) : LegacyOrderState;
public sealed record LegacyShipped(string TrackingNumber) : LegacyOrderState;
public sealed record LegacyCancelled(string Reason) : LegacyOrderState;

public static class LegacyOrderStateMachine
{
    public static IReadOnlyList<string> AllowedCommands(LegacyOrderState state) => state switch
    {
        LegacyDraft => ["AddLine", "Submit", "Cancel"],
        LegacySubmitted => ["Pay", "Cancel"],
        LegacyPaid => ["Ship", "Cancel"],
        LegacyShipped or LegacyCancelled => [],
        _ => throw new System.Diagnostics.UnreachableException($"Unhandled state {state.GetType().Name}"),
    };
}
// </snippet:CSharp15.LegacyOrderStates>

/// <summary>Interactive order session used by the stepper: keeps the current state and history.</summary>
public sealed class OrderSession(TimeProvider clock)
{
    private readonly List<(string Command, string Outcome, bool Accepted)> _history = [];

    public OrderState State { get; private set; } = new Draft(0);
    public IReadOnlyList<(string Command, string Outcome, bool Accepted)> History => _history;

    public bool Execute(OrderCommand command)
    {
        var result = OrderStateMachine.Apply(State, command, clock);
        var label = command switch
        {
            AddLine => "AddLine",
            Submit => "Submit",
            Pay p => $"Pay({p.Amount})",
            Ship s => $"Ship(\"{s.Carrier}\")",
            Cancel c => $"Cancel(\"{c.Reason}\")",
        };
        switch (result)
        {
            case OrderState next:
                State = next;
                _history.Add((label, next.ToString(), true));
                return true;
            case TransitionRejected rejected:
                _history.Add((label, rejected.Reason, false));
                return false;
            default:
                throw new InvalidOperationException("Transition produced no result.");
        }
    }

    public void Reset()
    {
        State = new Draft(0);
        _history.Clear();
    }
}
