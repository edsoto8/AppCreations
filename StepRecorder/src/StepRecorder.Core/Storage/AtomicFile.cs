namespace StepRecorder.Core.Storage;

/// <summary>
/// Writes a file so that a crash mid-write leaves either the old or the new content, never a mix.
/// </summary>
internal static class AtomicFile
{
    public static void WriteAllText(string path, string contents)
    {
        string tempPath = path + ".tmp";
        using (var stream = new FileStream(tempPath, FileMode.Create, FileAccess.Write, FileShare.None))
        using (var writer = new StreamWriter(stream))
        {
            writer.Write(contents);
            writer.Flush();
            stream.Flush(flushToDisk: true);
        }

        File.Move(tempPath, path, overwrite: true);
    }
}
