using Avalonia.Controls;
using Avalonia.Platform.Storage;
using MetroSim.Persistence;

namespace MetroSim.App.Services;

/// <summary>Asks the player for save/load paths. Tests substitute a fake.</summary>
public interface IFileDialogs
{
    Task<string?> PickSavePath(string suggestedName, string? startFolder);

    Task<string?> PickOpenPath(string? startFolder);
}

/// <summary>File pickers from the window's <see cref="TopLevel.StorageProvider"/>.</summary>
public sealed class StorageFileDialogs(Func<TopLevel?> topLevel) : IFileDialogs
{
    private static readonly FilePickerFileType CityFiles = new("MetroSim city")
    {
        Patterns = ["*" + SaveGameStore.FileExtension],
    };

    public async Task<string?> PickSavePath(string suggestedName, string? startFolder)
    {
        if (topLevel()?.StorageProvider is not { CanSave: true } storage)
        {
            return null;
        }

        var file = await storage.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            Title = "Save city",
            SuggestedFileName = suggestedName,
            DefaultExtension = SaveGameStore.FileExtension.TrimStart('.'),
            FileTypeChoices = [CityFiles],
            SuggestedStartLocation = await Folder(storage, startFolder),
        });
        return file?.TryGetLocalPath();
    }

    public async Task<string?> PickOpenPath(string? startFolder)
    {
        if (topLevel()?.StorageProvider is not { CanOpen: true } storage)
        {
            return null;
        }

        var files = await storage.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = "Load city",
            AllowMultiple = false,
            FileTypeFilter = [CityFiles, FilePickerFileTypes.All],
            SuggestedStartLocation = await Folder(storage, startFolder),
        });
        return files.Count > 0 ? files[0].TryGetLocalPath() : null;
    }

    private static async Task<IStorageFolder?> Folder(IStorageProvider storage, string? path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return null;
        }

        Directory.CreateDirectory(path);
        return await storage.TryGetFolderFromPathAsync(path);
    }
}
