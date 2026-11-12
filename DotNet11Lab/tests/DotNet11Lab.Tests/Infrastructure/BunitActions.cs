using Bunit;
using Microsoft.AspNetCore.Components;

namespace DotNet11Lab.Tests.Infrastructure;

public static class BunitActions
{
    /// <summary>
    /// Finds and triggers in one step on the renderer's dispatcher. Calling <c>cut.Find(..).Change(..)</c> directly
    /// races with asynchronous re-renders (async validators, background loads): a render landing between Find and the
    /// trigger replaces the event handler id and bUnit throws UnknownEventHandlerIdException. This is bUnit's
    /// documented remedy and made a flaky Lab 4 test deterministic.
    /// </summary>
    public static void Act<TComponent>(this IRenderedComponent<TComponent> cut, Action<IRenderedComponent<TComponent>> action)
        where TComponent : IComponent
        => cut.InvokeAsync(() => action(cut)).GetAwaiter().GetResult();
}
