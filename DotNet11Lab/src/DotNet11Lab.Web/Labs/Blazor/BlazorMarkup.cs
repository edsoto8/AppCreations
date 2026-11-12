namespace DotNet11Lab.Web.Labs.Blazor;

/// <summary>
/// Razor markup shown on the Blazor lab page. The C# logic is embedded from compiled source (SourceCatalog only reads
/// .cs files), so markup is quoted here instead; <c>BlazorMarkupTests</c> fails if an excerpt stops matching its .razor file.
/// </summary>
public static class BlazorMarkup
{
    public sealed record Excerpt(string File, string Code);

    public static readonly Excerpt AsyncForm = new("Components/Pages/Labs/Blazor/AsyncSignupForm.razor", """
        <EditForm EditContext="EditContext" OnValidSubmit="OnValidSubmitAsync" FormName="async-signup" class="signup" data-testid="async-form">
            <DataAnnotationsValidator />

            <div class="field">
                <label for="as-username">Username <FieldBadge State="StateOf(() => Model.Username)" /></label>
                <InputText id="as-username" @bind-Value="Model.Username" autocomplete="off" placeholder="try 'ada' (taken) or a new name" />
                <ValidationMessage For="() => Model.Username" />
            </div>
        """);

    public static readonly Excerpt SubmitButton = new("Components/Pages/Labs/Blazor/AsyncSignupForm.razor", """
        <button type="submit" class="btn btn-primary btn-sm" disabled="@AnyValidationPending">
        """);

    public static readonly Excerpt QuickGrids = new("Components/Pages/Labs/Blazor/QuickGridLab.razor", """
        <QuickGrid TGridItem="Transaction" Items="_transactions" Pagination="_txPages" OnRowClick="SelectAsync" RowClass="RowClass" Class="lab-grid">
            <PropertyColumn Property="t => t.Id" Title="Id" IsDefaultSortColumn="true" Sortable="true" />
            <PropertyColumn Property="t => t.Date" Title="Date" Format="yyyy-MM-dd" Sortable="true" />
            <PropertyColumn Property="t => t.Merchant" Title="Merchant" Sortable="true" />
            <PropertyColumn Property="t => t.Category" Title="Category" Sortable="true" />
            <PropertyColumn Property="t => t.Status" Title="Status" Sortable="true" />
            <PropertyColumn Property="t => t.Amount" Title="Amount" Format="N2" Align="Align.End" Sortable="true" />
        </QuickGrid>
        """);

    public static readonly Excerpt SecondGrid = new("Components/Pages/Labs/Blazor/QuickGridLab.razor", """
        <QuickGrid Items="_merchants" Pagination="_merchantPages" QueryParameterNameOptions="_merchantQueryNames" Class="lab-grid">
        """);

    public static readonly Excerpt SecondGridState = new("Components/Pages/Labs/Blazor/QuickGridLab.razor", """
        private readonly PaginationState _merchantPages = new() { ItemsPerPage = 8 };
        private readonly QueryParameterNameOptions _merchantQueryNames = new("m_");
        """);

    public static readonly Excerpt Virtualize = new("Components/Pages/Labs/Blazor/TransactionExplorer.razor", """
        <Virtualize @ref="List" TItem="Transaction" ItemsProvider="ProvideItemsAsync" ItemComparer="ById" ItemSize="46" InitialItemIndex="InitialIndex">
        """);

    public static readonly Excerpt Islands = new("Components/Pages/Labs/BlazorLab.razor", """
        <FormsIsland @rendermode="InteractiveServer" />
        """);

    public static IReadOnlyList<Excerpt> All { get; } = [AsyncForm, SubmitButton, QuickGrids, SecondGrid, SecondGridState, Virtualize, Islands];

    public static string Join(params Excerpt[] excerpts) => string.Join("\n\n", excerpts.Select(e => e.Code));
}
