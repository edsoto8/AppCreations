namespace FileImporter.Core.Abstractions;

/// <summary>Moves imported files out of the source folder.</summary>
public interface IFileArchiver
{
    /// <summary>Moves the file into the archive subfolder and returns its new path.</summary>
    string MoveToArchive(string filePath);
}
