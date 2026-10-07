using BoardFlow.Core;
using BoardFlow.Data.Repositories;
using Microsoft.Extensions.Logging;

namespace BoardFlow.App.ViewModels;

/// <summary>Everything a view model needs, bundled so view models are cheap to create for each board or card.</summary>
public sealed class BoardServices(
    WorkspaceRepository workspaces,
    BoardRepository boards,
    ColumnRepository columns,
    CardRepository cards,
    LabelRepository labels,
    SettingsRepository settings,
    DialogHost dialogs,
    PanelHost panels,
    Notifier notifier,
    IClock clock,
    ILoggerFactory loggerFactory)
{
    public WorkspaceRepository Workspaces { get; } = workspaces;
    public BoardRepository Boards { get; } = boards;
    public ColumnRepository Columns { get; } = columns;
    public CardRepository Cards { get; } = cards;
    public LabelRepository Labels { get; } = labels;
    public SettingsRepository Settings { get; } = settings;
    public DialogHost Dialogs { get; } = dialogs;
    public PanelHost Panels { get; } = panels;
    public Notifier Notifier { get; } = notifier;
    public IClock Clock { get; } = clock;
    public ILoggerFactory LoggerFactory { get; } = loggerFactory;
}
