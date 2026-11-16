using System.Data;

namespace FileImporter.Core.Models;

/// <summary>A file read into memory. <see cref="Data"/> has one string column per mapped staging column.</summary>
public sealed class ImportFile(string path, DataTable data, IReadOnlyList<string> errors) : IDisposable
{
    public string Path { get; } = path;

    public string FileName => System.IO.Path.GetFileName(Path);

    public DataTable Data { get; } = data;

    /// <summary>Structure and field errors. The file must not be imported when this is not empty.</summary>
    public IReadOnlyList<string> Errors { get; } = errors;

    public bool IsValid => Errors.Count == 0;

    public int RecordCount => Data.Rows.Count;

    public void Dispose() => Data.Dispose();
}
