using DotNet11Lab.Tests.Infrastructure;
using Bunit;
using DotNet11Lab.Core.Labs.Blazor;
using DotNet11Lab.Core.Labs.Blazor.Components;
using DotNet11Lab.Web.Components.Pages.Labs.Blazor;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web.Virtualization;
using Microsoft.Extensions.DependencyInjection;

namespace DotNet11Lab.Tests.Lab4Blazor;

/// <summary>bUnit tests for the Lab 4 components and their Core logic.</summary>
public sealed class BlazorComponentTests : IDisposable
{
    private readonly BunitContext _ctx = new();
    private readonly AccountDirectoryOptions _accountOptions = new() { Latency = TimeSpan.FromMilliseconds(300) };

    public BlazorComponentTests()
    {
        _ctx.Services.AddSingleton(TimeProvider.System);
        _ctx.Services.AddSingleton(_accountOptions);
        _ctx.Services.AddSingleton<AccountDirectory>();
        _ctx.Services.AddScoped<BlazorLabState>();
    }

    public void Dispose() => _ctx.Dispose();

    [Fact]
    public void Async_attribute_marks_the_field_pending_then_reports_the_taken_username()
    {
        var cut = _ctx.Render<AsyncSignupForm>();

        cut.Act(c => c.Find("#as-username").Change("ada"));

        // Pending immediately after the change event (IsValidationPending)...
        cut.WaitForAssertion(() => Assert.NotNull(cut.Find("label[for=as-username] [data-state=pending]")), TimeSpan.FromSeconds(2));
        Assert.True(cut.Find("button[type=submit]").HasAttribute("disabled"));
        // ...then the async validator's message once the lookup finishes.
        cut.WaitForAssertion(() =>
        {
            Assert.Contains("The username 'ada' is already taken.", cut.Markup, StringComparison.Ordinal);
            Assert.NotNull(cut.Find("label[for=as-username] [data-state=invalid]"));
        }, TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task EditContext_tracks_field_level_pending_state_separately_from_the_parameterless_overload()
    {
        var model = new SignupModel { Username = "ada" };
        var editContext = new Microsoft.AspNetCore.Components.Forms.EditContext(model);
        using var subscription = Microsoft.AspNetCore.Components.Forms.EditContextDataAnnotationsExtensions.EnableDataAnnotationsValidation(editContext, _ctx.Services);
        var field = editContext.Field(nameof(SignupModel.Username));

        editContext.NotifyFieldChanged(field);

        Assert.True(editContext.IsValidationPending(field));
        Assert.False(editContext.IsValidationPending()); // observed: the form-level overload ignores field-level checks
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (editContext.IsValidationPending(field) && DateTime.UtcNow < deadline) await Task.Delay(20, Xunit.TestContext.Current.CancellationToken);
        Assert.Contains("The username 'ada' is already taken.", editContext.GetValidationMessages(field));
    }

    [Fact]
    public void Available_username_becomes_valid()
    {
        _accountOptions.Latency = TimeSpan.FromMilliseconds(20);
        var cut = _ctx.Render<AsyncSignupForm>();
        cut.Act(c => c.Find("#as-username").Change("brand_new_user"));
        cut.WaitForAssertion(() => Assert.NotNull(cut.Find("label[for=as-username] [data-state=valid]")), TimeSpan.FromSeconds(5));
    }

    [Fact]
    public void Submit_awaits_async_validators_and_the_cross_field_rule()
    {
        _accountOptions.Latency = TimeSpan.FromMilliseconds(20);
        var cut = _ctx.Render<AsyncSignupForm>();
        cut.Act(c => c.Find("#as-username").Change("newcomer_1"));
        cut.Act(c => c.Find("#as-email").Change("newcomer@fabrikam.com"));
        cut.Act(c => c.Find("#as-password").Change("long enough pw"));
        cut.Act(c => c.Find("#as-invite").Change("CONTOSO-2026"));

        cut.Act(c => c.Find("form").Submit());

        cut.WaitForAssertion(() => Assert.Contains("is for @contoso.com addresses", cut.Markup, StringComparison.Ordinal), TimeSpan.FromSeconds(5));
        Assert.DoesNotContain("created", cut.Markup, StringComparison.Ordinal);

        cut.Act(c => c.Find("#as-invite").Change(""));
        cut.Act(c => c.Find("form").Submit());
        cut.WaitForAssertion(() => Assert.Contains("Account 'newcomer_1' created", cut.Markup, StringComparison.Ordinal), TimeSpan.FromSeconds(5));
        Assert.Contains(_ctx.Services.GetRequiredService<BlazorLabState>().Activity, a => a.Source == "Async form");
    }

    [Fact]
    public void Legacy_form_only_finds_taken_names_after_submit()
    {
        _accountOptions.Latency = TimeSpan.FromMilliseconds(20);
        var cut = _ctx.Render<LegacySignupForm>();
        cut.Act(c => c.Find("#ls-username").Change("grace"));
        Assert.DoesNotContain("already taken", cut.Markup, StringComparison.Ordinal);

        cut.Act(c => c.Find("#ls-email").Change("grace@example.com"));
        cut.Act(c => c.Find("#ls-password").Change("password123"));
        cut.Act(c => c.Find("form").Submit());

        cut.WaitForAssertion(() =>
        {
            Assert.Contains("The username 'grace' is already taken.", cut.Markup, StringComparison.Ordinal);
            Assert.Contains("An account already uses grace@example.com.", cut.Markup, StringComparison.Ordinal);
        }, TimeSpan.FromSeconds(5));

        // Hand-written errors are cleared when the field is edited.
        cut.Act(c => c.Find("#ls-username").Change("grace2"));
        cut.WaitForAssertion(() => Assert.DoesNotContain("already taken", cut.Markup, StringComparison.Ordinal), TimeSpan.FromSeconds(2));
    }

    [Theory]
    [InlineData(FieldState.Pending, "pending")]
    [InlineData(FieldState.Valid, "valid")]
    [InlineData(FieldState.Invalid, "invalid")]
    [InlineData(FieldState.Faulted, "faulted")]
    public void Field_badge_reflects_state(FieldState state, string expected)
    {
        var cut = _ctx.Render<FieldBadge>(p => p.Add(b => b.State, state));
        Assert.Equal(expected, cut.Find(".field-state").GetAttribute("data-state"));
    }

    [Fact]
    public void Untouched_field_has_no_badge() =>
        Assert.Empty(_ctx.Render<FieldBadge>(p => p.Add(b => b.State, FieldState.Untouched)).Markup.Trim());

    [Theory]
    [InlineData("Static", false)]
    [InlineData("Server", true)]
    public void Render_mode_badge_shows_RendererInfo(string name, bool interactive)
    {
        _ctx.SetRendererInfo(new RendererInfo(name, interactive));
        var cut = _ctx.Render<RenderModeBadge>(p => p.Add(b => b.Label, "Test"));
        var badge = cut.Find("[data-testid=render-mode]");
        Assert.Contains($"RendererInfo.Name = {name}", badge.TextContent.ReplaceLineEndings(" "), StringComparison.Ordinal);
        Assert.Equal(interactive, badge.ClassList.Contains("live"));
    }

    [Fact]
    public async Task Items_provider_returns_the_requested_window_and_counts_it()
    {
        var explorer = new ExplorerProbe(new TransactionDataset(1_000), new BlazorLabState(TimeProvider.System));
        var result = await explorer.ProvideAsync(new ItemsProviderRequest(990, 50, Xunit.TestContext.Current.CancellationToken));

        Assert.Equal(1_000, result.TotalItemCount);
        Assert.Equal(Enumerable.Range(991, 10), result.Items.Select(t => t.Id));
        Assert.Equal(1, explorer.StatsView.ProviderCalls);
        Assert.Equal(10, explorer.StatsView.RowsMaterialized);
    }

    [Fact]
    public void State_container_caps_and_notifies()
    {
        var state = new BlazorLabState(TimeProvider.System);
        var notifications = 0;
        state.Changed += () => notifications++;
        var data = new TransactionDataset(100);
        foreach (var t in data.Items.Take(20)) state.Pin(t, "test");

        Assert.Equal(BlazorLabState.MaxPinned, state.Pinned.Count);
        Assert.Equal(20, state.Pinned[0].Id);
        Assert.Equal(BlazorLabState.MaxActivity, state.Activity.Count);
        Assert.Equal(20, notifications);
    }

    private sealed class ExplorerProbe : TransactionExplorerBase
    {
        public ExplorerProbe(TransactionDataset data, BlazorLabState state)
        {
            Data = data;
            LabState = state;
            OnInitialized();
        }

        public VirtualizeStats StatsView => Stats;

        public ValueTask<ItemsProviderResult<Transaction>> ProvideAsync(ItemsProviderRequest request) => ProvideItemsAsync(request);
    }
}
