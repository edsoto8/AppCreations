using FileImporter.Core.Abstractions;

namespace FileImporter.Tests.TestSupport;

/// <summary>Uses the real archiver, but can be told to fail a number of times first.</summary>
public sealed class ControllableArchiver(IFileArchiver inner) : IFileArchiver
{
    /// <summary>How many of the next calls fail. int.MaxValue = always.</summary>
    public int FailuresRemaining { get; set; }

    public Func<Exception> Failure { get; set; } = () => new UnauthorizedAccessException("Access to the archive folder is denied.");

    public int Calls { get; private set; }

    public string MoveToArchive(string filePath)
    {
        Calls++;
        if (FailuresRemaining > 0)
        {
            FailuresRemaining--;
            throw Failure();
        }

        return inner.MoveToArchive(filePath);
    }
}
