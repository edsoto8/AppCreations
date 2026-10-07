using BoardFlow.Core;
using BoardFlow.Data;
using CommunityToolkit.Mvvm.ComponentModel;
using Microsoft.Extensions.Logging;

namespace BoardFlow.App.ViewModels;

public abstract class ViewModelBase(BoardServices services) : ObservableObject
{
    private ILogger? _logger;

    protected BoardServices Services { get; } = services;

    protected ILogger Logger => _logger ??= Services.LoggerFactory.CreateLogger(GetType());

    /// <summary>
    /// Runs a user action and turns failures into a message for the user. Validation problems are
    /// expected and only shown; persistence failures were already logged by the repository; anything
    /// else is logged here with full detail. Returns false if the action failed.
    /// </summary>
    protected bool Try(Action action, string what)
    {
        try
        {
            action();
            return true;
        }
        catch (ValidationException ex)
        {
            Services.Notifier.Error(ex.Message);
        }
        catch (PersistenceException ex)
        {
            Services.Notifier.Error(ex.Message);
        }
        catch (NotFoundException ex)
        {
            Logger.LogWarning(ex, "Stale item while trying to {Action}", what);
            Services.Notifier.Error($"{ex.Message} The view has been refreshed.");
            OnStaleData();
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Unexpected failure while trying to {Action}", what);
            Services.Notifier.Error($"Could not {what}: something unexpected went wrong. Details are in the log file.");
        }

        return false;
    }

    /// <summary>Called when an operation hit data that no longer exists; reload from the database.</summary>
    protected virtual void OnStaleData()
    {
    }
}
