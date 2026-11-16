namespace FileImporter.Tests.TestSupport;

/// <summary>A temporary source folder, deleted after the test.</summary>
public sealed class TempFolder : IDisposable
{
    public TempFolder()
    {
        Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "FileImporterTests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path);
    }

    public string Path { get; }

    public string ArchivePath => System.IO.Path.Combine(Path, "Archive");

    public string Write(string fileName, string content)
    {
        var path = System.IO.Path.Combine(Path, fileName);
        File.WriteAllText(path, content);
        return path;
    }

    public bool Exists(string fileName) => File.Exists(System.IO.Path.Combine(Path, fileName));

    public bool IsArchived(string fileName) => File.Exists(System.IO.Path.Combine(ArchivePath, fileName));

    public void Dispose()
    {
        try
        {
            Directory.Delete(Path, recursive: true);
        }
        catch (IOException)
        {
            // Best effort.
        }
    }
}
