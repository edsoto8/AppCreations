using Avalonia.Media;
using CommunityToolkit.Mvvm.ComponentModel;
using MetroSim.App.Controls;
using MetroSim.App.Game;
using MetroSim.Core.Economy;
using MetroSim.Core.Engine;
using MetroSim.Core.World;

namespace MetroSim.App.ViewModels;

/// <summary>
/// Finance dashboard: the latest daily ledger, income/expense/balance history and the tax sliders.
/// <see cref="Capture"/> copies what it needs under the state lock; <see cref="Publish"/> updates
/// bindings afterwards on the UI thread.
/// </summary>
public sealed partial class FinanceViewModel : ObservableObject
{
    public const int ChartDays = 60;

    private readonly MainViewModel _main;
    private DailyLedger? _lastDay;
    private DailyLedger _today = new();
    private DailyLedger[] _history = [];
    private int _historyCount = -1;
    private int _historyLastDay = -1;
    private bool _historyChanged;
    private long _money;
    private (int R, int C, int I) _taxes;
    private bool _publishing;

    [ObservableProperty]
    private string _balanceText = "";

    [ObservableProperty]
    private string _ledgerTitle = "";

    [ObservableProperty]
    private string _incomeText = "";

    [ObservableProperty]
    private string _expensesText = "";

    [ObservableProperty]
    private string _netText = "";

    [ObservableProperty]
    private IBrush _netBrush = Brushes.White;

    [ObservableProperty]
    private IReadOnlyList<LedgerRow> _rows = [];

    [ObservableProperty]
    private IReadOnlyList<ChartSeries> _chart = [];

    [ObservableProperty]
    private string _todayText = "";

    [ObservableProperty]
    private int _residentialTax = Budget.DefaultTax;

    [ObservableProperty]
    private int _commercialTax = Budget.DefaultTax;

    [ObservableProperty]
    private int _industrialTax = Budget.DefaultTax;

    public FinanceViewModel(MainViewModel main) => _main = main;

    public int MinTax => Budget.MinTax;

    public int MaxTax => Budget.MaxTax;

    public static Func<double, string> MoneyAxis { get; } = v => Format.Money((long)(v * 100));

    /// <summary>Call with the state lock held.</summary>
    public void Capture(Simulation sim)
    {
        var budget = sim.Budget;
        _money = budget.Money;
        _today = budget.Today.Clone();
        _taxes = (budget.ResidentialTax, budget.CommercialTax, budget.IndustrialTax);
        int count = budget.History.Count;
        int lastDay = count > 0 ? budget.History[^1].Day : -1;
        _historyChanged = count != _historyCount || lastDay != _historyLastDay;
        if (_historyChanged)
        {
            _historyCount = count;
            _historyLastDay = lastDay;
            _history = budget.History.Skip(Math.Max(0, count - ChartDays)).Select(l => l.Clone()).ToArray();
            _lastDay = _history.Length > 0 ? _history[^1] : null;
        }
    }

    public void Publish()
    {
        _publishing = true;
        try
        {
            BalanceText = Format.Money(_money);
            ResidentialTax = _taxes.R;
            CommercialTax = _taxes.C;
            IndustrialTax = _taxes.I;
            TodayText = $"Today so far: income {Format.Money(_today.Income)}, construction {Format.Money(_today.Construction)}";
            if (!_historyChanged && Rows.Count > 0)
            {
                return;
            }

            var ledger = _lastDay ?? _today;
            LedgerTitle = _lastDay is null ? "Today so far (first day)" : $"Day {ledger.Day + 1} ledger";
            Rows =
            [
                new("Residential tax", Format.Money(ledger.ResidentialTax), true),
                new("Commercial tax", Format.Money(ledger.CommercialTax), true),
                new("Industrial tax", Format.Money(ledger.IndustrialTax), true),
                new("Road upkeep", Format.Money(-ledger.RoadUpkeep), false),
                new("Power upkeep", Format.Money(-ledger.PowerUpkeep), false),
                new("Water upkeep", Format.Money(-ledger.WaterUpkeep), false),
                new("Garbage upkeep", Format.Money(-ledger.GarbageUpkeep), false),
                new("Fire upkeep", Format.Money(-ledger.FireUpkeep), false),
                new("Health upkeep", Format.Money(-ledger.HealthUpkeep), false),
                new("Construction", Format.Money(-ledger.Construction), false),
            ];
            IncomeText = Format.Money(ledger.Income);
            ExpensesText = Format.Money(-ledger.Expenses);
            NetText = Format.SignedMoney(ledger.Net);
            NetBrush = ledger.Net >= 0 ? MainViewModel.PositiveBrush : MainViewModel.NegativeBrush;
            Chart = _history.Length < 2
                ? []
                :
                [
                    new ChartSeries("Income", Color.FromRgb(0x5C, 0xD6, 0x7C), _history.Select(l => l.Income / 100.0).ToArray()),
                    new ChartSeries("Expenses", Color.FromRgb(0xF0, 0x6A, 0x5A), _history.Select(l => l.Expenses / 100.0).ToArray()),
                    new ChartSeries("Balance", Color.FromRgb(0x6C, 0xB0, 0xF0), _history.Select(l => l.ClosingBalance / 100.0).ToArray(), SecondaryAxis: true),
                ];
        }
        finally
        {
            _publishing = false;
        }
    }

    partial void OnResidentialTaxChanged(int value) => SetTax(ZoneType.Residential, value);

    partial void OnCommercialTaxChanged(int value) => SetTax(ZoneType.Commercial, value);

    partial void OnIndustrialTaxChanged(int value) => SetTax(ZoneType.Industrial, value);

    private void SetTax(ZoneType zone, int percent)
    {
        if (_publishing)
        {
            return;
        }

        var result = _main.Session.Runner.Execute(new SetTaxCommand(zone, percent));
        _main.ShowStatus(result.Message, !result.Success);
    }
}
