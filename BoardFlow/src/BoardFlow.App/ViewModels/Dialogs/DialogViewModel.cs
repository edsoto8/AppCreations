using BoardFlow.Core;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BoardFlow.App.ViewModels.Dialogs;

/// <summary>A modal dialog shown in the window's overlay layer.</summary>
public abstract partial class DialogViewModel(string title) : ObservableObject
{
    public string Title { get; } = title;

    public virtual string ConfirmText => "OK";

    public virtual bool IsDestructive => false;

    /// <summary>Inline validation message; the dialog stays open while this is set.</summary>
    [ObservableProperty]
    public partial string? Error { get; set; }

    [RelayCommand]
    public abstract void Confirm();

    [RelayCommand]
    public abstract void Cancel();
}

/// <summary>A dialog that produces a <typeparamref name="TResult"/>, or default when cancelled.</summary>
public abstract class DialogViewModel<TResult>(string title) : DialogViewModel(title)
{
    private readonly TaskCompletionSource<TResult?> _result = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public Task<TResult?> Result => _result.Task;

    public override void Confirm()
    {
        try
        {
            Error = null;
            _result.TrySetResult(BuildResult());
        }
        catch (ValidationException ex)
        {
            Error = ex.Message;
        }
    }

    public override void Cancel() => _result.TrySetResult(default);

    /// <summary>Validates the input and returns the result; throw <see cref="ValidationException"/> to keep the dialog open.</summary>
    protected abstract TResult BuildResult();
}
